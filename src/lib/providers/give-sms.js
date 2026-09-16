'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');
const countryBySlug = require('./give-sms-countries.json');

const API_ROOT = 'https://give-sms.com/api/v1';

function resolveCountryLabel(slug) {
  const entry = countryBySlug[String(slug || '').trim().toLowerCase()];
  return entry?.label || String(slug || '');
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const payload = await getJson(buildUrl(`${API_ROOT}/`, {
      method: 'getallcount',
      service: mapping.serviceCode,
      userkey: apiKey,
    }), { timeoutMs: 45000 });

    if (Number(payload?.status) === 401) {
      throw new Error('API Key 无效 (401)');
    }
    if (payload?.status && Number(payload.status) !== 200) {
      throw new Error(payload?.data?.msg || `Give SMS API error (${payload.status})`);
    }

    const rows = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : (payload && typeof payload === 'object' && payload.status == null ? payload : null);
    if (!rows || typeof rows !== 'object') {
      throw new Error('Give SMS getallcount returned empty data');
    }

    const now = new Date().toISOString();
    const offers = [];

    for (const [slug, entry] of Object.entries(rows)) {
      const price = Number(entry?.price ?? 0);
      const stock = Number(entry?.count_all ?? 0);
      if (!Number.isFinite(price)) continue;

      const countryMeta = countryBySlug[slug] || {};
      offers.push(await makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: resolveCountryLabel(slug),
        countryName: resolveCountryLabel(slug),
        currency: 'RUB',
        tiers: [{
          priceOriginal: price,
          stock: Number.isFinite(stock) ? stock : 0,
          providerRef: String(mapping.serviceCode || ''),
        }],
        exchangeRateService,
        lastFetchedAt: now,
        metadata: {
          countrySlug: slug,
          activateCountryId: countryMeta.activateId || '',
        },
      }));
    }

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers,
      lastFetchedAt: now,
    };
  } catch (error) {
    return createProviderError(mapping.providerKey, mapping.displayName, error);
  }
}

module.exports = {
  fetchProviderOffers,
};
