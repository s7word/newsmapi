'use strict';

const { getProviderDefinition, listProviders } = require('../../config/providers-catalog');
const { buildUrl, getJson, getText, request } = require('../http');
const { getProviderProtocol } = require('./protocol-registry');
const { proxyActivateHandler } = require('./activate-bridge');
const { resolveCredentials } = require('../providers/getsms');
const { normalizeBaseUrl: normalizeSmsPoolBaseUrl } = require('../providers/smspool');
const countryBySlug = require('../providers/give-sms-countries.json');
const { smstgApiRequest, resolveCountrySlug } = require('../providers/smstg');
const {
  SCHEMA,
  errorPayload,
  okPayload,
  resolveServiceContext,
  parseMaybeJson,
  extractCodeFromSms,
  normalizeCountryToken,
  digitsOnly,
  formatE164,
} = require('./order-shared');

const JUICY_API_ROOT = 'https://juicysms.com/api/v2';
const PRIEMNIK_ROOT = 'https://simsms.org/priemnik.php';
const GETSMS_ROOT = 'https://getsms.online/api_command.php';
const ONLINESIM_API_ROOT = 'https://onlinesim.io/api';
const SMSPVA_API_ROOT = 'https://api.smspva.com';
const SMS_BUS_API_ROOT = 'https://sms-bus.com/api/control';
const VIBE_API_ROOT = 'https://api.vibe-sms.net/api/v1';
const CYBERYOZH_API_ROOT = 'https://app.cyberyozh.com/api/v1';
const GIVE_SMS_API_ROOT = 'https://give-sms.com/api/v1';
const PVAPINS_API_ROOT = 'https://api.pvapins.com/user/api';
const SMSCODE_API_ROOT = 'https://smscode.net/api/user';
const CODESVERIFY_API_ROOT = 'https://api.codesverify.com';
const NEXSMS_API_ROOT = 'https://api.nexsms.net/api';
const FIVESIM_API_ROOT = 'https://5sim.net/v1';

const JUICY_COUNTRIES = [
  { code: 'UK', iso2: 'GB' },
  { code: 'USA', iso2: 'US' },
  { code: 'NL', iso2: 'NL' },
  { code: 'PH', iso2: 'PH' },
];

const ACTIVATE_PROTOCOLS = new Set(['activate-handler', 'activate-public-prices']);
const SUPPORTED_PROVIDER_KEYS = new Set(listProviders().map((row) => row.providerKey));

function supportsUnifiedOrders(providerKey) {
  return SUPPORTED_PROVIDER_KEYS.has(providerKey);
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

function mapFiveSimStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'FINISHED' || normalized === 'RECEIVED') return 'completed';
  if (normalized === 'CANCELED' || normalized === 'BANNED') return 'cancelled';
  if (normalized === 'TIMEOUT' || normalized === 'EXPIRED') return 'expired';
  if (normalized === 'PENDING') return 'waiting_code';
  return 'pending';
}

function mapSmsPoolCheckStatus(status) {
  const code = Number(status);
  if (code === 3) return 'completed';
  if (code === 5 || code === 6) return 'cancelled';
  if (code === 2) return 'expired';
  if (code === 1 || code === 7 || code === 8) return 'waiting_code';
  return 'pending';
}

function mapGiveSmsStatus(status) {
  const code = Number(status);
  if (code === 200) return 'completed';
  if (code === 400) return 'waiting_code';
  if (code === 500) return 'expired';
  return 'pending';
}

function resolveJuicyCountry(country) {
  const value = String(country || 'US').trim().toUpperCase();
  const found = JUICY_COUNTRIES.find((row) => row.iso2 === value || row.code === value);
  return found?.code || value;
}

function resolveGiveSmsCountrySlug(country) {
  const token = normalizeCountryToken(country).toLowerCase();
  if (!token) return 'kazakhstan';
  if (countryBySlug[token]) return token;
  for (const [slug, meta] of Object.entries(countryBySlug)) {
    const label = String(meta?.label || '').trim().toLowerCase();
    if (label && label === token) return slug;
  }
  return token.replace(/\s+/g, '');
}

function resolvePvapinsAppName(mapping) {
  return String(mapping.nativeServiceName || mapping.serviceCode || '').trim();
}

async function smsPoolPost(baseUrl, endpoint, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, String(value));
  }
  const response = await request(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    timeoutMs: 30000,
  });
  return parseMaybeJson(response.text);
}

async function smsBusApiGet(path, token, params = {}) {
  const payload = await getJson(buildUrl(`${SMS_BUS_API_ROOT}/${path}`, {
    token,
    ...params,
  }), { timeoutMs: 30000 });
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.message || `SMS-Bus API error (${payload?.code || 'unknown'})`);
  }
  return payload;
}

function normalizeProjectCode(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveSmsBusProjectId(token, serviceCode) {
  const raw = String(serviceCode || '').trim();
  if (!raw) throw new Error('Missing service code mapping');
  if (/^\d+$/.test(raw)) return Number(raw);
  const projectsPayload = await smsBusApiGet('list/projects', token);
  const projects = Object.values(projectsPayload.data || {});
  const normalized = normalizeProjectCode(raw);
  const matched = projects.find((project) => normalizeProjectCode(project?.code) === normalized);
  if (!matched?.id) throw new Error(`SMS-Bus project not found: ${raw}`);
  return Number(matched.id);
}

async function resolveSmsBusCountryId(token, country) {
  const tokenValue = normalizeCountryToken(country);
  if (/^\d+$/.test(tokenValue)) return Number(tokenValue);
  const countriesPayload = await smsBusApiGet('list/countries', token);
  const countries = Object.values(countriesPayload.data || {});
  const normalized = tokenValue.toUpperCase();
  const matched = countries.find((row) => {
    const code = String(row?.code || '').trim().toUpperCase();
    const title = String(row?.title || '').trim().toUpperCase();
    return code === normalized || title === normalized || String(row?.id) === tokenValue;
  });
  if (!matched?.id) throw new Error(`SMS-Bus country not found: ${country}`);
  return Number(matched.id);
}

function nexsmsSuccess(payload, endpointName) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`NexSMS ${endpointName} returned empty response`);
  }
  if ('code' in payload && Number(payload.code) !== 0) {
    throw new Error(payload.message || `NexSMS ${endpointName} failed (${payload.code})`);
  }
  return payload.data;
}

