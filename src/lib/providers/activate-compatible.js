'use strict';

const { createProviderError, buildUrl, getMaybeJson, makeOffer } = require('./helpers');

const ACTIVATE_FAIL = /^(BAD_KEY|ERROR_WRONG_KEY|BAD_ACTION|NO_KEY|BANNED)/i;

function normalizeActivateCountryKey(countryKey) {
  return String(countryKey || '').trim();
}

function parsePricesV3Country(serviceNode) {
  if (!serviceNode || typeof serviceNode !== 'object') return [];

  if ('price' in serviceNode || 'cost' in serviceNode || 'count' in serviceNode) {
    return [{
      priceOriginal: Number(serviceNode.price || serviceNode.cost || 0),
      stock: Number(serviceNode.count || 0),
      providerRef: String(serviceNode.provider_id || ''),
    }];
  }

  return Object.entries(serviceNode)
    .map(([entryKey, entry]) => {
      if (entry && typeof entry === 'object' && ('price' in entry || 'cost' in entry || 'count' in entry)) {
        return {
          priceOriginal: Number(entry.price || entry.cost || 0),
          stock: Number(entry.count || 0),
          providerRef: String(entry.provider_id || entryKey || ''),
        };
      }
      return {
        priceOriginal: Number(entryKey),
        stock: Number(entry || 0),
        providerRef: '',
      };
    })
    .map((entry) => ({
      priceOriginal: Number(entry.priceOriginal || 0),
      stock: Number(entry.stock || 0),
      providerRef: String(entry.providerRef || ''),
    }))
    .filter((tier) => Number.isFinite(tier.priceOriginal) && Number.isFinite(tier.stock));
}

function parseSimplePriceMap(serviceNode) {
  if (!serviceNode || typeof serviceNode !== 'object') return [];
  if ('cost' in serviceNode || 'count' in serviceNode || 'price' in serviceNode) {
    return [{
      priceOriginal: Number(serviceNode.cost || serviceNode.price || 0),
      stock: Number(serviceNode.count || 0),
      providerRef: '',
    }];
  }
  return Object.entries(serviceNode)
    .map(([price, count]) => ({
      priceOriginal: Number(price),
      stock: Number(count || 0),
      providerRef: '',
    }))
    .filter((tier) => Number.isFinite(tier.priceOriginal) && Number.isFinite(tier.stock));
}

function parseActivateTiers(serviceNode, action) {
  const v3 = parsePricesV3Country(serviceNode);
  const simple = parseSimplePriceMap(serviceNode);
  if (action === 'getPricesV3') return v3.length ? v3 : simple;
  return simple.length ? simple : v3;
}

function unwrapPricesPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (payload.prices && typeof payload.prices === 'object' && !Array.isArray(payload.prices)) {
    return payload.prices;
  }
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    && !('cost' in payload.data) && !('price' in payload.data) && !('count' in payload.data)) {
    return payload.data;
  }
  return payload;
}

function assertActivatePayload(payload, action) {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      throw new Error(`Unexpected payload for ${action}`);
    }
    if (ACTIVATE_FAIL.test(trimmed) || /^BAD_/i.test(trimmed)) {
      throw new Error(trimmed === 'BAD_KEY' ? 'API Key 无效 (BAD_KEY)' : trimmed);
    }
    throw new Error(`Unexpected payload for ${action}: ${trimmed.slice(0, 120)}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Unexpected payload for ${action}`);
  }
}

async function fetchActivateCompatibleOffers({
  providerKey,
  providerName,
  baseUrl,
  apiKey,
  serviceCode,
  exchangeRateService,
  action = 'getPricesV3',
  extraParams = {},
  currency = 'USD',
  countryLookup = new Map(),
}) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const rawPayload = await getMaybeJson(buildUrl(baseUrl, {
      api_key: apiKey,
      action,
      service: serviceCode,
      ...extraParams,
    }));

    assertActivatePayload(rawPayload, action);
    const payload = unwrapPricesPayload(rawPayload);
    assertActivatePayload(payload, action);

    const now = new Date().toISOString();
    const offers = [];

    for (const [countryKey, serviceMap] of Object.entries(payload)) {
      const normalizedCountryKey = normalizeActivateCountryKey(countryKey);
      const maybeCountryName = countryLookup.get(normalizedCountryKey) || normalizedCountryKey;
      const serviceNode = typeof serviceMap === 'object' && serviceMap
        ? serviceMap[serviceCode] || serviceMap[String(serviceCode)] || serviceMap
        : null;
      const tiers = parseActivateTiers(serviceNode, action);
      if (!tiers.length) continue;

      offers.push(await makeOffer({
        providerKey,
        providerName,
        countryValue: maybeCountryName,
        countryName: maybeCountryName,
        currency,
        tiers,
        exchangeRateService,
        lastFetchedAt: now,
      }));
    }

    return {
      providerKey,
      providerName,
      offers,
      error: '',
    };
  } catch (error) {
    return createProviderError(providerKey, providerName, error);
  }
}

module.exports = {
  assertActivatePayload,
  fetchActivateCompatibleOffers,
  parseActivateTiers,
  parsePricesV3Country,
  parseSimplePriceMap,
};
