'use strict';

const { listProviders } = require('../../config/providers-catalog');

/**
 * Unified gateway protocol profiles.
 * `capabilities` describe what SMSBazaar can normalize or proxy for each provider.
 */
const PROTOCOL_PROFILES = {
  'activate-handler': {
    label: 'SMS-Activate handler_api.php',
    capabilities: ['balance', 'prices', 'prices_v3', 'countries', 'numbers_status', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['api_key'], style: 'query_api_key' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'activate-public-prices': {
    label: 'SMS-Activate + public price sheet',
    capabilities: ['balance', 'prices', 'countries', 'numbers_status', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['api_key'], style: 'query_api_key' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'priemnik': {
    label: 'SimSMS priemnik.php',
    capabilities: ['balance', 'prices', 'countries', 'stock', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['apikey'], style: 'query_apikey' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'getsms-command': {
    label: 'GetSMS api_command.php',
    capabilities: ['balance', 'prices', 'list_services'],
    auth: { fields: ['user', 'api_key'], style: 'user_and_api_key' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'juicy-v2': {
    label: 'JuicySMS REST v2',
    capabilities: ['balance', 'prices', 'list_services'],
    auth: { fields: ['api_key'], style: 'bearer' },
    priceCurrencyDefault: 'EUR',
    transactional: true,
  },
  'pvapins-user-api': {
    label: 'PVAPins user/api',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['customer'], style: 'query_customer' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'rest-v1-query-key': {
    label: 'REST JSON (apiKey query)',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['apiKey'], style: 'query_api_key' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'rest-v1-header-key': {
    label: 'REST JSON (header api key)',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['apikey', 'X-Api-Key'], style: 'header' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'rest-v1-api-key-param': {
    label: 'REST JSON (api_key query)',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['api_key'], style: 'query_api_key' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'give-sms-v1': {
    label: 'Give SMS api/v1',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['userkey'], style: 'query_userkey' },
    priceCurrencyDefault: 'RUB',
    transactional: true,
  },
  'onlinesim-tariffs': {
    label: 'OnlineSim getTariffs',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['apikey'], style: 'query_apikey' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'smspool-form': {
    label: 'SMSPool form POST',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['key'], style: 'form_key' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'fivesim-guest': {
    label: '5SIM REST v1 guest',
    capabilities: ['balance', 'prices'],
    auth: { fields: ['Authorization'], style: 'bearer_optional' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'sms-bus-control': {
    label: 'SMS-Bus control API',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['token'], style: 'header_token' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'smscode-rates': {
    label: 'SMSCode get_rates',
    capabilities: ['balance', 'prices', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['customer'], style: 'query_customer' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
  'snapshot-only': {
    label: 'No bulk pricing API',
    capabilities: ['balance', 'get_number', 'get_status', 'set_status'],
    auth: { fields: ['customer'], style: 'query_customer' },
    priceCurrencyDefault: 'USD',
    transactional: true,
  },
};

const PROVIDER_PROTOCOL = {
  'hero-sms': 'activate-handler',
  smsbower: 'activate-public-prices',
  '5sim': 'fivesim-guest',
  nexsms: 'rest-v1-query-key',
  grizzlysms: 'activate-handler',
  'sms-verification-number': 'activate-handler',
  smspool: 'smspool-form',
  onlinesim: 'onlinesim-tariffs',
  smspva: 'rest-v1-header-key',
  codesverify: 'snapshot-only',
  smscode: 'smscode-rates',
  'sms-rooms': 'activate-handler',
  'sms-bus': 'sms-bus-control',
  'vibe-sms': 'rest-v1-api-key-param',
  cyberyozh: 'rest-v1-header-key',
  'vak-sms': 'activate-handler',
  'give-sms': 'give-sms-v1',
  '365sms': 'activate-handler',
  'juicy-sms': 'juicy-v2',
  pvapins: 'pvapins-user-api',
  simsms: 'priemnik',
  getsms: 'getsms-command',
};

const ACTIVATE_ACTIONS = new Set([
  'getBalance',
  'getPrices',
  'getPricesV3',
  'getCountries',
  'getNumbersStatus',
  'getNumber',
  'getNumberV2',
  'getStatus',
  'setStatus',
  'getRentNumber',
  'getRentStatus',
  'setRentStatus',
  'getRentNumberSMS',
]);

function getProtocolProfile(protocolKey) {
  return PROTOCOL_PROFILES[protocolKey] || null;
}

function getProviderProtocol(providerKey) {
  return PROVIDER_PROTOCOL[providerKey] || 'snapshot-only';
}

function listGatewayProviders() {
  return listProviders().map((provider) => {
    const protocolKey = getProviderProtocol(provider.providerKey);
    const profile = getProtocolProfile(protocolKey) || PROTOCOL_PROFILES['snapshot-only'];
    return {
      providerKey: provider.providerKey,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      keyEnv: provider.keyEnv,
      publicWithoutKey: Boolean(provider.publicWithoutKey),
      protocol: protocolKey,
      protocolLabel: profile.label,
      capabilities: [...profile.capabilities],
      auth: { ...profile.auth },
      transactional: Boolean(profile.transactional),
      priceCurrencyDefault: profile.priceCurrencyDefault,
    };
  });
}

function supportsActivateProxy(providerKey) {
  const protocol = getProviderProtocol(providerKey);
  return protocol === 'activate-handler' || protocol === 'activate-public-prices';
}

function isActivateAction(action) {
  return ACTIVATE_ACTIONS.has(String(action || '').trim());
}

module.exports = {
  ACTIVATE_ACTIONS,
  getProtocolProfile,
  getProviderProtocol,
  isActivateAction,
  listGatewayProviders,
  supportsActivateProxy,
  PROTOCOL_PROFILES,
  PROVIDER_PROTOCOL,
};