async function resolveNexsmsPurchasePrice(apiKey, serviceCode, countryId, maxPrice) {
  const payload = await getJson(buildUrl(`${NEXSMS_API_ROOT}/getCountryByService`, {
    apiKey,
    serviceCode,
    countryId,
  }), { timeoutMs: 20000 });
  const data = nexsmsSuccess(payload, 'getCountryByService');
  const priceMap = data?.priceMap && typeof data.priceMap === 'object' ? data.priceMap : {};
  const prices = Object.keys(priceMap)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!prices.length) {
    const fallback = Number(data?.minPrice || data?.maxPrice || maxPrice || 0);
    if (Number.isFinite(fallback) && fallback > 0) return fallback;
    throw new Error('NexSMS price not available for country/service');
  }
  const cap = Number(maxPrice);
  if (Number.isFinite(cap) && cap > 0) {
    const affordable = prices.filter((price) => price <= cap);
    if (!affordable.length) throw new Error(`NexSMS price above maxPrice ${cap}`);
    return affordable[affordable.length - 1];
  }
  return prices[0];
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
    phoneNumber: entry.mdn ? `+${digitsOnly(entry.mdn)}` : '',
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
    } catch {
      // read_sms may fail while status is still transitioning
    }
  }

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: entry.mdn ? `+${digitsOnly(entry.mdn)}` : '',
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

async function fiveSimJson(apiKey, path, options = {}) {
  const definition = getProviderDefinition('5sim');
  const baseUrl = definition?.baseUrl || FIVESIM_API_ROOT;
  const response = await request(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
    timeoutMs: options.timeoutMs || 30000,
  });
  return parseMaybeJson(response.text);
}

async function fiveSimCreateOrder({ providerKey, mapping, service, apiKey, country, operator, maxPrice }) {
  const countrySlug = normalizeCountryToken(country).toLowerCase() || 'any';
  const operatorSlug = normalizeCountryToken(operator).toLowerCase() || 'any';
  const product = String(mapping.serviceCode || '').trim().toLowerCase();
  let path = `/user/buy/activation/${encodeURIComponent(countrySlug)}/${encodeURIComponent(operatorSlug)}/${encodeURIComponent(product)}`;
  if (maxPrice) path += `?maxPrice=${encodeURIComponent(String(maxPrice))}`;

  const order = await fiveSimJson(apiKey, path);
  if (!order?.id) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(order || {}));
  }

  const phone = String(order.phone || order.number || '');
  return okPayload(providerKey, {
    activationId: String(order.id),
    phoneNumber: phone.startsWith('+') ? phone : (phone ? `+${digitsOnly(phone)}` : ''),
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode: product,
    country: countrySlug,
    orderState: mapFiveSimStatus(order.status),
    cost: Number(order.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: null,
    raw: order,
  });
}

async function fiveSimOrderStatus({ providerKey, apiKey, activationId }) {
  const order = await fiveSimJson(apiKey, `/user/check/${encodeURIComponent(activationId)}`);
  const smsList = Array.isArray(order?.sms) ? order.sms : [];
  const latestSms = smsList.length ? smsList[smsList.length - 1] : null;
  const text = String(latestSms?.text || latestSms?.code || order?.sms || '');
  const code = String(latestSms?.code || '') || extractCodeFromSms(text);
  const orderState = text
    ? 'completed'
    : mapFiveSimStatus(order?.status);

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: order?.phone ? formatE164(order.phone) : '',
    phoneNumberLocal: digitsOnly(order?.phone),
    orderState,
    cost: Number(order?.price || 0) || null,
    currency: 'USD',
    code: text ? code : null,
    text: text || null,
    raw: order,
  });
}

async function fiveSimCancelOrder({ providerKey, apiKey, activationId }) {
  const order = await fiveSimJson(apiKey, `/user/cancel/${encodeURIComponent(activationId)}`);
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: mapFiveSimStatus(order?.status) === 'completed' ? 'completed' : 'cancelled',
    raw: order,
  });
}

async function nexsmsCreateOrder({ providerKey, mapping, service, apiKey, country, countryId, maxPrice, price }) {
  const resolvedCountryId = Number(countryId || country);
  if (!Number.isFinite(resolvedCountryId)) {
    return errorPayload(providerKey, 'bad_request', 'NexSMS 需要 countryId（数字）或数字 country 参数');
  }
  const serviceCode = String(mapping.serviceCode || '').trim();
  const purchasePrice = Number(price) || await resolveNexsmsPurchasePrice(
    apiKey,
    serviceCode,
    resolvedCountryId,
    maxPrice,
  );

  const response = await request(buildUrl(`${NEXSMS_API_ROOT}/order/purchase`, { apiKey }), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      serviceCode,
      countryId: resolvedCountryId,
      quantity: 1,
      price: purchasePrice,
    }),
    timeoutMs: 30000,
  });
  const payload = parseMaybeJson(response.text);
  const data = nexsmsSuccess(payload, 'order/purchase');
  const phoneNumbers = Array.isArray(data?.phoneNumbers) ? data.phoneNumbers : [];
  const phone = String(phoneNumbers[0] || '');
  if (!phone) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  return okPayload(providerKey, {
    activationId: phone,
    phoneNumber: formatE164(phone),
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode,
    country: String(resolvedCountryId),
    orderState: 'waiting_code',
    cost: Number(data?.totalAmount || purchasePrice) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: null,
    raw: payload,
  });
}

