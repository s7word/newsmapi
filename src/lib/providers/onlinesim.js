'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://onlinesim.io/api';

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

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const catalog = await getJson(buildUrl(`${API_ROOT}/getTariffs.php`, {
      apikey: apiKey,
      lang: 'en',
    }), { timeoutMs: 20000 });

    if (String(catalog?.response) !== '1') {
      throw new Error(catalog?.response || 'OnlineSim getTariffs failed');
    }

    const countries = Object.values(catalog.countries || {})
      .filter((country) => country?.enable)
      .map((country) => ({
        dialCode: country.code,
        name: country.name || country.original || String(country.code),
        original: country.original || '',
      }))
      .filter((country) => Number.isFinite(Number(country.dialCode)));

    const now = new Date().toISOString();
    const offers = (await mapWithConcurrency(countries, 10, async (country) => {
      try {
        const payload = await getJson(buildUrl(`${API_ROOT}/getTariffs.php`, {
          apikey: apiKey,
          lang: 'en',
          country: String(country.dialCode),
          filter_service: mapping.serviceCode,
        }), { timeoutMs: 15000 });

        const serviceNode = resolveServiceNode(payload?.services, mapping.serviceCode);
        if (!serviceNode) return null;

        const stock = Number(serviceNode.count || 0);
        const price = Number(serviceNode.price || 0);
        if (!Number.isFinite(price)) return null;

        return await makeOffer({
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
          lastFetchedAt: now,
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
