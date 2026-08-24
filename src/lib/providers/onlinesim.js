'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://onlinesim.io/api';
const RATE_LIMIT_RE = /INTERVAL_CONCURRENT_REQUESTS_ERROR/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveInt(name, fallback) {
  if (process.env[name] == null || process.env[name] === '') return fallback;
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

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

function resolveServiceNode(services, serviceCode) {
  if (!services || typeof services !== 'object') return null;
  const normalized = String(serviceCode || '').trim().toLowerCase();
  const direct = services[`_${normalized}`] || services[normalized];
  if (direct) return direct;
  return Object.values(services).find((entry) => {
    const slug = String(entry?.slug || '').trim().toLowerCase();
    return slug === normalized;
  }) || null;
}

async function getTariffsWithRetry(params, { timeoutMs = 20000 } = {}) {
  const retries = readPositiveInt('ONLINESIM_RATES_RETRIES', 3);
  const delayMs = readPositiveInt('ONLINESIM_RATES_DELAY_MS', 400);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const payload = await getJson(buildUrl(`${API_ROOT}/getTariffs.php`, params), { timeoutMs });
      const response = String(payload?.response || '');
      if (RATE_LIMIT_RE.test(response)) {
        lastError = new Error(response);
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (RATE_LIMIT_RE.test(error.message) && attempt < retries) {
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('INTERVAL_CONCURRENT_REQUESTS_ERROR');
}

function countryFromCatalog(country, fallbackCode) {
  return {
    dialCode: Number(country?.code ?? fallbackCode),
    name: country?.name || country?.original || String(country?.code ?? fallbackCode),
    original: country?.original || '',
  };
}

async function buildOffer({
  mapping,
  exchangeRateService,
  country,
  serviceNode,
  lastFetchedAt,
}) {
  const stock = Number(serviceNode.count || 0);
  const price = Number(serviceNode.price || 0);
  if (!Number.isFinite(price)) return null;
  return makeOffer({
    providerKey: mapping.providerKey,
    providerName: mapping.displayName,
    countryValue: country.name,
    countryName: country.name,
    currency: 'USD',
    tiers: [{
      priceOriginal: price,
      stock: Number.isFinite(stock) ? stock : 0,
      providerRef: String(serviceNode.slug || serviceNode.id || ''),
    }],
    exchangeRateService,
    lastFetchedAt,
  });
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const catalog = await getTariffsWithRetry({
      apikey: apiKey,
      lang: 'en',
    });

    if (String(catalog?.response) !== '1') {
      throw new Error(catalog?.response || 'OnlineSim getTariffs failed');
    }

    const countries = Object.values(catalog.countries || {})
      .filter((country) => country?.enable)
      .map((country) => countryFromCatalog(country))
      .filter((country) => Number.isFinite(Number(country.dialCode)));

    const now = new Date().toISOString();
    const offers = [];
    const seenCountries = new Set();

    const defaultService = resolveServiceNode(catalog.services, mapping.serviceCode);
    if (defaultService) {
      const defaultCode = Number(catalog.country);
      const defaultMeta = countries.find((country) => Number(country.dialCode) === defaultCode)
        || countryFromCatalog({ code: defaultCode, name: String(catalog.country || 'USA') }, defaultCode);
      const offer = await buildOffer({
        mapping,
        exchangeRateService,
        country: defaultMeta,
        serviceNode: defaultService,
        lastFetchedAt: now,
      });
      if (offer) {
        offers.push(offer);
        seenCountries.add(String(defaultMeta.dialCode));
      }
    }

    const concurrency = readPositiveInt('ONLINESIM_RATES_CONCURRENCY', 2);
    const delayMs = readPositiveInt('ONLINESIM_RATES_DELAY_MS', 400);
    const remaining = countries.filter((country) => !seenCountries.has(String(country.dialCode)));
    const countryErrors = [];

    const extraOffers = await mapWithConcurrency(remaining, concurrency, async (country) => {
      if (delayMs) await sleep(delayMs);
      try {
        const payload = await getTariffsWithRetry({
          apikey: apiKey,
          lang: 'en',
          country: String(country.dialCode),
          filter_service: mapping.serviceCode,
        }, { timeoutMs: 15000 });

        if (RATE_LIMIT_RE.test(String(payload?.response || ''))) {
          countryErrors.push('INTERVAL_CONCURRENT_REQUESTS_ERROR');
          return null;
        }

        const serviceNode = resolveServiceNode(payload?.services, mapping.serviceCode);
        if (!serviceNode) return null;
        return buildOffer({
          mapping,
          exchangeRateService,
          country,
          serviceNode,
          lastFetchedAt: now,
        });
      } catch (error) {
        if (RATE_LIMIT_RE.test(error.message)) {
          countryErrors.push('INTERVAL_CONCURRENT_REQUESTS_ERROR');
        }
        return null;
      }
    });

    offers.push(...extraOffers.filter(Boolean));

    if (!offers.length && countryErrors.some((message) => RATE_LIMIT_RE.test(message))) {
      throw new Error('INTERVAL_CONCURRENT_REQUESTS_ERROR');
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
  resolveServiceNode,
};
