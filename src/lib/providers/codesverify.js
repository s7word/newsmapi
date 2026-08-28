'use strict';

const { buildUrl, createProviderError, getText, makeOffer, parseMaybeJson } = require('./helpers');

const API_ROOT = 'https://api.codesverify.com';
const DEFAULT_COUNTRIES = ['USA'];

const SERVICE_ALIASES = new Map([
  ['telegram', ['telegram', 'tg']],
  ['tg', ['telegram', 'tg']],
  ['openai', ['openai', 'chatgpt']],
  ['chatgpt', ['openai', 'chatgpt']],
  ['whatsapp', ['whatsapp', 'wa']],
  ['google', ['google', 'gmail']],
  ['discord', ['discord']],
  ['microsoft', ['microsoft', 'outlook']],
  ['twitter', ['twitter', 'xtwitter']],
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

function matchesService(appName, serviceCode, nativeName) {
  const app = normalizeAppName(appName);
  if (!app) return false;
  const targets = resolveTargets(serviceCode, nativeName);
  return targets.some((target) => {
    if (!target) return false;
    if (app === target || app.startsWith(target)) return true;
    return target.length >= 4 && app.includes(target);
  });
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
    try {
      return parseRatesPayload(JSON.parse(trimmed));
    } catch (error) {
      if (error.code === 'invalid_key') throw error;
      return [];
    }
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rates)) return payload.rates;
  return [];
}

function collectMatchingTiers(entries, serviceCode, nativeName) {
  const tiers = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const appName = entry?.app || entry?.name || '';
    if (!matchesService(appName, serviceCode, nativeName)) continue;
    const price = Number(entry.rate || entry.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const providerRef = String(appName);
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

async function getBalance(apiKey) {
  const text = await getText(buildUrl(`${API_ROOT}/get_balance.php`, {
    customer: apiKey,
  }), { timeoutMs: 15000 });
  const trimmed = String(text || '').trim();
  if (/customer not found/i.test(trimmed)) {
    throw new Error('Customer Not Found');
  }
  try {
    const payload = JSON.parse(trimmed);
    if (payload?.balance != null) return String(payload.balance);
  } catch {
    // plain text fallback
  }
  return trimmed;
}

async function fetchCountryRates(apiKey, country) {
  const text = await getText(buildUrl(`${API_ROOT}/get_rates.php`, {
    customer: apiKey,
    country,
  }), { timeoutMs: 20000 });
  return parseRatesPayload(parseMaybeJson(text) || text);
}

async function fetchProviderOffers({ mapping, displayName, providerKey, exchangeRateService, apiKey }) {
  const name = displayName || mapping?.displayName || 'CodesVerify';
  const key = providerKey || mapping?.providerKey || 'codesverify';
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping?.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const countries = String(process.env.CODESVERIFY_COUNTRIES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const countryList = countries.length ? countries : DEFAULT_COUNTRIES;
    const nativeName = mapping.nativeServiceName || mapping.serviceCode;
    const now = new Date().toISOString();

    const offers = (await mapWithConcurrency(countryList, 3, async (country) => {
      const entries = await fetchCountryRates(apiKey, country);
      const tiers = collectMatchingTiers(entries, mapping.serviceCode, nativeName);
      if (!tiers.length) return null;
      return makeOffer({
        providerKey: key,
        providerName: name,
        countryValue: country,
        countryName: country,
        currency: 'USD',
        tiers,
        exchangeRateService,
        lastFetchedAt: now,
      });
    })).filter(Boolean);

    if (!offers.length) {
      throw new Error('CodesVerify 未返回可解析的报价（get_rates 无匹配产品，该平台报价以 USA 为主）');
    }

    return {
      providerKey: key,
      providerName: name,
      offers,
      error: '',
    };
  } catch (error) {
    return createProviderError(key, name, error);
  }
}

module.exports = {
  collectMatchingTiers,
  fetchProviderOffers,
  getBalance,
  matchesService,
  parseRatesPayload,
};
