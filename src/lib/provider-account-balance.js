'use strict';

const { getProviderDefinition } = require('../config/providers-catalog');
const {
  getProviderConnectivityMap,
  resolveProviderApiKey,
  saveProviderConnectivityFromTest,
} = require('./settings');
const { testProviderKeySafe } = require('./provider-key-test');

const CONNECTIVITY_STALE_MS = 24 * 60 * 60 * 1000;

function isConnectivityStale(connectivity, now = Date.now()) {
  if (!connectivity) return true;
  const checkedAt = Date.parse(connectivity.checkedAt || '');
  if (!Number.isFinite(checkedAt)) return true;
  return now - checkedAt > CONNECTIVITY_STALE_MS;
}

function connectivityToAccountBalance(connectivity) {
  if (!connectivity) return null;
  return {
    balance: connectivity.balance,
    currency: connectivity.currency,
    countryCount: connectivity.countryCount,
    mode: connectivity.mode,
    ok: connectivity.ok,
  };
}

async function resolveProviderAccountBalance(db, providerKey, options = {}) {
  const { refreshIfStale = true } = options;
  const cached = getProviderConnectivityMap(db)[providerKey] || null;
  if (!isConnectivityStale(cached) || !refreshIfStale) {
    return connectivityToAccountBalance(cached);
  }

  const definition = getProviderDefinition(providerKey);
  if (!definition) return connectivityToAccountBalance(cached);

  const apiKey = resolveProviderApiKey(db, definition.keyEnv);
  if (!apiKey) return connectivityToAccountBalance(cached);

  try {
    const result = await testProviderKeySafe(providerKey, apiKey);
    if (result?.connectivity) {
      saveProviderConnectivityFromTest(db, result);
      return connectivityToAccountBalance(result.connectivity);
    }
  } catch {
    // Prefer the last cached snapshot over a failed live probe.
  }

  return connectivityToAccountBalance(cached);
}

module.exports = {
  CONNECTIVITY_STALE_MS,
  connectivityToAccountBalance,
  isConnectivityStale,
  resolveProviderAccountBalance,
};
