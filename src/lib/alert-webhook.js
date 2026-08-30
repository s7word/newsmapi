'use strict';

const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./settings');
const { getProviderDefinition, resolvePortalUrl } = require('../config/providers-catalog');
const { getProviderAlertCode } = require('../config/provider-alert-codes');

const WEBHOOK_SETTING_KEY = 'alert_webhook_config';

function defaultWebhookConfig() {
  return {
    enabled: false,
    url: '',
    secret: '',
    timeoutMs: 8000,
    filters: {
      maxPriceUsd: null,
      requireBalance: false,
      minBalance: null,
      alertTypes: ['new_listing', 'restock'],
      providerKeys: null,
      maxItemsPerPush: 50,
    },
  };
}

function normalizeProviderKeys(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeAlertTypes(input) {
  const allowed = new Set(['new_listing', 'restock']);
  const list = Array.isArray(input) ? input : ['new_listing', 'restock'];
  const next = [...new Set(list.map((value) => String(value || '').trim()).filter((value) => allowed.has(value)))];
  return next.length ? next : ['new_listing', 'restock'];
}

function normalizeWebhookConfig(input = {}) {
  const defaults = defaultWebhookConfig();
  const filtersIn = input.filters && typeof input.filters === 'object' ? input.filters : {};
  const maxPriceRaw = filtersIn.maxPriceUsd;
  const maxPriceUsd = maxPriceRaw == null || maxPriceRaw === ''
    ? null
    : Number(maxPriceRaw);
  const minBalanceRaw = filtersIn.minBalance;
  const minBalance = minBalanceRaw == null || minBalanceRaw === ''
    ? null
    : Number(minBalanceRaw);
  const timeoutMs = Number(input.timeoutMs);
  const maxItems = Number(filtersIn.maxItemsPerPush);

  return {
    enabled: Boolean(input.enabled),
    url: String(input.url || '').trim(),
    secret: String(input.secret || '').trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? Math.min(timeoutMs, 30000) : defaults.timeoutMs,
    filters: {
      maxPriceUsd: Number.isFinite(maxPriceUsd) && maxPriceUsd > 0 ? maxPriceUsd : null,
      requireBalance: Boolean(filtersIn.requireBalance),
      minBalance: Number.isFinite(minBalance) && minBalance >= 0 ? minBalance : null,
      alertTypes: normalizeAlertTypes(filtersIn.alertTypes),
      providerKeys: normalizeProviderKeys(filtersIn.providerKeys),
      maxItemsPerPush: Number.isFinite(maxItems) && maxItems > 0 ? Math.min(Math.floor(maxItems), 200) : 50,
    },
  };
}

function getAlertWebhookConfig(db) {
  const stored = getSetting(db, WEBHOOK_SETTING_KEY, null);
  return normalizeWebhookConfig(stored && typeof stored === 'object' ? stored : {});
}

function saveAlertWebhookConfig(db, patch = {}) {
  const current = getAlertWebhookConfig(db);
  const merged = normalizeWebhookConfig({
    ...current,
    ...patch,
    filters: {
      ...current.filters,
      ...(patch.filters && typeof patch.filters === 'object' ? patch.filters : {}),
    },
  });
  setSetting(db, WEBHOOK_SETTING_KEY, merged);
  return merged;
}

function publicWebhookConfig(config) {
  const normalized = normalizeWebhookConfig(config || {});
  return {
    ...normalized,
    secretConfigured: Boolean(normalized.secret),
    secret: normalized.secret ? '********' : '',
  };
}

function parseBalanceNumber(accountBalance) {
  if (!accountBalance) return null;
  const raw = accountBalance.balance;
  if (raw == null || raw === '') return null;
  const value = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(value) ? value : null;
}

function eventPassesWebhookFilters(event, filters, accountBalance) {
  if (!filters.alertTypes.includes(event.type)) return false;
  if (filters.providerKeys && !filters.providerKeys.includes(event.providerKey)) return false;

  const price = Number(event.minPriceUsd);
  if (filters.maxPriceUsd != null) {
    if (!Number.isFinite(price) || price <= 0 || price > filters.maxPriceUsd) return false;
  }

  if (filters.requireBalance || filters.minBalance != null) {
    const balance = parseBalanceNumber(accountBalance);
    if (balance == null) return false;
    if (filters.requireBalance && balance <= 0) return false;
    if (filters.minBalance != null && balance < filters.minBalance) return false;
  }

  return true;
}

function sortEventsByPriceAsc(events) {
  return [...events].sort((a, b) => {
    const priceA = Number(a.minPriceUsd);
    const priceB = Number(b.minPriceUsd);
    const validA = Number.isFinite(priceA) && priceA > 0;
    const validB = Number.isFinite(priceB) && priceB > 0;
    if (validA && validB && priceA !== priceB) return priceA - priceB;
    if (validA && !validB) return -1;
    if (!validA && validB) return 1;
    return String(a.countryIso2 || '').localeCompare(String(b.countryIso2 || ''));
  });
}

function buildSimplifiedWebhookItem(event, {
  providerName = '',
  alertCode = '',
  portalUrl = '',
  accountBalance = null,
} = {}) {
  const balance = parseBalanceNumber(accountBalance);
  return {
    type: event.type,
    country: String(event.countryIso2 || '').toUpperCase(),
    countryName: String(event.countryName || event.countryIso2 || ''),
    priceUsd: Number.isFinite(Number(event.minPriceUsd)) ? Number(event.minPriceUsd) : null,
    currency: String(event.currency || 'USD'),
    stockFrom: Number(event.previousStock || 0),
    stockTo: Number(event.newStock || 0),
    provider: String(providerName || event.providerName || ''),
    providerCode: String(alertCode || ''),
    balance,
    balanceCurrency: accountBalance?.currency || 'USD',
    portalUrl: String(portalUrl || ''),
  };
}

function buildWebhookPayload({
  serviceKey,
  serviceLabel,
  events,
  providerName,
  providerKey,
  accountBalance,
}) {
  const definition = getProviderDefinition(providerKey);
  const alertCode = getProviderAlertCode(providerKey);
  const portalUrl = resolvePortalUrl(definition || { providerKey });
  const displayName = providerName || definition?.displayName || providerKey;
  const items = sortEventsByPriceAsc(events).map((event) => buildSimplifiedWebhookItem(event, {
    providerName: displayName,
    alertCode,
    portalUrl,
    accountBalance,
  }));

  return {
    schema: 'smsall.alert.v1',
    sentAt: new Date().toISOString(),
    serviceKey,
    serviceLabel: serviceLabel || serviceKey,
    itemCount: items.length,
    items,
  };
}

function signWebhookBody(secret, bodyText) {
  const key = String(secret || '').trim();
  if (!key) return '';
  const digest = crypto.createHmac('sha256', key).update(bodyText).digest('hex');
  return `sha256=${digest}`;
}

async function postAlertWebhook({
  config,
  payload,
  fetchImpl = fetch,
}) {
  const normalized = normalizeWebhookConfig(config || {});
  if (!normalized.enabled) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!normalized.url) {
    return { skipped: true, reason: 'url_missing' };
  }
  if (!payload?.items?.length) {
    return { skipped: true, reason: 'no_items' };
  }

  const bodyText = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'smsall-alert-webhook/1.0',
    'X-Smsall-Schema': 'smsall.alert.v1',
  };
  const signature = signWebhookBody(normalized.secret, bodyText);
  if (signature) {
    headers['X-Smsall-Signature'] = signature;
    headers.Authorization = `Bearer ${normalized.secret}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), normalized.timeoutMs);
  try {
    const response = await fetchImpl(normalized.url, {
      method: 'POST',
      headers,
      body: bodyText,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: text.slice(0, 300) || `HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      status: response.status,
      itemCount: payload.itemCount,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.name === 'AbortError' ? 'timeout' : (error.message || 'request_failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

function filterEventsForWebhook(events, config, accountBalance) {
  const normalized = normalizeWebhookConfig(config || {});
  const filtered = sortEventsByPriceAsc(events || [])
    .filter((event) => eventPassesWebhookFilters(event, normalized.filters, accountBalance));
  return filtered.slice(0, normalized.filters.maxItemsPerPush);
}

async function dispatchAlertWebhook({
  db,
  serviceKey,
  serviceLabel,
  providerKey,
  providerName,
  events,
  accountBalance,
  fetchImpl = fetch,
}) {
  const config = getAlertWebhookConfig(db);
  if (!config.enabled) {
    return { skipped: true, reason: 'disabled' };
  }

  const filtered = filterEventsForWebhook(events, config, accountBalance);
  if (!filtered.length) {
    return { skipped: true, reason: 'filtered_out', evaluated: events?.length || 0 };
  }

  const payload = buildWebhookPayload({
    serviceKey,
    serviceLabel,
    events: filtered,
    providerKey,
    providerName,
    accountBalance,
  });

  return postAlertWebhook({ config, payload, fetchImpl });
}

module.exports = {
  WEBHOOK_SETTING_KEY,
  buildSimplifiedWebhookItem,
  buildWebhookPayload,
  defaultWebhookConfig,
  dispatchAlertWebhook,
  eventPassesWebhookFilters,
  filterEventsForWebhook,
  getAlertWebhookConfig,
  normalizeWebhookConfig,
  postAlertWebhook,
  publicWebhookConfig,
  saveAlertWebhookConfig,
  signWebhookBody,
  sortEventsByPriceAsc,
};
