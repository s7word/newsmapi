'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://juicysms.com/api/v2';

const JUICY_COUNTRIES = [
  { code: 'UK', iso2: 'GB', name: 'United Kingdom' },
  { code: 'USA', iso2: 'US', name: 'United States' },
  { code: 'NL', iso2: 'NL', name: 'Netherlands' },
  { code: 'PH', iso2: 'PH', name: 'Philippines' },
];

const SERVICE_SEARCH_ALIASES = new Map([
  ['dr', ['openai', 'chatgpt']],
  ['tg', ['telegram']],
  ['wa', ['whatsapp']],
  ['go', ['google']],
  ['ds', ['discord']],
  ['mm', ['microsoft']],
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

function pickService(services, serviceCode) {
  const items = Array.isArray(services) ? services : [];
  if (!items.length) return null;

  const searchTerms = resolveSearchTerms(serviceCode);
  const primaryToken = normalizeToken(serviceCode);

  for (const service of items) {
    const slug = normalizeToken(service?.slug);
    const name = normalizeToken(service?.name);
    if (slug && searchTerms.some((term) => normalizeToken(term) === slug)) {
      return service;
    }
    if (name && searchTerms.some((term) => normalizeToken(term) === name)) {
      return service;
    }
  }

  if (primaryToken === 'go') {
    return items.find((service) => normalizeToken(service?.slug) === 'google')
      || items.find((service) => normalizeToken(service?.name) === 'google')
      || items[0];
  }

  if (primaryToken === 'mm') {
    return items.find((service) => normalizeToken(service?.name).includes('microsoft'))
      || items[0];
  }

  for (const service of items) {
    const slug = normalizeToken(service?.slug);
    const name = normalizeToken(service?.name);
    if (searchTerms.some((term) => {
      const token = normalizeToken(term);
      return token && (slug.includes(token) || name.includes(token));
    })) {
      return service;
    }
  }

  return items.length === 1 ? items[0] : null;
}

function primarySearchTerm(serviceCode) {
  const normalized = normalizeToken(serviceCode);
  const aliases = SERVICE_SEARCH_ALIASES.get(normalized);
  if (aliases?.length) {
    return aliases[0];
  }
  const terms = resolveSearchTerms(serviceCode);
  return terms.find((term) => String(term).length > 2) || terms[0] || String(serviceCode || '');
}

async function juicyJson(path, apiKey, params = {}) {
  return getJson(buildUrl(`${API_ROOT}${path}`, params), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    timeoutMs: 20000,
  });
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const now = new Date().toISOString();
    const offers = [];

    for (const country of JUICY_COUNTRIES) {
      try {
        const payload = await juicyJson('/services', apiKey, {
          country: country.code,
          search: primarySearchTerm(mapping.serviceCode),
        });

        const service = pickService(payload?.data, mapping.serviceCode);
        if (!service?.price?.amount) continue;

        const priceOriginal = Number(service.price.amount);
        if (!Number.isFinite(priceOriginal) || priceOriginal <= 0) continue;

        offers.push(await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: country.iso2,
          countryName: country.name,
          currency: String(service.price.currency || 'EUR').toUpperCase(),
          tiers: [{
            priceOriginal,
            stock: 1,
            providerRef: String(service.id || ''),
          }],
          exchangeRateService,
          lastFetchedAt: now,
          metadata: {
            serviceId: service.id,
            serviceName: service.name || '',
            serviceSlug: service.slug || '',
            juicyCountry: country.code,
          },
        }));
      } catch (error) {
        continue;
      }
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
  fetchProviderOffers,
};