async function nexsmsOrderStatus({ providerKey, apiKey, activationId, phoneNumber }) {
  const phone = digitsOnly(phoneNumber || activationId);
  if (!phone) {
    return errorPayload(providerKey, 'bad_request', 'NexSMS 需要 phoneNumber 或 activationId（手机号）');
  }
  const payload = await getJson(buildUrl(`${NEXSMS_API_ROOT}/sms/messages`, {
    apiKey,
    phoneNumber: phone,
    format: 'json_latest',
  }), { timeoutMs: 20000 });

  if (Number(payload?.code) !== 0) {
    return errorPayload(providerKey, 'status_failed', payload?.message || 'NexSMS messages failed', {
      activationId: String(activationId),
    });
  }

  const data = payload?.data;
  const text = String(data?.text || '');
  const code = String(data?.code || '') || extractCodeFromSms(text);
  const orderState = text ? 'completed' : 'waiting_code';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: formatE164(phone),
    phoneNumberLocal: phone,
    orderState,
    code: text ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function nexsmsCancelOrder({ providerKey, apiKey, activationId, phoneNumber }) {
  const phone = digitsOnly(phoneNumber || activationId);
  const response = await request(buildUrl(`${NEXSMS_API_ROOT}/close/activation`, { apiKey }), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phoneNumber: phone }),
    timeoutMs: 20000,
  });
  const payload = parseMaybeJson(response.text);
  if (Number(payload?.code) !== 0) {
    return errorPayload(providerKey, 'cancel_failed', payload?.message || 'NexSMS close failed', {
      activationId: String(activationId),
    });
  }
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
    raw: payload,
  });
}

async function smspoolCreateOrder({ providerKey, mapping, service, apiKey, country, pool, maxPrice, serviceId }) {
  const definition = getProviderDefinition('smspool');
  const baseUrl = normalizeSmsPoolBaseUrl(definition?.baseUrl);
  const params = {
    key: apiKey,
    country: normalizeCountryToken(country) || 'US',
    service: String(serviceId || mapping.serviceCode || '').trim(),
  };
  if (pool) params.pool = String(pool).trim();
  if (maxPrice) params.max_price = String(maxPrice);

  const payload = await smsPoolPost(baseUrl, '/purchase/sms', params);
  if (Number(payload?.success) === 0 || payload?.error) {
    return errorPayload(providerKey, 'order_failed', payload?.message || payload?.error || 'SMSPool purchase failed');
  }

  const orderId = String(payload?.order_id || payload?.orderid || payload?.id || '');
  const phone = String(payload?.number || payload?.phone || '');
  if (!orderId) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  return okPayload(providerKey, {
    activationId: orderId,
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode: mapping.serviceCode,
    country: params.country,
    orderState: 'waiting_code',
    cost: Number(payload?.cost || payload?.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: Number(payload?.expiration || payload?.expires_in) || null,
    raw: payload,
  });
}

async function smspoolOrderStatus({ providerKey, apiKey, activationId }) {
  const definition = getProviderDefinition('smspool');
  const baseUrl = normalizeSmsPoolBaseUrl(definition?.baseUrl);
  const payload = await smsPoolPost(baseUrl, '/sms/check', {
    key: apiKey,
    orderid: activationId,
  });

  const text = String(payload?.sms || payload?.message || '');
  const code = String(payload?.code || '') || extractCodeFromSms(text);
  const orderState = text
    ? 'completed'
    : mapSmsPoolCheckStatus(payload?.status);

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: payload?.number ? formatE164(payload.number) : '',
    phoneNumberLocal: digitsOnly(payload?.number),
    orderState,
    code: text ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function smspoolCancelOrder({ providerKey, apiKey, activationId }) {
  const definition = getProviderDefinition('smspool');
  const baseUrl = normalizeSmsPoolBaseUrl(definition?.baseUrl);
  const payload = await smsPoolPost(baseUrl, '/sms/cancel', {
    key: apiKey,
    orderid: activationId,
  });
  if (Number(payload?.success) === 0) {
    return errorPayload(providerKey, 'cancel_failed', payload?.message || 'SMSPool cancel failed', {
      activationId: String(activationId),
    });
  }
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
    raw: payload,
  });
}

