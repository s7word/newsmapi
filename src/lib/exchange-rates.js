'use strict';

const { getJson } = require('./http');
const { getExchangeRates, saveExchangeRates } = require('./db');

function createExchangeRateService({ db, rateUrl }) {
  async function loadUsdRates(forceRefresh = false) {
    const cached = getExchangeRates(db, 'USD');
    if (!forceRefresh && cached) {
      return cached.payload;
    }

    try {
      const payload = await getJson(rateUrl);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Empty exchange rate payload');
      }
      saveExchangeRates(db, 'USD', payload);
      return payload;
    } catch (error) {
      if (cached) {
        return cached.payload;
      }
      throw error;
    }
  }

  async function convertToUsd(amount, currency) {
    const safeAmount = Number(amount || 0);
    const normalizedCurrency = String(currency || 'USD').toUpperCase();
    if (normalizedCurrency === 'USD') return safeAmount;

    const payload = await loadUsdRates(false);
    const rates = payload?.rates || {};
    const rateFromUsd = Number(rates[normalizedCurrency]);
    if (!Number.isFinite(rateFromUsd) || rateFromUsd <= 0) {
      throw new Error(`Missing exchange rate for ${normalizedCurrency}`);
    }
    return safeAmount / rateFromUsd;
  }

  return {
    convertToUsd,
    loadUsdRates,
  };
}

module.exports = {
  createExchangeRateService,
};
