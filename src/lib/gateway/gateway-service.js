'use strict';

const { buildServiceConfig } = require('../../config/services-catalog');
const { getProvider } = require('../providers');
const { resolveProviderApiKey } = require('../settings');
const { getProviderDefinition } = require('../../config/providers-catalog');
const { getAllProviderSnapshots } = require('../db');
const { testProviderKeySafe } = require('../provider-key-test');
const {
  getProviderProtocol,
  listGatewayProviders,
  supportsActivateProxy,
} = require('./protocol-registry');
const { proxyActivateHandler } = require('./activate-bridge');
const {
  createUnifiedOrder: createOrderBridge,
  getUnifiedOrderStatus: getOrderStatusBridge,
  cancelUnifiedOrder: cancelOrderBridge,
  supportsUnifiedOrders,
} = require('./order-bridge');

const SCHEMA = 'smsbazaar.gateway.v1';

function resolveServiceKey(raw) {
  const key = String(raw || 'openai_chatgpt').trim();
  const config = buildServiceConfig(key);
  return config.serviceKey === key ? key : 'openai_chatgpt';
}

function resolveProviderApiKeyForGateway(db, providerKey, auth) {
  const definition = getProviderDefinition(providerKey);
  if (!definition) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }

  if (auth.mode === 'passthrough' && auth.apiKey) {
    return auth.apiKey;
  }

  const stored = resolveProviderApiKey(db, definition.keyEnv);
  if (stored) return stored;

  if (definition.publicWithoutKey) return '';

  throw new Error('未配置平台 API Key');
}

function offersFromSnapshot(db, providerKey, serviceKey) {
  const snapshots = getAllProviderSnapshots(db, serviceKey);
  const snapshot = snapshots.find((row) => row.providerKey === providerKey);
  if (!snapshot?.payload?.offers) return [];
  return snapshot.payload.offers;
}

async function getUnifiedPrices({
  db,
  exchangeRateService,
  providerKey,
  serviceKey,
  source = 'snapshot',
  auth,
}) {
  const service = resolveServiceKey(serviceKey);
  const config = buildServiceConfig(service);
  const mapping = config.providerMappings.find((row) => row.providerKey === providerKey);
  if (!mapping) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }

  const protocol = getProviderProtocol(providerKey);
  let offers = [];
  let fetchedAt = '';
  let dataSource = 'snapshot';

  if (source === 'live') {
    const apiKey = resolveProviderApiKeyForGateway(db, providerKey, auth);
    const provider = getProvider(providerKey);
    const result = await provider.fetchProviderOffers({
      mapping,
      exchangeRateService,
      apiKey,
    });
    if (result.error) {
      throw new Error(result.error);
    }
    offers = result.offers || [];
    fetchedAt = result.lastFetchedAt || new Date().toISOString();
    dataSource = 'live';
  } else {
    offers = offersFromSnapshot(db, providerKey, service);
    const snapshot = getAllProviderSnapshots(db, service).find((row) => row.providerKey === providerKey);
    fetchedAt = snapshot?.fetchedAt || '';
  }

  return {
    schema: SCHEMA,
    status: 'ok',
    provider: providerKey,
    displayName: mapping.displayName,
    protocol,
    service: service,
    serviceCode: mapping.serviceCode,
    nativeServiceName: mapping.nativeServiceName || '',
    source: dataSource,
    currency: offers[0]?.currency || 'USD',
    offerCount: offers.length,
    offers,
    fetchedAt,
  };
}

async function getUnifiedBalance({ db, providerKey, auth }) {
  const apiKey = resolveProviderApiKeyForGateway(db, providerKey, auth);
  const result = await testProviderKeySafe(providerKey, apiKey);
  if (!result.ok) {
    return {
      schema: SCHEMA,
      status: 'error',
      provider: providerKey,
      code: 'balance_failed',
      message: result.message,
    };
  }

  return {
    schema: SCHEMA,
    status: 'ok',
    provider: providerKey,
    displayName: result.displayName,
    protocol: getProviderProtocol(providerKey),
    balance: result.details?.balance ?? null,
    currency: result.details?.currency ?? 'USD',
    endpoint: result.endpoint || '',
    checkedAt: new Date().toISOString(),
  };
}

async function proxyActivate({ db, providerKey, query, auth }) {
  if (!supportsActivateProxy(providerKey)) {
    throw new Error(`平台 ${providerKey} 不支持 SMS-Activate 协议中转`);
  }

  const apiKey = resolveProviderApiKeyForGateway(db, providerKey, auth);
  return proxyActivateHandler({
    providerKey,
    apiKey,
    query,
  });
}

async function createUnifiedOrder(params) {
  const { db, providerKey, auth, ...rest } = params;
  const apiKey = resolveProviderApiKeyForGateway(db, providerKey, auth);
  return createOrderBridge({ providerKey, apiKey, ...rest });
}

async function getUnifiedOrderStatus(params) {
  const { db, providerKey, auth, ...rest } = params;
  const apiKey = resolveProviderApiKeyForGateway(db, providerKey, auth);
  return getOrderStatusBridge({ providerKey, apiKey, ...rest });
}

async function cancelUnifiedOrder(params) {
  const { db, providerKey, auth, ...rest } = params;
  const apiKey = resolveProviderApiKeyForGateway(db, providerKey, auth);
  return cancelOrderBridge({ providerKey, apiKey, ...rest });
}

function getGatewayMeta() {
  return {
    schema: SCHEMA,
    status: 'ok',
    description: 'SMSBazaar unified gateway — normalized prices + protocol proxy',
    unifiedEndpoints: {
      meta: 'GET /api/gateway/v1/meta',
      balance: 'GET /api/gateway/v1/balance?provider=hero-sms',
      prices: 'GET /api/gateway/v1/prices?provider=hero-sms&service=telegram&source=snapshot|live',
      activate: 'GET /api/gateway/v1/activate?provider=hero-sms&action=getBalance&api_key=...',
      orderCreate: 'POST /api/gateway/v1/order?provider=hero-sms&service=telegram&country=12',
      orderStatus: 'GET /api/gateway/v1/order?provider=hero-sms&activationId=123',
      orderCancel: 'POST /api/gateway/v1/order/cancel?provider=hero-sms&activationId=123',
    },
    auth: {
      public: ['GET /api/gateway/v1/meta', 'GET /api/gateway/v1/prices (snapshot only)'],
      protected: ['balance', 'prices live', 'activate proxy', 'order create/status/cancel'],
      methods: [
        'Admin session cookie / Bearer',
        'GATEWAY_API_TOKEN via X-Gateway-Token or api_key query',
        'Passthrough upstream api_key on activate endpoint',
      ],
    },
    orderStates: ['pending', 'waiting_code', 'completed', 'cancelled', 'expired', 'rejected'],
    orderProtocols: listGatewayProviders()
      .filter((provider) => supportsUnifiedOrders(provider.providerKey))
      .map((provider) => provider.providerKey),
    providers: listGatewayProviders(),
  };
}

module.exports = {
  getGatewayMeta,
  getUnifiedBalance,
  getUnifiedPrices,
  proxyActivate,
  createUnifiedOrder,
  getUnifiedOrderStatus,
  cancelUnifiedOrder,
  supportsUnifiedOrders,
  SCHEMA,
};
