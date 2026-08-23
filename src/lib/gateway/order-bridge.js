'use strict';

const { buildServiceConfig } = require('../../config/services-catalog');
const { buildUrl, getJson, request } = require('../http');
const { getProviderProtocol } = require('./protocol-registry');
const { proxyActivateHandler } = require('./activate-bridge');
const { resolveCredentials } = require('../providers/getsms');

const SCHEMA = 'smsbazaar.gateway.v1';
const JUICY_API_ROOT = 'https://juicysms.com/api/v2';
const PRIEMNIK_ROOT = 'https://simsms.org/priemnik.php';
const GETSMS_ROOT = 'https://getsms.online/api_command.php';

const JUICY_COUNTRIES = [
  { code: 'UK', iso2: 'GB' },
  { code: 'USA', iso2: 'US' },
  { code: 'NL', iso2: 'NL' },
  { code: 'PH', iso2: 'PH' },
];

const ORDER_PROTOCOLS = new Set([
  'activate-handler',
  'activate-public-prices',
  'getsms-command',
  'priemnik',
  'juicy-v2',
]);

function supportsUnifiedOrders(providerKey) {
  return ORDER_PROTOCOLS.has(getProviderProtocol(providerKey));
}

function errorPayload(providerKey, code, message, extra = {}) {
  return {
    schema: SCHEMA,
    status: 'error',
    provider: providerKey,
    protocol: getProviderProtocol(providerKey),
    code,
    message,
    ...extra,
  };
}

function okPayload(providerKey, fields = {}) {
  return {
    schema: SCHEMA,
    status: 'ok',
    provider: providerKey,
    protocol: getProviderProtocol(providerKey),
    ...fields,
  };
}

function resolveServiceContext(providerKey, serviceKey) {
  const key = String(serviceKey || 'openai_chatgpt').trim();
  const config = buildServiceConfig(key);
  const service = config.serviceKey === key ? key : 'openai_chatgpt';
  const mapping = config.providerMappings.find((row) => row.providerKey === providerKey);
  if (!mapping) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }
  return { service, mapping, config };
}

function parseMaybeJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function extractCodeFromSms(text) {
  const sms = String(text || '').trim();
  if (!sms) return '';
  const patterns = [
    /\b(\d{4,8})\b/,
    /G-(\d{6})/i,
    /code[:\s]+([A-Z0-9-]{4,12})/i,
  ];
  for (const pattern of patterns) {
    const match = sms.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function resolveJuicyCountry(country) {
  const value = String(country || 'US').trim().toUpperCase();
  const found = JUICY_COUNTRIES.find((row) => row.iso2 === value || row.code === value);
  return found?.code || value;
}

function mapGetsmsStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'reserved') return 'waiting_code';
  if (normalized === 'awaiting mdn') return 'pending';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'timed out') return 'expired';
  return 'pending';
}

function mapJuicyStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'pending') return 'waiting_code';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'cancelled';
  if (normalized === 'expired') return 'expired';
  return 'pending';
}

