'use strict';

const { fetchActivateCompatibleOffers } = require('./activate-compatible');
const { buildUrl, getMaybeJson } = require('./helpers');

const PRICE_ACTIONS = ['getPricesV3', 'getPrices'];

function isFatalActivateError(message) {
  return /BAD_KEY|NO_KEY|ERROR_WRONG_KEY|Missing API key/i.test(String(message || ''));
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  let countryLookup = new Map();
  if (apiKey) {
    try {
      const countriesPayload = await getMaybeJson(buildUrl(mapping.baseUrl, {
        action: 'getCountries',
        api_key: apiKey,
      }));
      if (countriesPayload && typeof countriesPayload === 'object' && !Array.isArray(countriesPayload)) {
        countryLookup = new Map(Object.entries(countriesPayload).map(([id, country]) => [
          String(id),
          country.eng || country.chn || country.rus || String(id),
        ]));
      }
    } catch (error) {
      countryLookup = new Map();
    }
  }

  let lastSuccess = null;
  let lastError = null;

  for (const action of PRICE_ACTIONS) {
    const result = await fetchActivateCompatibleOffers({
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      baseUrl: mapping.baseUrl,
      apiKey,
      serviceCode: mapping.serviceCode,
      exchangeRateService,
      action,
      countryLookup,
    });

    if (!result.error) {
      if (result.offers?.length) return result;
      lastSuccess = result;
      continue;
    }

    lastError = result;
    if (isFatalActivateError(result.error)) return result;
  }

  return lastSuccess || lastError || {
    providerKey: mapping.providerKey,
    providerName: mapping.displayName,
    offers: [],
    error: 'Unexpected payload for getPrices',
  };
}

module.exports = {
  fetchProviderOffers,
};