async function onlinesimCreateOrder({ providerKey, mapping, service, apiKey, country }) {
  const countryDial = Number(country || 1);
  const payload = await getJson(buildUrl(`${ONLINESIM_API_ROOT}/getNum.php`, {
    apikey: apiKey,
    service: mapping.serviceCode,
    country: String(countryDial),
    number: true,
    lang: 'en',
  }), { timeoutMs: 30000 });

  if (String(payload?.response) !== '1' || !payload?.tzid) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  const phone = String(payload?.number || payload?.phone || '');
  return okPayload(providerKey, {
    activationId: String(payload.tzid),
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode: mapping.serviceCode,
    country: String(countryDial),
    orderState: 'waiting_code',
    cost: Number(payload?.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: Number(payload?.time) || null,
    raw: payload,
  });
}

async function onlinesimOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await getJson(buildUrl(`${ONLINESIM_API_ROOT}/getState.php`, {
    apikey: apiKey,
    tzid: activationId,
    message_to_code: 1,
    msg_list: 1,
    lang: 'en',
  }), { timeoutMs: 20000 });

  const entries = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
  const entry = entries.find((row) => String(row?.tzid || row?.id) === String(activationId)) || entries[0];
  const messages = Array.isArray(entry?.msg) ? entry.msg : [];
  const latest = messages[messages.length - 1];
  const text = String(latest?.text || latest?.msg || entry?.msg || '');
  const code = extractCodeFromSms(text) || text;
  const orderState = text ? 'completed' : 'waiting_code';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: entry?.number ? formatE164(entry.number) : '',
    phoneNumberLocal: digitsOnly(entry?.number),
    orderState,
    code: text ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function onlinesimCancelOrder({ providerKey, apiKey, activationId }) {
  const body = await getText(buildUrl('https://onlinesim.io/stubs/handler_api.php', {
    api_key: apiKey,
    action: 'setStatus',
    id: activationId,
    status: 8,
  }), { timeoutMs: 20000 });
  const trimmed = String(body || '').trim();
  if (/ACCESS_CANCEL|ACCESS_ACTIVATION|BAD_STATUS/i.test(trimmed) || trimmed === 'OK') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState: 'cancelled',
      raw: { body: trimmed },
    });
  }
  return errorPayload(providerKey, 'cancel_failed', trimmed || 'OnlineSim cancel failed', {
    activationId: String(activationId),
  });
}

