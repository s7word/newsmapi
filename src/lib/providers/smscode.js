'use strict';

const { buildUrl, createProviderError, getText, makeOffer, parseMaybeJson } = require('./helpers');

const API_ROOT = 'https://smscode.net/api/user';
const DEFAULT_COUNTRIES = [
  'USA', 'UK', 'Germany', 'India', 'Malaysia', 'Philippines', 'Canada',
  'France', 'Spain', 'Indonesia', 'Vietnam', 'Thailand', 'Brazil', 'Mexico',
];

const SERVICE_ALIASES = new Map([
  ['telegram', ['telegram', 'tg']],
  ['tg', ['telegram', 'tg']],
  ['openai', ['openai', 'chatgpt']],
  ['chatgpt', ['openai', 'chatgpt']],
  ['whatsapp', ['whatsapp', 'wa']],
  ['google', ['google', 'gmail']],
  ['discord', ['discord']],
  ['microsoft', ['microsoft', 'outlook']],
  ['twitter', ['twitter']],
  ['instagram', ['instagram']],
  ['facebook', ['facebook']],
  ['tiktok', ['tiktok']],
  ['amazon', ['amazon']],
  ['apple', ['apple']],
]);

async function mapWithConcurrency(items, limit, iteratee) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeAppName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveTargets(serviceCode, nativeName) {
  const seeds = [nativeName, serviceCode].map(normalizeAppName).filter(Boolean);
  const targets = new Set(seeds);
  for (const seed of seeds) {
    for (const alias of SERVICE_ALIASES.get(seed) || []) {
      targets.add(normalizeAppName(alias));
    }
  }
  return [...targets].filter(Boolean);
}

function matchesRateEntry(entry, serviceCode, nativeName) {
  const targets = resolveTargets(serviceCode, nativeName);
  const app = normalizeAppName(entry?.app || entry?.name);
  const code = normalizeAppName(entry?.business_code || entry?.code);
  if (!app && !code) return false;
  return targets.some((target) => (
    code === target
    || app === target
    || (app && (app.startsWith(target) || app.includes(target) || target.includes(app)))
  ));
}

function matchRateEntry(entries, serviceCode, nativeName) {
  const list = Array.isArray(entries) ? entries : [];
  return list.find((entry) => matchesRateEntry(entry, serviceCode, nativeName)) || null;
}

function collectMatchingTiers(entries, serviceCode, nativeName) {
  const tiers = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!matchesRateEntry(entry, serviceCode, nativeName)) continue;
    const price = Number(entry.rate || entry.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const providerRef = String(entry.business_code || entry.app || entry.name || '');
    const dedupeKey = `${normalizeAppName(providerRef)}:${price}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const stockRaw = entry.stock ?? entry.count ?? entry.quantity;
    tiers.push({
      priceOriginal: price,
      stock: Number.isFinite(Number(stockRaw)) ? Number(stockRaw) : 1,
      providerRef,
    });
  }
  return tiers.sort((left, right) => left.priceOriginal - right.priceOriginal);
}

function parseRatesPayload(payload) {
  if (payload == null) return [];
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return [];
    if (/customer not found/i.test(trimmed)) {
      const error = new Error('Customer Not Found（API Key 无效）');
      error.code = 'invalid_key';
      throw error;
    }
    if (/country not found/i.test(trimmed)) return [];
    try {
      return parseRatesPayload(JSON.parse(trimmed));
    } catch (error) {
      if (error.code === 'invalid_key') throw error;
      return [];
    }
  }
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rates)) return payload.rates;
  if (Array.isArray(payload)) return payload;
  if (payload?.data && typeof payload.data === 'object') {
    const nested = payload.data.rates || payload.data.apps || payload.data.list;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function classifyRatesError(error, country) {
  const message = String(error?.message || error || '');
  const body = String(error?.body || '');
  if (/customer not found/i.test(`${message} ${body}`)) {
    return 'Customer Not Found（API Key 无效）';
  }
  if (Number(error?.statusCode) === 500 || /HTTP 500/i.test(message)) {
    return `SMSCode get_rates.php 返回 HTTP 500（国家 ${country}，厂商接口故障）`;
  }
  return message || `SMSCode get_rates 失败（${country}）`;
}

async function fetchCountryRates(apiKey, country) {
  const url = buildUrl(`${API_ROOT}/get_rates.php`, {
    customer: apiKey,
    country,
  });
  const text = await getText(url, { timeoutMs: 20000 });
  return parseRatesPayload(parseMaybeJson(text) || text);
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const countries = String(process.env.SMSCODE_COUNTRIES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const countryList = countries.length ? countries : DEFAULT_COUNTRIES;
    const nativeName = mapping.nativeServiceName || mapping.serviceCode;
    const now = new Date().toISOString();
    const countryErrors = [];

    const offers = (await mapWithConcurrency(countryList, 4, async (country) => {
      try {
        const entries = await fetchCountryRates(apiKey, country);
        const tiers = collectMatchingTiers(entries, mapping.serviceCode, nativeName);
        if (!tiers.length) return null;

        return await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: country,
          countryName: country,
          currency: 'USD',
          tiers,
          exchangeRateService,
          lastFetchedAt: now,
        });
      } catch (error) {
        if (/Customer Not Found/i.test(error.message)) {
          throw error;
        }
        countryErrors.push(classifyRatesError(error, country));
        return null;
      }
    })).filter(Boolean);

    if (!offers.length) {
      const uniqueErrors = [...new Set(countryErrors)];
      if (uniqueErrors.some((message) => /Customer Not Found/i.test(message))) {
        throw new Error('Customer Not Found（API Key 无效）');
      }
      if (uniqueErrors.some((message) => /HTTP 500/i.test(message))) {
        throw new Error(uniqueErrors.find((message) => /HTTP 500/i.test(message)));
      }
      if (uniqueErrors.length === countryList.length) {
        throw new Error(uniqueErrors[0] || 'SMSCode get_rates 全部国家请求失败');
      }
      throw new Error('SMSCode 未返回可解析的报价（无匹配产品或 get_rates 为空）');
    }

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers,
      error: '',
    };
  } catch (error) {
    return createProviderError(mapping.providerKey, mapping.displayName, error);
  }
}

module.exports = {
  collectMatchingTiers,
  fetchProviderOffers,
  matchRateEntry,
  parseRatesPayload,
};
