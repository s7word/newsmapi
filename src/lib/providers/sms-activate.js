'use strict';

const { fetchActivateCompatibleOffers } = require('./activate-compatible');
const { buildUrl, getMaybeJson } = require('./helpers');

async function fetchProviderOffers({ mapping, apiKey, exchangeRateService }) {
  let countryLookup = new Map();
  try {
    if (apiKey) {
      const countriesPayload = await getMaybeJson(buildUrl(mapping.baseUrl, {
        action: 'getCountries',
        api_key: apiKey,
      }));
      countryLookup = new Map(Object.entries(countriesPayload || {}).map(([id, country]) => [
        String(id),
        country.eng || country.chn || country.rus || String(id),
      ]));
    }
  } catch {
    countryLookup = new Map();
  }

  return fetchActivateCompatibleOffers({
    providerKey: mapping.providerKey,
    providerName: mapping.displayName,
    baseUrl: mapping.baseUrl,
    apiKey,
    serviceCode: mapping.serviceCode,
    exchangeRateService,
    action: 'getPricesV3',
    currency: 'USD',
    countryLookup,
  });
}

module.exports = {
  fetchProviderOffers,
};
