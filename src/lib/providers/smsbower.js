'use strict';

const { buildUrl, getJson, makeOffer, createProviderError, getMaybeJson } = require('./helpers');

const PUBLIC_PRICES_URL = 'https://smsbower.app/activations/getPricesByService';

async function getCatalog(publicPricesUrl = PUBLIC_PRICES_URL) {
  return getJson(buildUrl(publicPricesUrl, {
    serviceId: 5,
    withPopular: true,
  }));
}

function getServiceMap(catalog) {
  return catalog?.services || {};
}

function resolveService(serviceArg, catalog) {
  const services = Object.values(getServiceMap(catalog));
  const raw = String(serviceArg || '').trim();
  if (!raw) throw new Error('Missing service code mapping');

  const numericId = Number.parseInt(raw, 10);
  if (Number.isFinite(numericId) && getServiceMap(catalog)[numericId]) {
    return getServiceMap(catalog)[numericId];
  }

  const normalized = raw.toLowerCase();
  const matched = services.find((service) => {
    const code = String(service.activate_org_code || '').trim().toLowerCase();
    const slug = String(service.slug || '').trim().toLowerCase();
    const title = String(service.title || '').trim().toLowerCase();
    return code === normalized || slug === normalized || title === normalized;
  });
  if (!matched) {
    throw new Error(`Service not found: ${serviceArg}`);
  }
  return matched;
}

async function getServicePriceSheet(serviceId, publicPricesUrl = PUBLIC_PRICES_URL) {
  return getJson(buildUrl(publicPricesUrl, {
    serviceId,
    withPopular: true,
  }));
}

function normalizeTier(position) {
  return {
    priceOriginal: Number(position?.price || 0),
    stock: Number(position?.count || 0),
    providerRef: Array.isArray(position?.agent_ids)
      ? position.agent_ids.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite).join(',')
      : '',
  };
}

function extractCountriesForService(sheet, serviceId) {
  const countriesMap = sheet?.services?.[String(serviceId)]?.countries || sheet?.services?.[serviceId]?.countries || {};
  return Object.values(countriesMap).map((country) => ({
    id: Number(country.id),
    apiCountryCode: Number.parseInt(country.activate_org_code, 10) || Number(country.id),
    iso: String(country.iso || '').trim().toUpperCase(),
    title: String(country.title || '').trim(),
    count: Number(country.count || 0),
    minPrice: Number(country.min_price || 0),
    rate: Number(country.rate || 0),
    tiers: Object.values(country.positions || {})
      .map(normalizeTier)
      .sort((left, right) => left.priceOriginal - right.priceOriginal || right.stock - left.stock),
  }));
}

async function callApi(apiKey, params, baseUrl = 'https://smsbower.page/stubs/handler_api.php') {
  const payload = await getMaybeJson(buildUrl(baseUrl, {
    api_key: apiKey,
    ...params,
  }));
  return payload;
}

async function fetchProviderOffers({ mapping, exchangeRateService }) {
  try {
    const catalog = await getCatalog(mapping.publicPricesUrl || PUBLIC_PRICES_URL);
    const service = resolveService(mapping.serviceCode, catalog);
    const sheet = await getServicePriceSheet(service.id, mapping.publicPricesUrl || PUBLIC_PRICES_URL);
    const countries = extractCountriesForService(sheet, service.id);
    const now = new Date().toISOString();

    const offers = [];
    for (const country of countries) {
      offers.push(await makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: country.iso,
        countryName: country.title,
        currency: 'USD',
        tiers: country.tiers,
        exchangeRateService,
        lastFetchedAt: now,
      }));
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
  PUBLIC_PRICES_URL,
  callApi,
  extractCountriesForService,
  fetchProviderOffers,
  getCatalog,
  getServiceMap,
  getServicePriceSheet,
  resolveService,
};