async function activateCreateOrder({ providerKey, apiKey, mapping, service, country, operator, maxPrice, providerIds }) {
  const params = {
    action: 'getNumberV2',
    service: mapping.serviceCode,
    country: String(country || '0').trim(),
  };
  if (operator) params.operator = operator;
  if (maxPrice) params.maxPrice = maxPrice;
  if (providerIds) params.providerIds = providerIds;

  const result = await proxyActivateHandler({ providerKey, apiKey, query: params });
  const parsed = parseMaybeJson(result.body);

  if (typeof parsed === 'object' && parsed?.activationId && parsed?.phoneNumber) {
    return okPayload(providerKey, {
      activationId: String(parsed.activationId),
      phoneNumber: String(parsed.phoneNumber),
      phoneNumberLocal: String(parsed.phoneNumber || '').replace(/^\+/, ''),
      service,
      serviceCode: mapping.serviceCode,
      country: String(country || ''),
      orderState: 'waiting_code',
      cost: Number(parsed.activationCost || 0) || null,
      currency: 'USD',
      code: null,
      text: null,
      expiresInSec: null,
      raw: parsed,
    });
  }

  const legacyParams = {
    action: 'getNumber',
    service: mapping.serviceCode,
    country: String(country || '0').trim(),
  };
  if (operator) legacyParams.operator = operator;
  if (maxPrice) legacyParams.maxPrice = maxPrice;

  const legacy = await proxyActivateHandler({ providerKey, apiKey, query: legacyParams });
  const body = String(legacy.body || '').trim();
  if (body.startsWith('ACCESS_NUMBER:')) {
    const parts = body.split(':');
    const activationId = parts[1] || '';
    const phoneNumber = parts.slice(2).join(':');
    return okPayload(providerKey, {
      activationId,
      phoneNumber,
      phoneNumberLocal: phoneNumber,
      service,
      serviceCode: mapping.serviceCode,
      country: String(country || ''),
      orderState: 'waiting_code',
      cost: null,
      currency: 'USD',
      code: null,
      text: null,
      expiresInSec: null,
      raw: { body },
    });
  }

  return errorPayload(providerKey, 'order_failed', body || 'getNumber failed');
}

async function activateOrderStatus({ providerKey, apiKey, activationId }) {
  const result = await proxyActivateHandler({
    providerKey,
    apiKey,
    query: { action: 'getStatus', id: activationId },
  });
  const body = String(result.body || '').trim();

  if (body.startsWith('STATUS_OK:')) {
    const code = body.slice('STATUS_OK:'.length);
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'completed',
      code,
      text: code,
      raw: { body },
    });
  }

  if (body === 'STATUS_WAIT_CODE' || body === 'STATUS_WAIT_RETRY') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'waiting_code',
      code: null,
      text: null,
      raw: { body },
    });
  }

  if (body === 'STATUS_CANCEL') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'cancelled',
      code: null,
      text: null,
      raw: { body },
    });
  }

  return errorPayload(providerKey, 'status_failed', body || 'getStatus failed', {
    activationId: String(activationId),
  });
}

async function activateCancelOrder({ providerKey, apiKey, activationId }) {
  const result = await proxyActivateHandler({
    providerKey,
    apiKey,
    query: { action: 'setStatus', status: '8', id: activationId },
  });
  const body = String(result.body || '').trim();
  if (body === 'ACCESS_CANCEL' || body === 'ACCESS_ACTIVATION') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'cancelled',
      raw: { body },
    });
  }
  return errorPayload(providerKey, 'cancel_failed', body || 'setStatus failed', {
    activationId: String(activationId),
  });
}

async function getsmsCommand(apiKey, cmd, params = {}) {
  const credentials = resolveCredentials(apiKey);
  const payload = await getJson(buildUrl(GETSMS_ROOT, {
    cmd,
    user: credentials.user,
    api_key: credentials.apiKey,
    ...params,
  }), { timeoutMs: 30000 });

  if (String(payload?.status) === 'error') {
    throw new Error(String(payload?.message || 'GetSMS API error'));
  }
  return payload;
}

