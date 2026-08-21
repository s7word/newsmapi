'use strict';

const { createProviderError, buildUrl, getMaybeJson, makeOffer } = require('./helpers');

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
  if ('cost' in serviceNode || 'count' in serviceNode) {
    return [{
      priceOriginal: Number(serviceNode.cost || 0),
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

    const payload = await getMaybeJson(buildUrl(baseUrl, {
      api_key: apiKey,
      action,
      service: serviceCode,
      ...extraParams,
    }));

    if (!payload || typeof payload !== 'object') {
      throw new Error(`Unexpected payload for ${action}`);
    }

    const now = new Date().toISOString();
    const offers = [];

    for (const [countryKey, serviceMap] of Object.entries(payload)) {
      const normalizedCountryKey = normalizeActivateCountryKey(countryKey);
      const maybeCountryName = countryLookup.get(normalizedCountryKey) || normalizedCountryKey;
      const serviceNode = typeof serviceMap === 'object' && serviceMap
        ? serviceMap[serviceCode] || serviceMap[String(serviceCode)] || serviceMap
        : null;
      const tiers = action === 'getPricesV3'
        ? parsePricesV3Country(serviceNode)
        : parseSimplePriceMap(serviceNode);
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
  fetchActivateCompatibleOffers,
};
