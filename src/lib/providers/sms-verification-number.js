'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

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

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }

    const countriesPayload = await getJson(buildUrl(mapping.baseUrl, {
      api_key: apiKey,
      action: 'getCountryAndOperators',
      lang: 'en',
    }));
    const countries = countriesPayload || [];
    const countryLookup = new Map(countries.map((country) => [String(country.id), country.name]));
    const now = new Date().toISOString();
    const offers = (await mapWithConcurrency(countries, 12, async (country) => {
      try {
        const payload = await getJson(buildUrl(mapping.baseUrl, {
          api_key: apiKey,
          action: 'getServicesAndCost',
          country: country.id,
          operator: 'any',
          service: mapping.serviceCode,
          lang: 'en',
        }));

        const serviceNode = Array.isArray(payload)
          ? payload.find((entry) => String(entry.id).toLowerCase() === String(mapping.serviceCode).toLowerCase())
          : null;
        if (!serviceNode) return null;

        return makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: countryLookup.get(String(country.id)) || String(country.id),
          countryName: countryLookup.get(String(country.id)) || String(country.id),
          currency: 'USD',
          tiers: [{
            priceOriginal: Number(serviceNode.price || 0),
            stock: Number(serviceNode.quantity || 0),
            providerRef: mapping.serviceCode,
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
