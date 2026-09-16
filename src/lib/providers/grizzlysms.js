'use strict';

const { fetchActivateCompatibleOffers } = require('./activate-compatible');
const { buildUrl, getMaybeJson } = require('./helpers');

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  let countryLookup = new Map();
  if (apiKey) {
    try {
      const countriesPayload = await getMaybeJson(buildUrl(mapping.baseUrl, {
        action: 'getCountries',
        api_key: apiKey,
      }));
      countryLookup = new Map(Object.entries(countriesPayload || {}).map(([id, country]) => [
        String(id),
        country.eng || country.chn || country.rus || String(id),
      ]));
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
    action: 'getPricesV3',
    countryLookup,
  });
}

module.exports = {
  fetchProviderOffers,
};
