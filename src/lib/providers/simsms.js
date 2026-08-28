'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://simsms.org/priemnik.php';

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

function parseCountries(payload) {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((country) => ({
      code: String(country?.code || '').trim().toUpperCase(),
      name: String(country?.name || country?.code || '').trim(),
    }))
    .filter((country) => country.code);
}

function findPriceEntry(entries, serviceCode) {
  const normalized = String(serviceCode || '').trim().toLowerCase();
  if (!Array.isArray(entries)) return null;
  return entries.find((entry) => String(entry?.Service || '').trim().toLowerCase() === normalized) || null;
}

async function priemnikRequest(apiKey, params) {
  return getJson(buildUrl(API_ROOT, {
    apikey: apiKey,
    ...params,
  }), { timeoutMs: 20000 });
}

async function loadCountries(apiKey) {
  const configured = String(process.env.SIMSMS_COUNTRIES || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  if (configured.length) {
    return configured.map((code) => ({ code, name: code }));
  }

  const payload = await priemnikRequest(apiKey, { metod: 'get_countries' });
  return parseCountries(payload);
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const countries = await loadCountries(apiKey);
    const concurrency = Math.max(1, Number(process.env.SIMSMS_RATES_CONCURRENCY || 6));
    const now = new Date().toISOString();

    const offers = (await mapWithConcurrency(countries, concurrency, async (country) => {
      try {
        const pricesPayload = await priemnikRequest(apiKey, {
          metod: 'get_prices',
          country: country.code,
        });

        const priceEntry = findPriceEntry(pricesPayload, mapping.serviceCode);
        if (!priceEntry) return null;

        const price = Number(priceEntry.Price || 0);
        if (!Number.isFinite(price) || price <= 0) return null;

        let stock = 1;
        try {
          const countPayload = await priemnikRequest(apiKey, {
            metod: 'get_count_new',
            service: mapping.serviceCode,
            country: country.code,
          });
          const online = Number(countPayload?.online);
          if (Number.isFinite(online)) {
            stock = online;
          }
        } catch (error) {
          stock = 1;
        }

        return await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: country.code,
          countryName: country.name || country.code,
          currency: 'USD',
          tiers: [{
            priceOriginal: price,
            stock,
            providerRef: String(priceEntry.Service || mapping.serviceCode),
          }],
          exchangeRateService,
          lastFetchedAt: now,
          metadata: {
            serviceCode: priceEntry.Service || mapping.serviceCode,
            serviceName: priceEntry.ServiceName || '',
            countryCode: country.code,
          },
        });
      } catch (error) {
        return null;
      }
    })).filter(Boolean);

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
