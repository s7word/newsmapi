'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://getsms.online/api_command.php';

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveCredentials(apiKey) {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) {
    throw new Error('Missing API key');
  }

  if (trimmed.includes('|')) {
    const separatorIndex = trimmed.indexOf('|');
    const user = trimmed.slice(0, separatorIndex).trim();
    const key = trimmed.slice(separatorIndex + 1).trim();
    if (!user || !key) {
      throw new Error('Invalid user|api_key format');
    }
    return { user, apiKey: key };
  }

  const user = String(process.env.GETSMS_USER || '').trim();
  if (!user) {
    throw new Error(
      'GetSMS 需同时配置用户名/邮箱与 API Key：设置填写 user|api_key（如 you@mail.com|密钥），或环境变量 GETSMS_USER + GETSMS_API_KEY。仅填写 Key 无法通过鉴权，该平台没有公开报价接口。',
    );
  }

  return { user, apiKey: trimmed };
}

async function apiCommand(cmd, credentials, params = {}) {
  const payload = await getJson(buildUrl(API_ROOT, {
    cmd,
    user: credentials.user,
    api_key: credentials.apiKey,
    ...params,
  }), { timeoutMs: 30000 });

  if (String(payload?.status) === 'error') {
    const message = String(payload?.message || 'GetSMS API error');
    if (/unauthorized/i.test(message)) {
      throw new Error('Unauthorized (check GETSMS_USER and API key)');
    }
    throw new Error(message);
  }

  return payload?.message;
}

function pickServiceEntry(entries, serviceName) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;

  const target = normalizeToken(serviceName);
  const exact = list.find((entry) => normalizeToken(entry?.name) === target);
  if (exact) return exact;

  const partial = list.find((entry) => {
    const name = normalizeToken(entry?.name);
    return name && (name.includes(target) || target.includes(name));
  });
  return partial || list[0];
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    const credentials = resolveCredentials(apiKey);
    const serviceName = String(
      mapping.nativeServiceName || mapping.serviceCode || '',
    ).trim();
    if (!serviceName) {
      throw new Error('Missing service name mapping');
    }

    const message = await apiCommand('list_services', credentials, {
      service: serviceName,
    });

    const entry = pickServiceEntry(message, serviceName);
    if (!entry) {
      return {
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        offers: [],
        error: '',
      };
    }

    const price = Number(entry.price);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        offers: [],
        error: '',
      };
    }

    const stock = Number(entry.otp_available);
    const now = new Date().toISOString();
    const offer = await makeOffer({
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      countryValue: 'US',
      countryName: 'United States',
      currency: 'USD',
      tiers: [{
        priceOriginal: price,
        stock: Number.isFinite(stock) ? stock : 1,
        providerRef: String(entry.name || serviceName),
      }],
      exchangeRateService,
      lastFetchedAt: now,
      metadata: {
        serviceName: entry.name || serviceName,
        otpAvailable: entry.otp_available,
        ltrAvailable: entry.ltr_available,
        recommendedMarkup: entry.recommended_markup,
      },
    });

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers: [offer],
      error: '',
    };
  } catch (error) {
    return createProviderError(mapping.providerKey, mapping.displayName, error);
  }
}

module.exports = {
  fetchProviderOffers,
  resolveCredentials,
};
