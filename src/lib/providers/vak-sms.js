'use strict';

const { fetchActivateCompatibleOffers } = require('./activate-compatible');
const { buildUrl, getMaybeJson } = require('./helpers');

function buildCountryLookup(countriesPayload) {
  if (Array.isArray(countriesPayload)) {
    return new Map(countriesPayload.map((country) => [
      String(country?.id || ''),
      country?.eng || country?.rus || country?.chn || String(country?.id || ''),
    ]).filter(([id]) => id));
  }

  return new Map(Object.entries(countriesPayload || {}).map(([id, country]) => [
    String(id),
    country?.eng || country?.chn || country?.rus || String(id),
  ]));
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  let countryLookup = new Map();
  if (apiKey) {
    try {
      const countriesPayload = await getMaybeJson(buildUrl(mapping.baseUrl, {
        action: 'getCountries',
        api_key: apiKey,
      }));
      countryLookup = buildCountryLookup(countriesPayload);
    } catch (error) {
      countryLookup = new Map();
    }
  }

  return fetchActivateCompatibleOffers({
    providerKey: mapping.providerKey,
    providerName: mapping.displayName,
    baseUrl: mapping.baseUrl,
    apiKey,
    serviceCode: mapping.serviceCode,
    exchangeRateService,
    action: 'getPrices',
    countryLookup,
    currency: 'RUB',
  });
}

module.exports = {
  fetchProviderOffers,
};