async function getsmsCreateOrder({ providerKey, mapping, service, apiKey, state, areacode, markup }) {
  const serviceName = String(mapping.nativeServiceName || mapping.serviceCode || '').trim();
  const params = { service: serviceName };
  if (state) params.state = state;
  if (areacode) params.areacode = areacode;
  if (markup) params.markup = markup;

  const payload = await getsmsCommand(apiKey, 'request', params);
  const entry = Array.isArray(payload?.message) ? payload.message[0] : null;
  if (!entry?.id) {
    return errorPayload(providerKey, 'order_failed', 'GetSMS request returned no id');
  }

  return okPayload(providerKey, {
    activationId: String(entry.id),
    phoneNumber: entry.mdn ? `+${String(entry.mdn).replace(/\D/g, '')}` : '',
    phoneNumberLocal: String(entry.mdn || ''),
    service,
    serviceCode: serviceName,
    country: 'US',
    orderState: mapGetsmsStatus(entry.status),
    cost: Number(entry.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: Number(entry.till_expiration) || null,
    raw: entry,
  });
}

async function getsmsOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await getsmsCommand(apiKey, 'request_status', { id: activationId });
  const entry = Array.isArray(payload?.message) ? payload.message[0] : null;
  if (!entry) {
    return errorPayload(providerKey, 'status_failed', 'Invalid request status response', {
      activationId: String(activationId),
    });
  }

  const orderState = mapGetsmsStatus(entry.status);
  let code = null;
  let text = null;

  if (orderState === 'completed') {
    try {
      const smsPayload = await getsmsCommand(apiKey, 'read_sms', { id: activationId });
      const smsEntry = Array.isArray(smsPayload?.message) ? smsPayload.message[0] : null;
      if (smsEntry) {
        text = String(smsEntry.reply || '');
        code = String(smsEntry.pin || '') || extractCodeFromSms(text);
      }
    } catch (error) {
      // read_sms may fail while status is still transitioning
    }
  }

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: entry.mdn ? `+${String(entry.mdn).replace(/\D/g, '')}` : '',
    phoneNumberLocal: String(entry.mdn || ''),
    orderState,
    cost: Number(entry.price || 0) || null,
    currency: 'USD',
    code,
    text,
    expiresInSec: Number(entry.till_expiration) || null,
    raw: entry,
  });
}

async function getsmsCancelOrder({ providerKey, apiKey, activationId }) {
  await getsmsCommand(apiKey, 'reject', { id: activationId });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
  });
}

async function priemnikRequest(apiKey, params) {
  return getJson(buildUrl(PRIEMNIK_ROOT, {
    apikey: apiKey,
    ...params,
  }), { timeoutMs: 20000 });
}

async function priemnikCreateOrder({ providerKey, mapping, service, apiKey, country }) {
  const countryCode = String(country || 'US').trim().toUpperCase();
  const payload = await priemnikRequest(apiKey, {
    metod: 'get_number',
    country: countryCode,
    service: mapping.serviceCode,
  });

  if (String(payload?.response) !== '1' || !payload?.id) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  return okPayload(providerKey, {
    activationId: String(payload.id),
    phoneNumber: String(payload.number || ''),
    phoneNumberLocal: String(payload.number || ''),
    service,
    serviceCode: mapping.serviceCode,
    country: countryCode,
    orderState: 'waiting_code',
    cost: null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: 600,
    raw: payload,
  });
}

async function priemnikOrderStatus({ providerKey, mapping, apiKey, activationId, country }) {
  const countryCode = String(country || 'US').trim().toUpperCase();
  const payload = await priemnikRequest(apiKey, {
    metod: 'get_sms',
    country: countryCode,
    service: mapping.serviceCode,
    id: activationId,
  });

  if (String(payload?.response) === '1' && payload?.sms) {
    const text = String(payload.sms);
    return okPayload(providerKey, {
      activationId: String(activationId),
      phoneNumber: String(payload.number || ''),
      phoneNumberLocal: String(payload.number || ''),
      orderState: 'completed',
      code: extractCodeFromSms(text) || text,
      text,
      raw: payload,
    });
  }

  if (String(payload?.response) === '2') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'waiting_code',
      code: null,
      text: null,
      raw: payload,
    });
  }

  if (String(payload?.response) === '3') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'expired',
      code: null,
      text: null,
      raw: payload,
    });
  }

  return errorPayload(providerKey, 'status_failed', JSON.stringify(payload || {}), {
    activationId: String(activationId),
  });
}

