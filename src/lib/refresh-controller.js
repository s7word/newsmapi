'use strict';

const { buildServiceConfig, listServices } = require('../config/services-catalog');
const {
  completeRefreshEvent,
  getAllProviderSnapshots,
  getAllProviderStates,
  getLatestRefreshEvent,
  getProviderSnapshot,
  insertRefreshEvent,
  saveProviderSnapshot,
  saveProviderState,
  upsertServiceConfig,
} = require('./db');
const { getProvider } = require('./providers');
const { resolveProviderApiKey } = require('./settings');

function createRefreshController({ db, exchangeRateService, refreshCooldownMs, inventoryAlertService = null }) {
  let isRunning = false;
  let lastManualTriggerAt = 0;
  let currentPromise = null;

  function getReusableProviderResult(mapping, serviceKey, reason) {
    const minRefreshIntervalMs = Number(mapping.minRefreshIntervalMs || 0);
    const errorRetryIntervalMs = Number(mapping.errorRetryIntervalMs || 0);
    if (!minRefreshIntervalMs && !errorRetryIntervalMs) return null;

    const state = db.prepare(`
      SELECT status, last_attempted_at, last_success_at
      FROM provider_states
      WHERE provider_key = ? AND service_key = ?
    `).get(mapping.providerKey, serviceKey);
    const lastAttempt = state?.last_attempted_at || state?.last_success_at;
    if (!lastAttempt) return null;

    const effectiveIntervalMs = ['error', 'stale'].includes(state.status) && errorRetryIntervalMs
      ? errorRetryIntervalMs
      : minRefreshIntervalMs;
    if (!effectiveIntervalMs) return null;
    const lastAttemptMs = new Date(lastAttempt).getTime();
    if (!Number.isFinite(lastAttemptMs) || Date.now() - lastAttemptMs >= effectiveIntervalMs) return null;

    const snapshot = getProviderSnapshot(db, mapping.providerKey, serviceKey);
    if (!snapshot?.payload) return null;

    return {
      ...snapshot.payload,
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      skipped: true,
    };
  }

  async function runRefreshForService(serviceKey, reason = 'scheduled') {
    const serviceConfig = buildServiceConfig(serviceKey);
    upsertServiceConfig(db, serviceConfig);
    const eventId = insertRefreshEvent(db, new Date().toISOString());

    try {
      await exchangeRateService.loadUsdRates(reason === 'manual');

      const results = await Promise.all(serviceConfig.providerMappings.map(async (mapping) => {
        if (!mapping.serviceCode) {
          return {
            providerKey: mapping.providerKey,
            providerName: mapping.displayName,
            offers: [],
            error: 'Missing service code mapping',
          };
        }

        const reusableResult = getReusableProviderResult(mapping, serviceKey, reason);
        if (reusableResult) return reusableResult;

        const provider = getProvider(mapping.providerKey);
        const apiKey = resolveProviderApiKey(db, mapping.keyEnv);
        const previousSnapshot = getProviderSnapshot(db, mapping.providerKey, serviceKey);
        const result = await provider.fetchProviderOffers({
          mapping,
          apiKey,
          exchangeRateService,
          previousSnapshot: previousSnapshot?.payload || null,
        });

        const attemptedAt = new Date().toISOString();
        if (result.error) {
          const existing = db.prepare(`
            SELECT last_success_at FROM provider_states
            WHERE provider_key = ? AND service_key = ?
          `).get(mapping.providerKey, serviceKey);
          saveProviderState(db, {
            provider_key: mapping.providerKey,
            service_key: serviceKey,
            status: existing?.last_success_at ? 'stale' : 'error',
            last_attempted_at: attemptedAt,
            last_success_at: existing?.last_success_at || null,
            error_message: result.error,
          });
          return result;
        }

        if (inventoryAlertService?.processProviderRefresh) {
          try {
            await inventoryAlertService.processProviderRefresh({
              serviceKey,
              providerKey: mapping.providerKey,
              providerName: mapping.displayName,
              previousPayload: previousSnapshot?.payload || null,
              newPayload: result,
            });
          } catch (alertError) {
            console.error(
              `Inventory alert failed for ${mapping.providerKey}/${serviceKey}: ${alertError.message}`,
            );
          }
        }

        saveProviderSnapshot(db, mapping.providerKey, result, serviceKey);
        saveProviderState(db, {
          provider_key: mapping.providerKey,
          service_key: serviceKey,
          status: 'success',
          last_attempted_at: attemptedAt,
          last_success_at: attemptedAt,
          error_message: '',
        });
        return result;
      }));

      completeRefreshEvent(db, eventId, 'success', {
        reason,
        serviceKey,
        providers: results.map((result) => ({
          providerKey: result.providerKey,
          error: result.error,
          offerCount: result.offers?.length || 0,
          skipped: Boolean(result.skipped),
        })),
      });
      return { accepted: true, status: 'success', serviceKey };
    } catch (error) {
      completeRefreshEvent(db, eventId, 'error', {
        reason,
        serviceKey,
        error: error.message,
      });
      return { accepted: true, status: 'error', serviceKey, error: error.message };
    }
  }

  async function runRefresh(reason = 'scheduled', serviceKey = null) {
    if (isRunning) {
      return { accepted: false, reason: 'already_running' };
    }

    if (reason === 'manual') {
      const now = Date.now();
      if (now - lastManualTriggerAt < refreshCooldownMs) {
        return {
          accepted: false,
          reason: 'cooldown',
          cooldownRemainingMs: refreshCooldownMs - (now - lastManualTriggerAt),
        };
      }
      lastManualTriggerAt = now;
    }

    isRunning = true;
    try {
      const targets = serviceKey
        ? [serviceKey]
        : listServices().map((service) => service.serviceKey);

      // Scheduled/startup: refresh default OpenAI first for fast first paint, then others.
      const ordered = serviceKey
        ? targets
        : ['openai_chatgpt', ...targets.filter((key) => key !== 'openai_chatgpt')];

      const results = [];
      for (const key of ordered) {
        // On scheduled refresh, only refresh OpenAI every cycle; other services refresh every 5th cycle via time bucket.
        if (reason === 'scheduled' && key !== 'openai_chatgpt') {
          const bucket = Math.floor(Date.now() / Number(process.env.REFRESH_INTERVAL_MS || 60000));
          const refreshEveryCycle = inventoryAlertService?.shouldRefreshServiceEveryCycle?.(key);
          if (!refreshEveryCycle && bucket % 5 !== 0) continue;
        }
        results.push(await runRefreshForService(key, reason));
      }
      return { accepted: true, status: 'success', results };
    } finally {
      isRunning = false;
    }
  }

  function getState(serviceKey = null) {
    return {
      isRunning,
      currentPromise,
      latestEvent: getLatestRefreshEvent(db),
      snapshots: getAllProviderSnapshots(db, serviceKey),
      providerStates: getAllProviderStates(db, serviceKey),
    };
  }

  function refreshAll(reason = 'scheduled', serviceKey = null) {
    currentPromise = runRefresh(reason, serviceKey)
      .finally(() => {
        currentPromise = null;
      });
    return currentPromise;
  }

  function triggerRefresh(reason = 'manual', serviceKey = null) {
    if (isRunning) {
      return { accepted: false, reason: 'already_running' };
    }

    // Kick off async work; do not embed the Promise in the HTTP payload.
    refreshAll(reason, serviceKey);
    return {
      accepted: true,
      status: 'started',
      serviceKey: serviceKey || 'all',
    };
  }

  return {
    getState,
    refreshAll,
    triggerRefresh,
  };
}

module.exports = {
  createRefreshController,
};
