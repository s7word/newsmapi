'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://app.cyberyozh.com/api/v1';
const DEFAULT_PROVIDER = 'virtual';
const DEFAULT_PERIOD = 'MIN_15';
const PAGE_SIZE = 100;
const MAX_PAGES = 40;

const SEARCH_TERMS = new Map([
  ['dr', 'openai'],
  ['tg', 'telegram'],
  ['wa', 'whatsapp'],
  ['go', 'google'],
  ['ds', 'discord'],
  ['mm', 'microsoft'],
  ['tw', 'twitter'],
  ['ig', 'instagram'],
  ['fb', 'facebook'],
  ['lf', 'tiktok'],
  ['am', 'amazon'],
  ['wx', 'apple'],
]);

function apiHeaders(apiKey) {
  return {
    Accept: 'application/json',
    'X-Api-Key': apiKey,
  };
}

function normalizeServiceCode(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveSearchTerm(serviceCode) {
  const normalized = normalizeServiceCode(serviceCode);
  if (SEARCH_TERMS.has(normalized)) {
    return SEARCH_TERMS.get(normalized);
  }
  return String(serviceCode || '').trim();
}

function parseStockCount(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);

  const match = raw.match(/^([<>])(\d+(?:\.\d+)?)(k)?$/i);
  if (!match) return 1;

  let amount = Number(match[2]);
  if (match[3]) amount *= 1000;
  if (match[1] === '<') return Math.max(1, Math.floor(amount) - 1);
  return Math.max(1, Math.ceil(amount));
}

async function fetchAllSearchResults(apiKey, serviceCode) {
  const searchTerm = resolveSearchTerm(serviceCode);
  const targetCode = normalizeServiceCode(serviceCode);
  const matched = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const payload = await getJson(buildUrl(`${API_ROOT}/numbers/search/`, {
      provider: DEFAULT_PROVIDER,
      period: DEFAULT_PERIOD,
      service_name: searchTerm,
      page,
      page_size: PAGE_SIZE,
    }), {
      headers: apiHeaders(apiKey),
      timeoutMs: 30000,
    });

    const rows = Array.isArray(payload?.results) ? payload.results : [];
    for (const row of rows) {
      if (normalizeServiceCode(row?.service_code) === targetCode) {
        matched.push(row);
      }
    }

    if (!payload?.next) break;
    page += 1;
  }

  return matched;
}

async function loadCountryLookup(apiKey) {
  const payload = await getJson(`${API_ROOT}/numbers/countries/`, {
    headers: apiHeaders(apiKey),
    timeoutMs: 20000,
  });
  const lookup = new Map();
  if (!Array.isArray(payload)) return lookup;

  for (const entry of payload) {
    const code = String(entry?.code || '').trim();
    const name = String(entry?.name || '').trim();
    if (code) lookup.set(code, name || code);
  }
  return lookup;
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const countryLookup = await loadCountryLookup(apiKey);
    const rows = await fetchAllSearchResults(apiKey, mapping.serviceCode);
    const now = new Date().toISOString();

    const offers = (await Promise.all(rows.map(async (row) => {
      const countryCode = String(row?.country_code || '').trim();
      const countryName = countryLookup.get(countryCode) || countryCode;
      const price = Number(row?.price ?? 0);
      const stock = parseStockCount(row?.count);

      if (!Number.isFinite(price)) return null;

      return await makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: countryName,
        countryName,
        currency: 'USD',
        tiers: [{
          priceOriginal: price,
          stock,
          providerRef: String(row?.service_code || ''),
        }],
        exchangeRateService,
        lastFetchedAt: now,
        metadata: {
          countryCode,
          serviceCode: row?.service_code || '',
          serviceName: row?.service_name || '',
          provider: row?.provider || DEFAULT_PROVIDER,
          period: row?.period || DEFAULT_PERIOD,
        },
      });
    }))).filter(Boolean);

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers,
      lastFetchedAt: now,
    };
  } catch (error) {
    throw createProviderError(mapping, error);
  }
}

module.exports = {
  fetchProviderOffers,
  resolveSearchTerm,
  parseStockCount,
};
