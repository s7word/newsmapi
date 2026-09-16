'use strict';

const { createProviderError, makeOffer } = require('./helpers');
const { request } = require('../http');

const API_ROOT = 'https://api.smspva.com';

async function getJson(url, apiKey) {
  const response = await request(url, {
    headers: { apikey: apiKey, Accept: 'application/json' },
    timeoutMs: 30000,
  });
  return JSON.parse(response.text);
}

function pickOperators(operators = []) {
  const list = Array.isArray(operators) ? operators : [];
  const total = list.find((entry) => /^Total_/i.test(String(entry?.opcode || '')));
  if (total) return [total];
  return list;
}

function sumStock(operators) {
  return operators.reduce((sum, entry) => sum + Number(entry?.count || 0), 0);
}

function minPrice(operators) {
  const prices = operators
    .map((entry) => Number(entry?.price))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!prices.length) {
    const fallback = operators.map((entry) => Number(entry?.price)).filter(Number.isFinite);
    return fallback.length ? Math.min(...fallback) : 0;
  }
  return Math.min(...prices);
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const payload = await getJson(
      `${API_ROOT}/activation/serviceprices/${encodeURIComponent(mapping.serviceCode)}`,
      apiKey,
    );

    if (Number(payload?.statusCode) !== 200) {
      throw new Error(payload?.message || `SMSPVA status ${payload?.statusCode || 'unknown'}`);
    }

    const countryList = payload?.data?.clist || [];
    const now = new Date().toISOString();
    const offers = [];

    for (const country of countryList) {
      const operators = pickOperators(country?.opers);
      if (!operators.length) continue;

      const stock = sumStock(operators);
      const price = minPrice(operators);
      offers.push(await makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: country.cname || country.ccode,
        countryName: country.cname || country.ccode,
        currency: 'USD',
        tiers: [{
          priceOriginal: price,
          stock: stock,
          providerRef: operators.map((entry) => entry.opcode).join(','),
        }],
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
  fetchProviderOffers,
};