async function priemnikCancelOrder({ providerKey, mapping, apiKey, activationId, country }) {
  const countryCode = String(country || 'US').trim().toUpperCase();
  const payload = await priemnikRequest(apiKey, {
    metod: 'denial',
    country: countryCode,
    service: mapping.serviceCode,
    id: activationId,
  });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
    raw: payload,
  });
}

async function juicyJson(apiKey, path, options = {}) {
  const url = `${JUICY_API_ROOT}${path}`;
  const response = await request(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body,
    timeoutMs: options.timeoutMs || 20000,
  });
  return parseMaybeJson(response.text);
}

async function resolveJuicyServiceId(apiKey, country, serviceCode, serviceId) {
  if (serviceId) return Number(serviceId);
  const query = new URLSearchParams({
    country: resolveJuicyCountry(country),
    search: String(serviceCode || '').trim(),
  }).toString();
  const payload = await juicyJson(apiKey, `/services?${query}`);
  const services = Array.isArray(payload?.data) ? payload.data : [];
  const normalized = String(serviceCode || '').trim().toLowerCase();
  const match = services.find((row) => {
    const slug = String(row?.slug || '').trim().toLowerCase();
    const name = String(row?.name || '').trim().toLowerCase();
    return slug === normalized || name.includes(normalized) || normalized.includes(slug);
  }) || services[0];
  if (!match?.id) {
    throw new Error('JuicySMS service not found for mapping');
  }
  return Number(match.id);
}

async function juicyCreateOrder({ providerKey, mapping, service, apiKey, country, maxPrice, serviceId }) {
  const juicyCountry = resolveJuicyCountry(country);
  const resolvedServiceId = await resolveJuicyServiceId(
    apiKey,
    juicyCountry,
    mapping.serviceCode,
    serviceId,
  );

  const body = {
    service_id: resolvedServiceId,
    country: juicyCountry,
  };
  if (maxPrice) body.max_price = maxPrice;

  const response = await request(`${JUICY_API_ROOT}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });

  const order = parseMaybeJson(response.text);
  if (!order?.id) {
    return errorPayload(providerKey, 'order_failed', String(response.text || 'JuicySMS order failed'));
  }

  return okPayload(providerKey, {
    activationId: String(order.id),
    phoneNumber: String(order.phone_number || ''),
    phoneNumberLocal: String(order.phone_number_local || ''),
    service,
    serviceCode: mapping.serviceCode,
    country: juicyCountry,
    orderState: mapJuicyStatus(order.status),
    cost: Number(order.price?.amount || 0) || null,
    currency: String(order.price?.currency || 'EUR').toUpperCase(),
    code: null,
    text: null,
    expiresInSec: null,
    raw: order,
  });
}

async function juicyOrderStatus({ providerKey, apiKey, activationId }) {
  const order = await juicyJson(apiKey, `/orders/${activationId}`);
  const messagesPayload = await juicyJson(apiKey, `/orders/${activationId}/messages`);
  const messages = Array.isArray(messagesPayload?.data) ? messagesPayload.data : [];
  const latest = messages[0];
  const text = String(latest?.body || latest?.text || '');
  const code = extractCodeFromSms(text) || text;

  const orderState = text
    ? 'completed'
    : mapJuicyStatus(order?.status);

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: String(order?.phone_number || ''),
    phoneNumberLocal: String(order?.phone_number_local || ''),
    orderState,
    cost: Number(order?.price?.amount || 0) || null,
    currency: String(order?.price?.currency || 'EUR').toUpperCase(),
    code: text ? code : null,
    text: text || null,
    raw: { order, messages },
  });
}

async function juicyCancelOrder({ providerKey, apiKey, activationId }) {
  await request(`${JUICY_API_ROOT}/orders/${activationId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    timeoutMs: 20000,
  });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
  });
}