async function smspvaJson(path, apiKey, options = {}) {
  const response = await request(`${SMSPVA_API_ROOT}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: apiKey,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
    timeoutMs: options.timeoutMs || 30000,
  });
  return parseMaybeJson(response.text);
}

async function smspvaCreateOrder({ providerKey, mapping, service, apiKey, country, operator }) {
  const countryCode = normalizeCountryToken(country).toUpperCase() || 'US';
  const serviceCode = String(mapping.serviceCode || '').trim();
  let path = `/activation/number/${encodeURIComponent(countryCode)}/${encodeURIComponent(serviceCode)}`;
  if (operator) path += `?operator=${encodeURIComponent(String(operator))}`;

  const payload = await smspvaJson(path, apiKey);
  if (Number(payload?.statusCode) !== 200 || !payload?.data) {
    return errorPayload(providerKey, 'order_failed', payload?.message || JSON.stringify(payload || {}));
  }

  const data = payload.data;
  const orderId = String(data.id || data.orderId || data.orderid || '');
  const phone = String(data.number || data.phone || '');
  if (!orderId) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  return okPayload(providerKey, {
    activationId: orderId,
    phoneNumber: phone ? formatE164(`${data.countryCode || ''}${phone}`) : '',
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode,
    country: countryCode,
    orderState: 'waiting_code',
    cost: Number(data.cost || data.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: Number(data.expiresIn || data.expire) || null,
    raw: payload,
  });
}

async function smspvaOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await smspvaJson(`/activation/sms/${encodeURIComponent(activationId)}`, apiKey);
  if (Number(payload?.statusCode) !== 200) {
    return errorPayload(providerKey, 'status_failed', payload?.message || 'SMSPVA sms failed', {
      activationId: String(activationId),
    });
  }

  const data = payload?.data || {};
  const text = String(data.sms || data.text || data.code || '');
  const code = String(data.code || '') || extractCodeFromSms(text);
  const orderState = text ? 'completed' : 'waiting_code';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: data.number ? formatE164(data.number) : '',
    phoneNumberLocal: digitsOnly(data.number),
    orderState,
    code: text ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function smspvaCancelOrder({ providerKey, apiKey, activationId }) {
  const payload = await smspvaJson(
    `/activation/cancelorder/${encodeURIComponent(activationId)}`,
    apiKey,
    { method: 'PUT' },
  );
  if (Number(payload?.statusCode) !== 200) {
    return errorPayload(providerKey, 'cancel_failed', payload?.message || 'SMSPVA cancel failed', {
      activationId: String(activationId),
    });
  }
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
    raw: payload,
  });
}

async function customerNumberCreate({ providerKey, mapping, service, apiKey, country, appId, baseUrl, appParam }) {
  const countryName = normalizeCountryToken(country) || 'USA';
  const app = String(appParam || mapping.nativeServiceName || mapping.serviceCode || '').trim();
  const payload = await getJson(buildUrl(`${baseUrl}/get_number.php`, {
    customer: apiKey,
    app,
    country: countryName,
    ...(appId ? { app_id: appId } : {}),
  }), { timeoutMs: 30000 });

  if (payload?.error) {
    return errorPayload(providerKey, 'order_failed', String(payload.error));
  }

  const number = String(payload?.number || payload?.phone || payload?.data?.number || '');
  const orderId = String(payload?.id || payload?.order_id || number);
  if (!number) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    if (/not found|error/i.test(text)) {
      return errorPayload(providerKey, 'order_failed', text);
    }
    return errorPayload(providerKey, 'order_failed', text || 'get_number failed');
  }

  return okPayload(providerKey, {
    activationId: orderId,
    phoneNumber: formatE164(number),
    phoneNumberLocal: digitsOnly(number),
    service,
    serviceCode: mapping.serviceCode,
    country: countryName,
    orderState: 'waiting_code',
    cost: Number(payload?.rate || payload?.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: null,
    raw: payload,
  });
}

async function customerNumberStatus({ providerKey, apiKey, activationId, country, mapping, phoneNumber, baseUrl, appParam }) {
  const countryName = normalizeCountryToken(country) || 'USA';
  const app = String(appParam || mapping.nativeServiceName || mapping.serviceCode || '').trim();
  const number = digitsOnly(phoneNumber || activationId);
  const payload = await getJson(buildUrl(`${baseUrl}/get_sms.php`, {
    customer: apiKey,
    number,
    country: countryName,
    app,
  }), { timeoutMs: 20000 });

  if (payload?.error) {
    const message = String(payload.error);
    if (/not received|not found|yet/i.test(message)) {
      return okPayload(providerKey, {
        activationId: String(activationId),
        phoneNumber: formatE164(number),
        phoneNumberLocal: number,
        orderState: 'waiting_code',
        code: null,
        text: null,
        raw: payload,
      });
    }
    return errorPayload(providerKey, 'status_failed', message, {
      activationId: String(activationId),
    });
  }

  const text = String(payload?.sms || payload?.text || payload?.message || '');
  const code = String(payload?.code || '') || extractCodeFromSms(text);
  const orderState = (text || code) ? 'completed' : 'waiting_code';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: formatE164(number),
    phoneNumberLocal: number,
    orderState,
    code: orderState === 'completed' ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function customerNumberCancel({ providerKey, apiKey, activationId, country, mapping, phoneNumber, baseUrl, appParam, rejectPath }) {
  const countryName = normalizeCountryToken(country) || 'USA';
  const app = String(appParam || mapping.nativeServiceName || mapping.serviceCode || '').trim();
  const number = digitsOnly(phoneNumber || activationId);
  const path = rejectPath || 'get_reject_number.php';
  const payload = await getJson(buildUrl(`${baseUrl}/${path}`, {
    customer: apiKey,
    number,
    country: countryName,
    app,
  }), { timeoutMs: 20000 });

  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
    raw: payload,
  });
}

async function smscodeCreateOrder(ctx) {
  return customerNumberCreate({
    ...ctx,
    baseUrl: SMSCODE_API_ROOT,
    appParam: ctx.mapping.nativeServiceName || ctx.mapping.serviceCode,
  });
}

async function smscodeOrderStatus(ctx) {
  return customerNumberStatus({
    ...ctx,
    baseUrl: SMSCODE_API_ROOT,
    appParam: ctx.mapping.nativeServiceName || ctx.mapping.serviceCode,
  });
}

async function smscodeCancelOrder(ctx) {
  return customerNumberCancel({
    ...ctx,
    baseUrl: SMSCODE_API_ROOT,
    appParam: ctx.mapping.nativeServiceName || ctx.mapping.serviceCode,
  });
}

async function codesverifyCreateOrder(ctx) {
  return customerNumberCreate({
    ...ctx,
    baseUrl: CODESVERIFY_API_ROOT,
    appParam: ctx.mapping.nativeServiceName || ctx.mapping.serviceCode,
  });
}

async function codesverifyOrderStatus(ctx) {
  return customerNumberStatus({
    ...ctx,
    baseUrl: CODESVERIFY_API_ROOT,
    appParam: ctx.mapping.nativeServiceName || ctx.mapping.serviceCode,
  });
}

async function codesverifyCancelOrder(ctx) {
  return customerNumberCancel({
    ...ctx,
    baseUrl: CODESVERIFY_API_ROOT,
    appParam: ctx.mapping.nativeServiceName || ctx.mapping.serviceCode,
  });
}

async function pvapinsCreateOrder(ctx) {
  return customerNumberCreate({
    ...ctx,
    baseUrl: PVAPINS_API_ROOT,
    appParam: resolvePvapinsAppName(ctx.mapping),
  });
}

async function pvapinsOrderStatus(ctx) {
  return customerNumberStatus({
    ...ctx,
    baseUrl: PVAPINS_API_ROOT,
    appParam: resolvePvapinsAppName(ctx.mapping),
  });
}

async function pvapinsCancelOrder(ctx) {
  return customerNumberCancel({
    ...ctx,
    baseUrl: PVAPINS_API_ROOT,
    appParam: resolvePvapinsAppName(ctx.mapping),
  });
}

async function smsBusCreateOrder({ providerKey, mapping, service, apiKey, country, countryId, projectId, serviceId }) {
  const token = apiKey;
  const resolvedProjectId = Number(projectId || serviceId) || await resolveSmsBusProjectId(token, mapping.serviceCode);
  const resolvedCountryId = Number(countryId) || await resolveSmsBusCountryId(token, country || 'US');
  const payload = await smsBusApiGet('get/number', token, {
    country_id: resolvedCountryId,
    project_id: resolvedProjectId,
  });
  const data = payload?.data || {};
  const requestId = String(data.request_id || data.id || '');
  const phone = String(data.number || data.phone || '');
  if (!requestId) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  return okPayload(providerKey, {
    activationId: requestId,
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode: mapping.serviceCode,
    country: String(resolvedCountryId),
    orderState: 'waiting_code',
    cost: Number(data.cost || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: null,
    raw: payload,
  });
}

async function smsBusOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await smsBusApiGet('get/sms', apiKey, { request_id: activationId });
  const data = payload?.data || {};
  const text = String(data.sms || data.text || data.code || '');
  const code = String(data.code || '') || extractCodeFromSms(text);
  const orderState = (text || code) ? 'completed' : 'waiting_code';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: data.number ? formatE164(data.number) : '',
    phoneNumberLocal: digitsOnly(data.number),
    orderState,
    code: orderState === 'completed' ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function smsBusCancelOrder({ providerKey, apiKey, activationId }) {
  await smsBusApiGet('cancel', apiKey, { request_id: activationId });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
  });
}

async function vibeSmsCreateOrder({ providerKey, mapping, service, apiKey, country, serviceId, operator }) {
  const params = {
    api_key: apiKey,
    country: normalizeCountryToken(country).toUpperCase() || 'US',
    service: String(serviceId || mapping.serviceCode || '').trim(),
  };
  if (operator) params.operator = String(operator);

  const payload = await getJson(buildUrl(`${VIBE_API_ROOT}/orders/create`, params), { timeoutMs: 30000 });
  if (payload?.error) {
    return errorPayload(providerKey, 'order_failed', String(payload.error));
  }

  const data = payload?.data || payload;
  const orderId = String(data?.id || data?.order_id || '');
  const phone = String(data?.phone || data?.number || '');
  if (!orderId) {
    return errorPayload(providerKey, 'order_failed', JSON.stringify(payload || {}));
  }

  return okPayload(providerKey, {
    activationId: orderId,
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode: mapping.serviceCode,
    country: params.country,
    orderState: 'waiting_code',
    cost: Number(data?.price || data?.cost || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: Number(data?.expires_in) || null,
    raw: payload,
  });
}

async function vibeSmsOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await getJson(buildUrl(`${VIBE_API_ROOT}/orders/status`, {
    api_key: apiKey,
    id: activationId,
  }), { timeoutMs: 20000 });

  const data = payload?.data || payload;
  const text = String(data?.sms || data?.text || data?.code || '');
  const code = String(data?.code || '') || extractCodeFromSms(text);
  const orderState = (text || code) ? 'completed' : 'waiting_code';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: data?.phone ? formatE164(data.phone) : '',
    phoneNumberLocal: digitsOnly(data?.phone),
    orderState,
    code: orderState === 'completed' ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function vibeSmsCancelOrder({ providerKey, apiKey, activationId }) {
  await getJson(buildUrl(`${VIBE_API_ROOT}/orders/cancel`, {
    api_key: apiKey,
    id: activationId,
  }), { timeoutMs: 20000 });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
  });
}

function cyberyozhHeaders(apiKey) {
  return {
    Accept: 'application/json',
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

async function cyberyozhCreateOrder({ providerKey, mapping, service, apiKey, country, operator, maxPrice, serviceId }) {
  const body = {
    service_code: String(serviceId || mapping.serviceCode || '').trim(),
    country_code: normalizeCountryToken(country).toUpperCase() || 'US',
    provider: String(operator || 'virtual'),
    period: 'MIN_15',
  };
  if (maxPrice) body.max_price = Number(maxPrice);

  const response = await request(`${CYBERYOZH_API_ROOT}/numbers/`, {
    method: 'POST',
    headers: cyberyozhHeaders(apiKey),
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });
  const payload = parseMaybeJson(response.text);
  const data = payload?.data || payload;
  const orderId = String(data?.id || data?.order_id || data?.number_id || '');
  const phone = String(data?.phone_number || data?.number || data?.phone || '');
  if (!orderId) {
    return errorPayload(providerKey, 'order_failed', String(response.text || 'CyberYozh order failed'));
  }

  return okPayload(providerKey, {
    activationId: orderId,
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: digitsOnly(phone),
    service,
    serviceCode: mapping.serviceCode,
    country: body.country_code,
    orderState: 'waiting_code',
    cost: Number(data?.price || 0) || null,
    currency: 'USD',
    code: null,
    text: null,
    expiresInSec: null,
    raw: payload,
  });
}

async function cyberyozhOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await getJson(`${CYBERYOZH_API_ROOT}/numbers/${encodeURIComponent(activationId)}/`, {
    headers: cyberyozhHeaders(apiKey),
    timeoutMs: 20000,
  });
  const data = payload?.data || payload;
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const latest = messages[0] || data;
  const text = String(latest?.text || latest?.sms || latest?.body || data?.sms || '');
  const code = String(latest?.code || data?.code || '') || extractCodeFromSms(text);
  const status = String(data?.status || '').toLowerCase();
  let orderState = 'waiting_code';
  if (text || code) orderState = 'completed';
  else if (status.includes('cancel')) orderState = 'cancelled';
  else if (status.includes('expir')) orderState = 'expired';

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: data?.phone_number ? formatE164(data.phone_number) : '',
    phoneNumberLocal: digitsOnly(data?.phone_number),
    orderState,
    code: orderState === 'completed' ? code : null,
    text: text || null,
    raw: payload,
  });
}

async function cyberyozhCancelOrder({ providerKey, apiKey, activationId }) {
  await request(`${CYBERYOZH_API_ROOT}/numbers/${encodeURIComponent(activationId)}/cancel/`, {
    method: 'POST',
    headers: cyberyozhHeaders(apiKey),
    timeoutMs: 20000,
  });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
  });
}

async function giveSmsRequest(apiKey, params) {
  return getJson(buildUrl(`${GIVE_SMS_API_ROOT}/`, {
    userkey: apiKey,
    ...params,
  }), { timeoutMs: 30000 });
}

async function giveSmsCreateOrder({ providerKey, mapping, service, apiKey, country }) {
  const payload = await giveSmsRequest(apiKey, {
    method: 'getnumber',
    service: mapping.serviceCode,
    country: resolveGiveSmsCountrySlug(country),
  });

  if (Number(payload?.status) !== 200 || !payload?.data?.order_id) {
    return errorPayload(providerKey, 'order_failed', payload?.data?.msg || JSON.stringify(payload || {}));
  }

  const phone = String(payload.data.phone || '');
  return okPayload(providerKey, {
    activationId: String(payload.data.order_id),
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: phone,
    service,
    serviceCode: mapping.serviceCode,
    country: resolveGiveSmsCountrySlug(country),
    orderState: 'waiting_code',
    cost: null,
    currency: 'RUB',
    code: null,
    text: null,
    expiresInSec: 900,
    raw: payload,
  });
}

async function giveSmsOrderStatus({ providerKey, apiKey, activationId }) {
  const payload = await giveSmsRequest(apiKey, {
    method: 'getcode',
    order_id: activationId,
  });
  const orderState = mapGiveSmsStatus(payload?.status);
  if (orderState === 'waiting_code') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState,
      code: null,
      text: null,
      raw: payload,
    });
  }
  if (orderState === 'expired') {
    return okPayload(providerKey, {
      activationId: String(activationId),
      orderState,
      code: null,
      text: null,
      raw: payload,
    });
  }

  const data = payload?.data || {};
  const text = String(data.fullSms || data.text || data.code || '');
  const code = String(data.code || '') || extractCodeFromSms(text);

  return okPayload(providerKey, {
    activationId: String(activationId),
    phoneNumber: data.phone ? formatE164(data.phone) : '',
    phoneNumberLocal: String(data.phone || ''),
    orderState: 'completed',
    code,
    text: text || code,
    raw: payload,
  });
}

async function giveSmsCancelOrder({ providerKey, apiKey, activationId }) {
  await giveSmsRequest(apiKey, {
    method: 'refusenumber',
    order_id: activationId,
  });
  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState: 'cancelled',
  });
}

function mapSmstgMessage(payload) {
  return String(payload?.message || payload?.raw || '').trim();
}

function extractSmstgOrderId(payload) {
  return String(
    payload?.id
    || payload?.order_id
    || payload?.orderId
    || payload?.data?.id
    || payload?.data?.order_id
    || payload?.data?.orderId
    || '',
  ).trim();
}

function extractSmstgPhone(payload) {
  return String(
    payload?.phone
    || payload?.number
    || payload?.account
    || payload?.data?.phone
    || payload?.data?.number
    || payload?.data?.account
    || '',
  ).trim();
}

function extractSmstgOtp(payload) {
  return String(
    payload?.otp
    || payload?.code
    || payload?.data?.otp
    || payload?.data?.code
    || '',
  ).trim();
}

function mapSmstgOrderState(payload, otp) {
  const message = mapSmstgMessage(payload).toUpperCase();
  if (otp) return 'completed';
  if (/NO_OTP|WAIT|PROCESS|PENDING/i.test(message)) return 'waiting_code';
  if (/NO_BALANCE/i.test(message)) return 'rejected';
  if (/BAD_KEY/i.test(message)) return 'rejected';
  if (message && !/^OK|SUCCESS/i.test(message)) return 'pending';
  return 'waiting_code';
}

async function smstgCreateOrder({ providerKey, mapping, service, apiKey, country }) {
  const baseUrl = mapping.baseUrl || 'https://smstg.org/api';
  const countrySlug = resolveCountrySlug(country);
  const payload = await smstgApiRequest(baseUrl, apiKey, 'buy', { country: countrySlug });

  const message = mapSmstgMessage(payload);
  if (message === 'BAD_KEY') {
    return errorPayload(providerKey, 'bad_key', 'API Key 无效 (BAD_KEY)');
  }
  if (/NO_BALANCE/i.test(message)) {
    return errorPayload(providerKey, 'no_balance', message || 'NO_BALANCE');
  }
  if (/NO_STOCK|OUT_OF_STOCK|NO_NUMBERS/i.test(message)) {
    return errorPayload(providerKey, 'no_numbers', message || 'NO_STOCK');
  }

  const orderId = extractSmstgOrderId(payload);
  if (!orderId && !extractSmstgPhone(payload)) {
    return errorPayload(providerKey, 'order_failed', message || JSON.stringify(payload || {}));
  }

  const phone = extractSmstgPhone(payload);
  const otp = extractSmstgOtp(payload);
  const orderState = mapSmstgOrderState(payload, otp);

  return okPayload(providerKey, {
    activationId: orderId || phone,
    phoneNumber: phone ? formatE164(phone) : '',
    phoneNumberLocal: phone,
    service,
    serviceCode: mapping.serviceCode || 'tg',
    country: countrySlug.toUpperCase(),
    orderState,
    cost: payload?.price != null
      ? Number(payload.price)
      : (payload?.data?.price != null ? Number(payload.data.price) : null),
    currency: 'USD',
    code: otp || null,
    text: otp || null,
    expiresInSec: 900,
    raw: payload,
  });
}

async function smstgOrderStatus({ providerKey, mapping, apiKey, activationId }) {
  const baseUrl = mapping.baseUrl || 'https://smstg.org/api';
  const payload = await smstgApiRequest(baseUrl, apiKey, 'getOtp', {
    id: activationId,
    order_id: activationId,
  });

  const message = mapSmstgMessage(payload);
  if (message === 'BAD_KEY') {
    return errorPayload(providerKey, 'bad_key', 'API Key 无效 (BAD_KEY)');
  }
  if (/NO_ORDER|NO_ACTIVATION|NOT_FOUND/i.test(message)) {
    return errorPayload(providerKey, 'not_found', message || '订单不存在');
  }

  const otp = extractSmstgOtp(payload);
  const orderState = mapSmstgOrderState(payload, otp);

  return okPayload(providerKey, {
    activationId: String(activationId),
    orderState,
    code: otp || null,
    text: otp || null,
    raw: payload,
  });
}

async function smstgCancelOrder({ providerKey }) {
  return errorPayload(
    providerKey,
    'cancel_not_supported',
    'SMSTG 成品账号购买后不支持通过 API 取消',
  );
}

const PROVIDER_HANDLERS = {
  '5sim': {
    create: fiveSimCreateOrder,
    status: fiveSimOrderStatus,
    cancel: fiveSimCancelOrder,
  },
  nexsms: {
    create: nexsmsCreateOrder,
    status: nexsmsOrderStatus,
    cancel: nexsmsCancelOrder,
  },
  smspool: {
    create: smspoolCreateOrder,
    status: smspoolOrderStatus,
    cancel: smspoolCancelOrder,
  },
  onlinesim: {
    create: onlinesimCreateOrder,
    status: onlinesimOrderStatus,
    cancel: onlinesimCancelOrder,
  },
  smspva: {
    create: smspvaCreateOrder,
    status: smspvaOrderStatus,
    cancel: smspvaCancelOrder,
  },
  codesverify: {
    create: codesverifyCreateOrder,
    status: codesverifyOrderStatus,
    cancel: codesverifyCancelOrder,
  },
  smscode: {
    create: smscodeCreateOrder,
    status: smscodeOrderStatus,
    cancel: smscodeCancelOrder,
  },
  'sms-bus': {
    create: smsBusCreateOrder,
    status: smsBusOrderStatus,
    cancel: smsBusCancelOrder,
  },
  'vibe-sms': {
    create: vibeSmsCreateOrder,
    status: vibeSmsOrderStatus,
    cancel: vibeSmsCancelOrder,
  },
  cyberyozh: {
    create: cyberyozhCreateOrder,
    status: cyberyozhOrderStatus,
    cancel: cyberyozhCancelOrder,
  },
  'give-sms': {
    create: giveSmsCreateOrder,
    status: giveSmsOrderStatus,
    cancel: giveSmsCancelOrder,
  },
  pvapins: {
    create: pvapinsCreateOrder,
    status: pvapinsOrderStatus,
    cancel: pvapinsCancelOrder,
  },
  smstg: {
    create: smstgCreateOrder,
    status: smstgOrderStatus,
    cancel: smstgCancelOrder,
  },
};

function buildHandlerContext(input) {
  const { providerKey, apiKey, serviceKey, ...rest } = input;
  const { service, mapping } = resolveServiceContext(providerKey, serviceKey);
  return {
    providerKey,
    apiKey,
    service,
    mapping,
    ...rest,
  };
}

async function createUnifiedOrder(input) {
  const { providerKey } = input;
  if (!supportsUnifiedOrders(providerKey)) {
    return errorPayload(
      providerKey,
      'unsupported_protocol',
      `平台 ${providerKey} 暂不支持统一取号`,
    );
  }

  const ctx = buildHandlerContext(input);
  const protocol = getProviderProtocol(providerKey);
  const dedicated = PROVIDER_HANDLERS[providerKey];

  if (dedicated?.create) {
    return dedicated.create(ctx);
  }

  if (ACTIVATE_PROTOCOLS.has(protocol)) {
    return activateCreateOrder(ctx);
  }
  if (protocol === 'getsms-command') {
    return getsmsCreateOrder(ctx);
  }
  if (protocol === 'priemnik') {
    return priemnikCreateOrder(ctx);
  }
  if (protocol === 'juicy-v2') {
    return juicyCreateOrder(ctx);
  }

  return errorPayload(providerKey, 'unsupported_protocol', '协议未实现');
}

async function getUnifiedOrderStatus(input) {
  const { providerKey, activationId } = input;
  if (!activationId) {
    return errorPayload(providerKey, 'bad_request', '缺少 activationId');
  }
  if (!supportsUnifiedOrders(providerKey)) {
    return errorPayload(providerKey, 'unsupported_protocol', '平台不支持统一订单查询');
  }

  const ctx = buildHandlerContext(input);
  const protocol = getProviderProtocol(providerKey);
  const dedicated = PROVIDER_HANDLERS[providerKey];

  if (dedicated?.status) {
    return dedicated.status(ctx);
  }

  if (ACTIVATE_PROTOCOLS.has(protocol)) {
    return activateOrderStatus(ctx);
  }
  if (protocol === 'getsms-command') {
    return getsmsOrderStatus(ctx);
  }
  if (protocol === 'priemnik') {
    return priemnikOrderStatus(ctx);
  }
  if (protocol === 'juicy-v2') {
    return juicyOrderStatus(ctx);
  }

  return errorPayload(providerKey, 'unsupported_protocol', '协议未实现');
}

async function cancelUnifiedOrder(input) {
  const { providerKey, activationId } = input;
  if (!activationId) {
    return errorPayload(providerKey, 'bad_request', '缺少 activationId');
  }
  if (!supportsUnifiedOrders(providerKey)) {
    return errorPayload(providerKey, 'unsupported_protocol', '平台不支持统一取消');
  }

  const ctx = buildHandlerContext(input);
  const protocol = getProviderProtocol(providerKey);
  const dedicated = PROVIDER_HANDLERS[providerKey];

  if (dedicated?.cancel) {
    return dedicated.cancel(ctx);
  }

  if (ACTIVATE_PROTOCOLS.has(protocol)) {
    return activateCancelOrder(ctx);
  }
  if (protocol === 'getsms-command') {
    return getsmsCancelOrder(ctx);
  }
  if (protocol === 'priemnik') {
    return priemnikCancelOrder(ctx);
  }
  if (protocol === 'juicy-v2') {
    return juicyCancelOrder(ctx);
  }

  return errorPayload(providerKey, 'unsupported_protocol', '协议未实现');
}

module.exports = {
  SCHEMA,
  supportsUnifiedOrders,
  createUnifiedOrder,
  getUnifiedOrderStatus,
  cancelUnifiedOrder,
  PROVIDER_HANDLERS,
};
