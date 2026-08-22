'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://smscode.net/api/user';
const DEFAULT_COUNTRIES = [
  'USA', 'UK', 'Germany', 'India', 'Malaysia', 'Philippines', 'Canada',
  'France', 'Spain', 'Indonesia', 'Vietnam', 'Thailand', 'Brazil', 'Mexico',
];

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

function matchRateEntry(entries, serviceCode, nativeName) {
  const targets = [
    normalizeAppName(nativeName),
    normalizeAppName(serviceCode),
  ].filter(Boolean);

  for (const entry of entries) {
    const app = normalizeAppName(entry?.app || entry?.name);
    const code = normalizeAppName(entry?.business_code || entry?.code);
    if (targets.some((target) => app.includes(target) || target.includes(app) || code === target)) {
      return entry;
    }
  }
  return null;
}

function parseRatesPayload(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
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

    const offers = (await mapWithConcurrency(countryList, 6, async (country) => {
      try {
        const payload = await getJson(buildUrl(`${API_ROOT}/get_rates.php`, {
          customer: apiKey,
          country,
        }), { timeoutMs: 20000 });

        const entries = parseRatesPayload(payload);
        const matched = matchRateEntry(entries, mapping.serviceCode, nativeName);
        if (!matched) return null;

        const price = Number(matched.rate || matched.price || 0);
        if (!Number.isFinite(price)) return null;

        return await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: country,
          countryName: country,
          currency: 'USD',
          tiers: [{
            priceOriginal: price,
            stock: Number(matched.stock || matched.count || 1),
            providerRef: String(matched.business_code || matched.app || ''),
          }],
          exchangeRateService,
          lastFetchedAt: now,
        });
      } catch (error) {
        return null;
      }
    })).filter(Boolean);

    if (!offers.length) {
      throw new Error('SMSCode 未返回可解析的报价（账户余额或 get_rates 可用性）');
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
  fetchProviderOffers,
};