async function createUnifiedOrder({
  providerKey,
  apiKey,
  serviceKey,
  country,
  operator,
  maxPrice,
  providerIds,
  serviceId,
  state,
  areacode,
  markup,
}) {
  if (!supportsUnifiedOrders(providerKey)) {
    return errorPayload(
      providerKey,
      'unsupported_protocol',
      `平台 ${providerKey} 暂不支持统一取号，请使用 /api/gateway/v1/activate 或平台原生 API`,
    );
  }

  const { service, mapping } = resolveServiceContext(providerKey, serviceKey);
  const protocol = getProviderProtocol(providerKey);

  if (protocol === 'activate-handler' || protocol === 'activate-public-prices') {
    return activateCreateOrder({
      providerKey,
      apiKey,
      mapping,
      service,
      country,
      operator,
      maxPrice,
      providerIds,
    });
  }

  if (protocol === 'getsms-command') {
    return getsmsCreateOrder({
      providerKey,
      mapping,
      service,
      apiKey,
      state,
      areacode,
      markup,
    });
  }

  if (protocol === 'priemnik') {
    return priemnikCreateOrder({ providerKey, mapping, service, apiKey, country });
  }

  if (protocol === 'juicy-v2') {
    return juicyCreateOrder({
      providerKey,
      mapping,
      service,
      apiKey,
      country,
      maxPrice,
      serviceId,
    });
  }

  return errorPayload(providerKey, 'unsupported_protocol', '协议未实现');
}

async function getUnifiedOrderStatus({
  providerKey,
  apiKey,
  activationId,
  serviceKey,
  country,
}) {
  if (!activationId) {
    return errorPayload(providerKey, 'bad_request', '缺少 activationId');
  }

  if (!supportsUnifiedOrders(providerKey)) {
    return errorPayload(providerKey, 'unsupported_protocol', '平台不支持统一订单查询');
  }

  const { mapping } = resolveServiceContext(providerKey, serviceKey);
  const protocol = getProviderProtocol(providerKey);

  if (protocol === 'activate-handler' || protocol === 'activate-public-prices') {
    return activateOrderStatus({ providerKey, apiKey, activationId });
  }

  if (protocol === 'getsms-command') {
    return getsmsOrderStatus({ providerKey, apiKey, activationId });
  }

  if (protocol === 'priemnik') {
    return priemnikOrderStatus({
      providerKey,
      mapping,
      apiKey,
      activationId,
      country,
    });
  }

  if (protocol === 'juicy-v2') {
    return juicyOrderStatus({ providerKey, apiKey, activationId });
  }

  return errorPayload(providerKey, 'unsupported_protocol', '协议未实现');
}

async function cancelUnifiedOrder({
  providerKey,
  apiKey,
  activationId,
  serviceKey,
  country,
}) {
  if (!activationId) {
    return errorPayload(providerKey, 'bad_request', '缺少 activationId');
  }

  if (!supportsUnifiedOrders(providerKey)) {
    return errorPayload(providerKey, 'unsupported_protocol', '平台不支持统一取消');
  }

  const { mapping } = resolveServiceContext(providerKey, serviceKey);
  const protocol = getProviderProtocol(providerKey);

  if (protocol === 'activate-handler' || protocol === 'activate-public-prices') {
    return activateCancelOrder({ providerKey, apiKey, activationId });
  }

  if (protocol === 'getsms-command') {
    return getsmsCancelOrder({ providerKey, apiKey, activationId });
  }

  if (protocol === 'priemnik') {
    return priemnikCancelOrder({
      providerKey,
      mapping,
      apiKey,
      activationId,
      country,
    });
  }

  if (protocol === 'juicy-v2') {
    return juicyCancelOrder({ providerKey, apiKey, activationId });
  }

  return errorPayload(providerKey, 'unsupported_protocol', '协议未实现');
}

module.exports = {
  SCHEMA,
  supportsUnifiedOrders,
  createUnifiedOrder,
  getUnifiedOrderStatus,
  cancelUnifiedOrder,
};
