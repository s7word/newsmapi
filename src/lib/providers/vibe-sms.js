'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://api.vibe-sms.net/api/v1';

const SERVICE_ALIASES = new Map([
  ['dr', ['dr', 'openai', 'chatgpt']],
  ['tg', ['tg', 'telegram']],
  ['wa', ['wa', 'whatsapp']],
  ['go', ['go', 'google', 'gmail', 'youtube']],
  ['ds', ['ds', 'discord']],
  ['mm', ['mm', 'microsoft']],
  ['tw', ['tw', 'twitter']],
  ['ig', ['ig', 'instagram', 'threads']],
  ['fb', ['fb', 'facebook']],
  ['lf', ['lf', 'tiktok']],
  ['am', ['am', 'amazon']],
  ['wx', ['wx', 'apple']],
]);

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

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveServiceTokens(serviceCode) {
  const normalized = normalizeToken(serviceCode);
  const tokens = new Set([normalized]);
  for (const [key, aliases] of SERVICE_ALIASES.entries()) {
    if (key === normalized || aliases.some((alias) => normalizeToken(alias) === normalized)) {
      aliases.forEach((alias) => tokens.add(normalizeToken(alias)));
      tokens.add(normalizeToken(key));
    }
  }
  return tokens;
}

function entryFieldTokens(entry, key) {
  return [
    normalizeToken(key),
    normalizeToken(entry?.id),
    normalizeToken(entry?.code),
  ].filter(Boolean);
}

function findService(services, serviceCode) {
  if (!services || typeof services !== 'object') return null;
  const primaryToken = normalizeToken(serviceCode);
  if (!primaryToken) return null;

  const aliasTokens = resolveServiceTokens(serviceCode);
  let aliasFieldMatch = null;
  let nameExactMatch = null;
  let nameContainsMatch = null;

  for (const [key, entry] of Object.entries(services)) {
    const fieldTokens = entryFieldTokens(entry, key);

    if (fieldTokens.includes(primaryToken)) {
      return entry;
    }

    if (!aliasFieldMatch && fieldTokens.some((token) => aliasTokens.has(token))) {
      aliasFieldMatch = entry;
    }

    const normalizedName = normalizeToken(entry?.name);
    if (!nameExactMatch && normalizedName && aliasTokens.has(normalizedName)) {
      nameExactMatch = entry;
    }

    if (!nameContainsMatch && normalizedName && primaryToken.length >= 4) {
      for (const token of aliasTokens) {
        if (token.length >= 4 && normalizedName.includes(token)) {
          nameContainsMatch = entry;
          break;
        }
      }
    }
  }

  return aliasFieldMatch || nameExactMatch || nameContainsMatch;
}

function resolveCountryValue(serviceCountryCode, requestCountryCode) {
  const fromService = String(serviceCountryCode || '').trim();
  if (fromService && !/^\d+$/.test(fromService)) {
    return fromService;
  }
  return requestCountryCode;
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const countriesPayload = await getJson(buildUrl(`${API_ROOT}/countries`, {
      api_key: apiKey,
    }), { timeoutMs: 20000 });

    const countryCodes = Array.from(new Set(
      Object.values(countriesPayload?.data || {})
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean),
    ));

    const now = new Date().toISOString();
    const offers = (await mapWithConcurrency(countryCodes, 8, async (countryCode) => {
      try {
        const payload = await getJson(buildUrl(`${API_ROOT}/services/short_term`, {
          api_key: apiKey,
          country: countryCode,
        }), { timeoutMs: 20000 });

        const service = findService(payload?.data, mapping.serviceCode);
        if (!service) return null;

        const price = Number(service.min_price ?? service.price ?? 0);
        const stock = Number(service.count ?? service.data?.count ?? 0);
        if (!Number.isFinite(price)) return null;

        return await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: resolveCountryValue(service.country_code, countryCode),
          countryName: resolveCountryValue(service.country_code, countryCode),
          currency: 'USD',
          tiers: [{
            priceOriginal: price,
            stock: Number.isFinite(stock) ? stock : 0,
            providerRef: String(service.id || service.code || ''),
          }],
          exchangeRateService,
          lastFetchedAt: now,
          metadata: {
            serviceId: service.id || service.code || '',
            serviceName: service.name || '',
            countryCode: countryCode,
          },
        });
      } catch (error) {
        return null;
      }
    })).filter(Boolean);

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
};
