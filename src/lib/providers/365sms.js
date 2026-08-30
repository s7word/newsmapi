'use strict';

const { fetchActivateCompatibleOffers } = require('./activate-compatible');
const { buildUrl, getMaybeJson } = require('./helpers');

const SMS_ACTIVATE_COUNTRIES_URL = 'https://hero-sms.com/stubs/handler_api.php';

let cachedCountryLookup = null;
let cachedCountryLookupAt = 0;
const COUNTRY_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;

function buildCountryLookup(countriesPayload) {
  return new Map(Object.entries(countriesPayload || {}).map(([id, country]) => [
    String(id),
    country?.eng || country?.chn || country?.rus || String(id),
  ]));
}

async function loadSmsActivateCountryLookup() {
  const now = Date.now();
  if (cachedCountryLookup && now - cachedCountryLookupAt < COUNTRY_LOOKUP_TTL_MS) {
    return cachedCountryLookup;
  }

  try {
    const countriesPayload = await getMaybeJson(buildUrl(SMS_ACTIVATE_COUNTRIES_URL, {
      action: 'getCountries',
    }));
    cachedCountryLookup = buildCountryLookup(countriesPayload);
    cachedCountryLookupAt = now;
    return cachedCountryLookup;
  } catch (error) {
    return cachedCountryLookup || new Map();
  }
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  const countryLookup = await loadSmsActivateCountryLookup();

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
