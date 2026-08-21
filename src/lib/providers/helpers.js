'use strict';

const { buildUrl, getJson, getText } = require('../http');
const { createProviderOffer } = require('../model');
const { toCountryInfo } = require('../country-normalizer');

function parseMaybeJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

async function getMaybeJson(url, options = {}) {
  const text = await getText(url, options);
  return parseMaybeJson(text);
}

function sumStocks(tiers) {
  return tiers.reduce((total, tier) => total + Number(tier.stock || 0), 0);
}

async function makeOffer({
  providerKey,
  providerName,
  countryValue,
  countryName,
  currency,
  tiers,
  exchangeRateService,
  lastFetchedAt,
  status,
  errorMessage,
  metadata,
}) {
  const country = toCountryInfo(countryValue, countryName);
  const safeTiers = tiers
    .filter((tier) => Number(tier.stock || 0) >= 0)
    .sort((left, right) => Number(left.priceOriginal || 0) - Number(right.priceOriginal || 0));

  const tiersWithUsd = [];
  for (const tier of safeTiers) {
    let priceUsd = Number(tier.priceUsd || 0);
    if (!priceUsd) {
      try {
        priceUsd = await exchangeRateService.convertToUsd(tier.priceOriginal, currency);
      } catch (error) {
        priceUsd = Number(tier.priceOriginal || 0);
      }
    }
    tiersWithUsd.push({
      priceOriginal: Number(tier.priceOriginal || 0),
      priceUsd,
      stock: Number(tier.stock || 0),
      providerRef: tier.providerRef || '',
    });
  }

  const availableTiers = tiersWithUsd.filter((tier) => tier.stock > 0);
  const minTier = (availableTiers[0] || tiersWithUsd[0] || {
    priceOriginal: 0,
    priceUsd: 0,
  });
  const inventoryTotal = sumStocks(tiersWithUsd);

  return createProviderOffer({
    providerKey,
    providerName,
    countryIso2: country.iso2,
    countryName: country.displayName,
    countryNameEn: country.englishName,
    countryNameZh: country.chineseName,
    countryDisplayName: country.displayName,
    status: status || (inventoryTotal > 0 ? 'in_stock' : 'out_of_stock'),
    currency,
    minPriceOriginal: minTier.priceOriginal,
    minPriceUsd: minTier.priceUsd,
    inventoryTotal,
    tiers: tiersWithUsd,
    lastFetchedAt,
    errorMessage,
    metadata,
  });
}

function createProviderError(providerKey, providerName, error) {
  return {
    providerKey,
    providerName,
    offers: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

async function fetchClassicCountryLookup() {
  const lookup = new Map([['0', 'Russia']]);
  const candidates = [
    {
      url: process.env.HERO_SMS_API_KEY
        ? buildUrl('https://hero-sms.com/stubs/handler_api.php', {
          action: 'getCountries',
          api_key: process.env.HERO_SMS_API_KEY,
        })
        : '',
      parser(payload) {
        for (const [id, country] of Object.entries(payload || {})) {
          lookup.set(String(id), country.eng || country.chn || country.rus || String(id));
        }
      },
    },
    {
      url: process.env.GRIZZLYSMS_API_KEY
        ? buildUrl('https://api.grizzlysms.com/stubs/handler_api.php', {
          action: 'getCountries',
          api_key: process.env.GRIZZLYSMS_API_KEY,
        })
        : '',
      parser(payload) {
        for (const [id, country] of Object.entries(payload || {})) {
          lookup.set(String(id), country.eng || country.chn || country.rus || String(id));
        }
      },
    },
    {
      url: process.env.SMS_VERIFICATION_API_KEY
        ? buildUrl('https://sms-verification-number.com/stubs/handler_api', {
          action: 'getCountryAndOperators',
          api_key: process.env.SMS_VERIFICATION_API_KEY,
          lang: 'en',
        })
        : '',
      parser(payload) {
        for (const country of payload || []) {
          lookup.set(String(country.id), country.name || String(country.id));
        }
      },
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.url) continue;
    try {
      const payload = await getMaybeJson(candidate.url);
      candidate.parser(payload);
    } catch (error) {
      continue;
    }
  }

  return lookup;
}

module.exports = {
  buildUrl,
  createProviderError,
  fetchClassicCountryLookup,
  getJson,
  getMaybeJson,
  makeOffer,
};
