'use strict';

const { fetchActivateCompatibleOffers } = require('./activate-compatible');
const { buildUrl, getMaybeJson } = require('./helpers');

function buildCountryLookup(countriesPayload) {
  if (Array.isArray(countriesPayload)) {
    return new Map(countriesPayload
      .filter((country) => country?.id != null)
      .map((country) => [
        String(country.id),
        country.eng || country.chn || country.rus || String(country.id),
      ]));
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
    } catch {
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
    currency: 'USD',
  });
}

module.exports = {
  fetchProviderOffers,
  buildCountryLookup,
};
