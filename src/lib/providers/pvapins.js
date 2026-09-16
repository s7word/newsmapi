'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://api.pvapins.com/user/api';

const SERVICE_SEARCH_ALIASES = new Map([
  ['dr', ['openai', 'chatgpt']],
  ['tg', ['telegram']],
  ['wa', ['whatsapp']],
  ['go', ['google', 'gmail', 'youtube']],
  ['ds', ['discord']],
  ['mm', ['microsoft', 'outlook', 'azure']],
  ['tw', ['twitter']],
  ['ig', ['instagram']],
  ['fb', ['facebook']],
  ['lf', ['tiktok']],
  ['am', ['amazon']],
  ['wx', ['apple']],
]);

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveSearchTerms(serviceCode) {
  const normalized = normalizeToken(serviceCode);
  const terms = new Set([String(serviceCode || '').trim().toLowerCase()]);
  if (normalized) terms.add(normalized);
  const aliases = SERVICE_SEARCH_ALIASES.get(normalized);
  if (aliases) {
    aliases.forEach((alias) => terms.add(alias.toLowerCase()));
  }
  return [...terms].filter(Boolean);
}

function matchesService(appName, serviceCode) {
  const normalizedApp = normalizeToken(appName);
  if (!normalizedApp) return false;

  const primary = normalizeToken(serviceCode);
  const terms = resolveSearchTerms(serviceCode);

  if (primary === 'dr') {
    return /^openai/.test(normalizedApp) || normalizedApp.includes('chatgpt');
  }
  if (primary === 'tg') {
    return /^telegram/.test(normalizedApp);
  }
  if (primary === 'wa') {
    return /^whatsapp/.test(normalizedApp);
  }
  if (primary === 'go') {
    if (/^gmail/.test(normalizedApp)) return true;
    if (normalizedApp === 'google') return true;
    if (/^google/.test(normalizedApp)
      && !normalizedApp.includes('googlepay')
      && !normalizedApp.includes('googleads')) {
      return true;
    }
    return normalizedApp.includes('youtube');
  }
  if (primary === 'ds') return /^discord/.test(normalizedApp);
  if (primary === 'mm') {
    return /^microsoft/.test(normalizedApp)
      || /^outlook/.test(normalizedApp)
      || /^azure/.test(normalizedApp);
  }
  if (primary === 'tw') {
    return /^twitter/.test(normalizedApp) || normalizedApp === 'x';
  }
  if (primary === 'ig') return /^instagram/.test(normalizedApp);
  if (primary === 'fb') return /^facebook/.test(normalizedApp);
  if (primary === 'lf') return /^tiktok/.test(normalizedApp);
  if (primary === 'am') return /^amazon/.test(normalizedApp);
  if (primary === 'wx') return /^apple/.test(normalizedApp);

  return terms.some((term) => {
    const token = normalizeToken(term);
    return token && (normalizedApp === token || normalizedApp.startsWith(token));
  });
}

function parseRatesPayload(payload) {
  if (typeof payload === 'string' && /not found/i.test(payload)) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function collectMatchingTiers(entries, serviceCode) {
  const tiers = [];
  const seen = new Set();

  for (const entry of entries) {
    const appName = entry?.app || entry?.name || '';
    if (!matchesService(appName, serviceCode)) continue;

    const price = Number(entry?.rate || entry?.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;

    const providerRef = String(entry?.app_id || entry?.app || '');
    const dedupeKey = providerRef || normalizeToken(appName);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    tiers.push({
      priceOriginal: price,
      stock: Number(entry?.stock || entry?.count || 1),
      providerRef,
    });
  }

  return tiers.sort((left, right) => left.priceOriginal - right.priceOriginal);
}

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

async function loadCountries() {
  const payload = await getJson(`${API_ROOT}/load_countries.php`, { timeoutMs: 30000 });
  if (!Array.isArray(payload)) return [];
  return payload
    .map((country) => ({
      id: country?.id,
      name: String(country?.full_name || '').trim(),
    }))
    .filter((country) => country.name);
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const configuredCountries = String(process.env.PVAPINS_COUNTRIES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const countries = configuredCountries.length
      ? configuredCountries.map((name) => ({ name }))
      : await loadCountries();

    const concurrency = Math.max(1, Number(process.env.PVAPINS_RATES_CONCURRENCY || 6));
    const now = new Date().toISOString();

    const offers = (await mapWithConcurrency(countries, concurrency, async (country) => {
      try {
        const payload = await getJson(buildUrl(`${API_ROOT}/get_rates.php`, {
          customer: apiKey,
          country: country.name,
        }), { timeoutMs: 20000 });

        const tiers = collectMatchingTiers(parseRatesPayload(payload), mapping.serviceCode);
        if (!tiers.length) return null;

        return await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: country.name,
          countryName: country.name,
          currency: 'USD',
          tiers,
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
