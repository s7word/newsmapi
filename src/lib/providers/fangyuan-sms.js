'use strict';

const { createProviderError, makeOffer } = require('./helpers');
const { request } = require('../http');

const DEFAULT_HOST = 'http://www.getfangyuan.com';
const DEFAULT_PORTS = [8818, 8858, 8868];
/** API prices/balance are in 积分；按 1 积分 = 0.01 CNY（分）换算。 */
const POINTS_PER_CNY = 100;

function normalizePorts(raw) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((port) => Number(port)).filter((port) => Number.isFinite(port) && port > 0);
  }
  const fromEnv = String(process.env.FANGYUAN_SMS_PORTS || '')
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isFinite(port) && port > 0);
  return fromEnv.length ? fromEnv : DEFAULT_PORTS.slice();
}

function resolveBaseUrls(baseUrl) {
  const explicit = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (explicit && !/getfangyuan\.com(?::\d+)?\/?$/i.test(explicit) && /\/api\//i.test(explicit)) {
    return [explicit.replace(/\/api\/openApi\/?$/i, '').replace(/\/+$/, '')];
  }

  const host = explicit && /^https?:\/\//i.test(explicit)
    ? explicit.replace(/:\d+(\/.*)?$/, '').replace(/\/+$/, '')
    : DEFAULT_HOST;
  return normalizePorts().map((port) => `${host}:${port}`);
}

function resolveCredentials(apiKey) {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) {
    throw new Error('Missing API key');
  }

  if (trimmed.includes('|')) {
    const separatorIndex = trimmed.indexOf('|');
    const clientId = trimmed.slice(0, separatorIndex).trim();
    const key = trimmed.slice(separatorIndex + 1).trim();
    if (!clientId || !key) {
      throw new Error('Invalid clientId|apiKey format');
    }
    if (!/^\d+$/.test(clientId)) {
      throw new Error('FangyuanSms clientId 必须是数字用户 ID');
    }
    return { clientId, apiKey: key };
  }

  const clientId = String(process.env.FANGYUAN_CLIENT_ID || '').trim();
  if (!clientId) {
    throw new Error(
      'FangyuanSms 需同时配置 clientId 与 apiKey：设置填写 clientId|apiKey（如 10111|密钥），或环境变量 FANGYUAN_CLIENT_ID + FANGYUAN_SMS_API_KEY。',
    );
  }
  if (!/^\d+$/.test(clientId)) {
    throw new Error('FangyuanSms clientId 必须是数字用户 ID');
  }
  return { clientId, apiKey: trimmed };
}

function assertApiOk(payload, fallbackMessage) {
  const code = payload?.code;
  if (code === 0 || code === '0') return payload;
  const message = String(payload?.msg || payload?.message || fallbackMessage || 'FangyuanSms API error');
  const codeText = code == null ? '' : ` (code=${code})`;
  throw new Error(`${message}${codeText}`);
}

async function postForm(baseRoot, path, fields, timeoutMs = 20000) {
  const url = `${String(baseRoot).replace(/\/+$/, '')}/api/openApi/${String(path || '').replace(/^\//, '')}`;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, String(value));
  }

  const response = await request(url, {
    method: 'POST',
    timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: body.toString(),
  });

  try {
    return JSON.parse(response.text);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${error.message}`);
  }
}

async function apiCall(mapping, credentials, path, fields = {}, timeoutMs = 20000) {
  const roots = resolveBaseUrls(mapping?.baseUrl);
  let lastError = null;

  for (const root of roots) {
    try {
      const payload = await postForm(root, path, {
        clientId: credentials.clientId,
        apiKey: credentials.apiKey,
        ...fields,
      }, timeoutMs);
      assertApiOk(payload, `FangyuanSms ${path} failed`);
      return { payload, root };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // Auth/config errors should not rotate ports forever.
      if (/uid错误|secret错误|未找到用户|用户禁用|参数错误|余额不足|产品不存在/i.test(message)
        || /code=200[2-7]|code=2010|code=2016/i.test(message)) {
        throw error;
      }
    }
  }

  throw lastError || new Error('FangyuanSms 全部端口请求失败');
}

function pointsToCny(points) {
  const value = Number(points);
  if (!Number.isFinite(value)) return 0;
  return value / POINTS_PER_CNY;
}

function normalizePriceRows(data) {
  const list = Array.isArray(data) ? data : [];
  return list
    .map((row) => ({
      productId: Number(row?.pid ?? row?.product_id ?? row?.productId),
      pricePoints: Number(row?.price),
    }))
    .filter((row) => Number.isFinite(row.productId) && row.productId > 0
      && Number.isFinite(row.pricePoints) && row.pricePoints > 0);
}

async function getUserInfo(apiKey, mapping = {}) {
  const credentials = resolveCredentials(apiKey);
  const { payload } = await apiCall(mapping, credentials, 'userInfo');
  const integral = Number(payload?.data?.integral);
  const freezeIntegral = Number(payload?.data?.freezeIntegral);
  return {
    credentials,
    integral: Number.isFinite(integral) ? integral : null,
    freezeIntegral: Number.isFinite(freezeIntegral) ? freezeIntegral : null,
    balanceCny: Number.isFinite(integral) ? pointsToCny(integral) : null,
    raw: payload?.data || {},
  };
}

async function getPrices(apiKey, mapping = {}, productId) {
  const credentials = resolveCredentials(apiKey);
  const fields = {};
  const pid = Number(productId);
  if (Number.isFinite(pid) && pid > 0) {
    fields.product_id = pid;
  }
  const { payload, root } = await apiCall(mapping, credentials, 'getPrice', fields);
  return {
    credentials,
    root,
    rows: normalizePriceRows(payload?.data),
    raw: payload?.data,
  };
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  const providerKey = mapping.providerKey;
  const providerName = mapping.displayName;

  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }

    const serviceCode = String(mapping.serviceCode || '').trim();
    if (!serviceCode) {
      throw new Error('Missing FangyuanSms product_id mapping');
    }

    const productId = Number(serviceCode);
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error(`Invalid FangyuanSms product_id: ${serviceCode}`);
    }

    const { rows, root } = await getPrices(apiKey, mapping, productId);
    const matched = rows.find((row) => row.productId === productId) || null;
    const now = new Date().toISOString();

    if (!matched) {
      return {
        providerKey,
        providerName,
        offers: [],
        error: '',
        meta: {
          root,
          productId,
          note: '账号未开通该产品或未配置价格',
        },
      };
    }

    const priceCny = pointsToCny(matched.pricePoints);
    const offer = await makeOffer({
      providerKey,
      providerName,
      countryValue: '',
      countryName: '全球统一价',
      currency: 'CNY',
      tiers: [{
        priceOriginal: priceCny,
        stock: 1,
        providerRef: `pid:${productId}`,
      }],
      exchangeRateService,
      lastFetchedAt: now,
      status: 'in_stock',
      metadata: {
        productId,
        pricePoints: matched.pricePoints,
        pointsPerCny: POINTS_PER_CNY,
        inventoryUnknown: true,
        pricingScope: 'account_product',
        apiRoot: root,
      },
    });

    return {
      providerKey,
      providerName,
      offers: [offer],
      error: '',
    };
  } catch (error) {
    return createProviderError(providerKey, providerName, error);
  }
}

module.exports = {
  POINTS_PER_CNY,
  DEFAULT_PORTS,
  resolveCredentials,
  resolveBaseUrls,
  pointsToCny,
  getUserInfo,
  getPrices,
  fetchProviderOffers,
  apiCall,
};
