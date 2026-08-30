'use strict';

const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./settings');
const { getProviderDefinition, resolvePortalUrl } = require('../config/providers-catalog');
const { getProviderAlertCode } = require('../config/provider-alert-codes');

const WEBHOOK_SETTING_KEY = 'alert_webhook_config';
const WEBHOOK_STATUS_KEY = 'alert_webhook_last_push';

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
    sniper: {
      enabled: false,
      // Per-country sniper ceiling: [{ country: 'IR', maxPriceUsd: 0.9 }, ...]
      targets: [],
      // Derived / legacy alias of target countries.
      countries: [],
      requireBalance: true,
      minBalance: null,
      // Legacy global ceiling; kept for migration only.
      maxPriceUsd: null,
      alertTypes: ['new_listing', 'restock'],
      providerKeys: null,
    },
  };
}

function defaultWebhookStatus() {
  return {
    lastPushAt: null,
    lastPushSource: null,
    lastPushOk: null,
    lastPushItemCount: 0,
    lastPushError: '',
    lastManualPushAt: null,
    lastSniperPushAt: null,
    lastSniperItemCount: 0,
  };
}

function getAlertWebhookStatus(db) {
  const stored = getSetting(db, WEBHOOK_STATUS_KEY, null);
  return {
    ...defaultWebhookStatus(),
    ...(stored && typeof stored === 'object' ? stored : {}),
  };
}

function saveAlertWebhookStatus(db, patch = {}) {
  const next = {
    ...getAlertWebhookStatus(db),
    ...patch,
  };
  setSetting(db, WEBHOOK_STATUS_KEY, next);
  return next;
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

function normalizeCountryList(input) {
  if (input == null) return [];
  const raw = Array.isArray(input)
    ? input
    : String(input).split(/[,;\s|/]+/);
  return [...new Set(
    raw
      .map((value) => String(value || '').trim().toUpperCase())
      .filter((value) => /^[A-Z]{2}$/.test(value)),
  )];
}

function normalizeSniperTargets(input = {}, legacyCountries = [], legacyMaxPriceUsd = null) {
  const byCountry = new Map();

  function upsert(countryRaw, maxPriceRaw) {
    const country = String(countryRaw || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return;
    const maxPriceUsd = maxPriceRaw == null || maxPriceRaw === ''
      ? null
      : Number(maxPriceRaw);
    byCountry.set(country, {
      country,
      maxPriceUsd: Number.isFinite(maxPriceUsd) && maxPriceUsd > 0 ? maxPriceUsd : null,
    });
  }

  if (Array.isArray(input)) {
    for (const row of input) {
      if (typeof row === 'string') {
        upsert(row, legacyMaxPriceUsd);
      } else if (row && typeof row === 'object') {
        upsert(row.country || row.iso2 || row.code, row.maxPriceUsd ?? row.maxPrice ?? row.price);
      }
    }
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [country, value] of Object.entries(input)) {
      if (value && typeof value === 'object') {
        upsert(country, value.maxPriceUsd ?? value.maxPrice ?? value.price);
      } else {
        upsert(country, value);
      }
    }
  }

  // Migrate legacy countries[] + single maxPriceUsd into the table.
  for (const country of normalizeCountryList(legacyCountries)) {
    if (!byCountry.has(country)) {
      upsert(country, legacyMaxPriceUsd);
    }
  }

  return [...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country));
}

function normalizeSniperConfig(input = {}, filters = {}) {
  const defaults = defaultWebhookConfig().sniper;
  const legacyMaxPriceRaw = input.maxPriceUsd;
  const legacyMaxPriceUsd = legacyMaxPriceRaw == null || legacyMaxPriceRaw === ''
    ? null
    : Number(legacyMaxPriceRaw);
  const legacyMax = Number.isFinite(legacyMaxPriceUsd) && legacyMaxPriceUsd > 0
    ? legacyMaxPriceUsd
    : (filters.maxPriceUsd != null ? filters.maxPriceUsd : null);
  const minBalanceRaw = input.minBalance;
  const minBalance = minBalanceRaw == null || minBalanceRaw === ''
    ? null
    : Number(minBalanceRaw);

  const hasExplicitTargets = Array.isArray(input.targets) || (input.targets && typeof input.targets === 'object');
  const targets = normalizeSniperTargets(
    input.targets,
    hasExplicitTargets ? [] : input.countries,
    hasExplicitTargets ? null : legacyMax,
  );

  return {
    enabled: Boolean(input.enabled),
    targets,
    countries: targets.map((row) => row.country),
    // Sniper defaults to requiring balance so only funded platforms fire auto-actions.
    requireBalance: input.requireBalance == null ? true : Boolean(input.requireBalance),
    minBalance: Number.isFinite(minBalance) && minBalance >= 0
      ? minBalance
      : (filters.minBalance != null ? filters.minBalance : defaults.minBalance),
    // Kept for backward-compatible reads; per-country targets take precedence.
    maxPriceUsd: legacyMax,
    alertTypes: normalizeAlertTypes(input.alertTypes || filters.alertTypes),
    providerKeys: normalizeProviderKeys(
      input.providerKeys === undefined ? filters.providerKeys : input.providerKeys,
    ),
  };
}

function normalizeWebhookConfig(input = {}) {
  const defaults = defaultWebhookConfig();
  const filtersIn = input.filters && typeof input.filters === 'object' ? input.filters : {};
  const sniperIn = input.sniper && typeof input.sniper === 'object' ? input.sniper : {};
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

  const filters = {
    maxPriceUsd: Number.isFinite(maxPriceUsd) && maxPriceUsd > 0 ? maxPriceUsd : null,
    requireBalance: Boolean(filtersIn.requireBalance),
    minBalance: Number.isFinite(minBalance) && minBalance >= 0 ? minBalance : null,
    alertTypes: normalizeAlertTypes(filtersIn.alertTypes),
    providerKeys: normalizeProviderKeys(filtersIn.providerKeys),
    maxItemsPerPush: Number.isFinite(maxItems) && maxItems > 0 ? Math.min(Math.floor(maxItems), 200) : 50,
  };

  return {
    enabled: Boolean(input.enabled),
    url: String(input.url || '').trim(),
    secret: String(input.secret || '').trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? Math.min(timeoutMs, 30000) : defaults.timeoutMs,
    filters,
    sniper: normalizeSniperConfig(sniperIn, filters),
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
    sniper: {
      ...current.sniper,
      ...(patch.sniper && typeof patch.sniper === 'object' ? patch.sniper : {}),
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

function getSniperTarget(event, sniper) {
  if (!sniper?.enabled) return null;
  const targets = Array.isArray(sniper.targets) ? sniper.targets : [];
  if (!targets.length) return null;
  const country = String(event.countryIso2 || event.country || '').toUpperCase();
  return targets.find((row) => row.country === country) || null;
}

function isSniperCountryWatched(event, sniper) {
  return Boolean(getSniperTarget(event, sniper));
}

/** @deprecated use isSniperCountryWatched / getSniperTarget */
function isSniperCountryHit(event, sniper) {
  return isSniperCountryWatched(event, sniper);
}

function eventPassesSniperBalanceAndType(event, sniper, accountBalance) {
  return eventPassesWebhookFilters(event, {
    alertTypes: sniper.alertTypes,
    providerKeys: sniper.providerKeys,
    maxPriceUsd: null, // price checked per-country
    requireBalance: sniper.requireBalance,
    minBalance: sniper.minBalance,
  }, accountBalance);
}

/**
 * Sniper tag only when watched country AND price <= that country's maxPriceUsd.
 * Over-ceiling watched countries are still notifiable, but without sniper tag.
 */
function eventPassesSniperRules(event, sniper, accountBalance) {
  const target = getSniperTarget(event, sniper);
  if (!target) return false;
  if (!eventPassesSniperBalanceAndType(event, sniper, accountBalance)) return false;
  const price = Number(event.minPriceUsd);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (target.maxPriceUsd == null) return true;
  return price <= target.maxPriceUsd;
}

function isWatchedCountryOverSniperPrice(event, sniper, accountBalance) {
  const target = getSniperTarget(event, sniper);
  if (!target) return false;
  if (!eventPassesSniperBalanceAndType(event, sniper, accountBalance)) return false;
  const price = Number(event.minPriceUsd);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (target.maxPriceUsd == null) return false;
  return price > target.maxPriceUsd;
}

function annotateSniperEvents(events, config, accountBalance) {
  const normalized = normalizeWebhookConfig(config || {});
  return (events || []).map((event) => {
    const balance = event.accountBalance || accountBalance;
    const target = getSniperTarget(event, normalized.sniper);
    const sniper = eventPassesSniperRules(event, normalized.sniper, balance);
    const watchedOverPrice = isWatchedCountryOverSniperPrice(event, normalized.sniper, balance);
    return {
      ...event,
      sniper,
      sniperWatched: Boolean(target),
      sniperMaxPriceUsd: target?.maxPriceUsd ?? null,
      sniperOverPrice: watchedOverPrice,
      tags: sniper
        ? [...new Set([...(Array.isArray(event.tags) ? event.tags : []), 'sniper'])]
        : (Array.isArray(event.tags) ? event.tags : []),
    };
  });
}

function eventNotifiedMs(event) {
  const raw = event?.notifiedAt || event?.notified_at || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
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

/** Prefer newest alerts first, then cheaper price — used when truncating to maxItemsPerPush. */
function sortEventsLatestThenPrice(events) {
  return [...events].sort((a, b) => {
    const timeDiff = eventNotifiedMs(b) - eventNotifiedMs(a);
    if (timeDiff !== 0) return timeDiff;
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
  const sniper = Boolean(event.sniper);
  const tags = Array.isArray(event.tags)
    ? [...new Set(event.tags.map((tag) => String(tag || '').trim()).filter(Boolean))]
    : [];
  if (sniper && !tags.includes('sniper')) tags.push('sniper');

  return {
    type: event.type,
    country: String(event.countryIso2 || '').toUpperCase(),
    countryName: String(event.countryName || event.countryIso2 || ''),
    priceUsd: Number.isFinite(Number(event.minPriceUsd)) ? Number(event.minPriceUsd) : null,
    currency: String(event.currency || 'USD'),
    stockFrom: Number(event.previousStock || 0),
    stockTo: Number(event.newStock || 0),
    provider: String(providerName || event.providerName || ''),
    providerKey: String(event.providerKey || ''),
    providerCode: String(alertCode || ''),
    balance,
    balanceCurrency: accountBalance?.currency || 'USD',
    portalUrl: String(portalUrl || ''),
    sniper,
    sniperWatched: Boolean(event.sniperWatched),
    sniperMaxPriceUsd: event.sniperMaxPriceUsd == null ? null : Number(event.sniperMaxPriceUsd),
    sniperOverPrice: Boolean(event.sniperOverPrice),
    tags,
    priority: sniper ? 'sniper' : 'normal',
  };
}

function buildWebhookPayload({
  serviceKey,
  serviceLabel,
  events,
  providerName,
  providerKey,
  accountBalance,
  source = 'auto',
  sortMode = 'price',
  sniper = false,
}) {
  const definition = providerKey ? getProviderDefinition(providerKey) : null;
  const alertCode = providerKey ? getProviderAlertCode(providerKey) : '';
  const portalUrl = resolvePortalUrl(definition || { providerKey });
  const displayName = providerName || definition?.displayName || providerKey || '';
  const sorted = sortMode === 'latest'
    ? sortEventsLatestThenPrice(events)
    : sortEventsByPriceAsc(events);
  const items = sorted.map((event) => {
    const eventProviderKey = event.providerKey || providerKey;
    const eventDefinition = eventProviderKey ? getProviderDefinition(eventProviderKey) : null;
    const eventName = event.providerName
      || eventDefinition?.displayName
      || displayName
      || eventProviderKey
      || '';
    const eventBalance = event.accountBalance || accountBalance;
    return buildSimplifiedWebhookItem(event, {
      providerName: eventName,
      alertCode: getProviderAlertCode(eventProviderKey) || alertCode,
      portalUrl: resolvePortalUrl(eventDefinition || { providerKey: eventProviderKey }) || portalUrl,
      accountBalance: eventBalance,
    });
  });

  const payload = {
    schema: 'smsall.alert.v1',
    sentAt: new Date().toISOString(),
    serviceKey,
    serviceLabel: serviceLabel || serviceKey,
    source,
    itemCount: items.length,
    items,
  };

  if (sniper || source === 'sniper' || items.some((item) => item.sniper)) {
    payload.sniper = true;
    payload.sniperItemCount = items.filter((item) => item.sniper).length;
  }

  return payload;
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
  if (payload?.sniper || payload?.source === 'sniper') {
    headers['X-Smsall-Sniper'] = '1';
    headers['X-Smsall-Priority'] = 'sniper';
  }
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

function filterEventsForWebhook(events, config, accountBalance, {
  sortMode = 'latest',
} = {}) {
  const normalized = normalizeWebhookConfig(config || {});
  const passed = (events || []).filter((event) => {
    const balance = event.accountBalance || accountBalance;
    if (eventPassesWebhookFilters(event, normalized.filters, balance)) return true;
    // Watched sniper country over its sniper ceiling: still notify, but no sniper tag.
    const annotated = annotateSniperEvents([event], normalized, balance)[0];
    return Boolean(annotated?.sniperOverPrice);
  });
  const sorted = sortMode === 'price'
    ? sortEventsByPriceAsc(passed)
    : sortEventsLatestThenPrice(passed);
  // Prefer keeping sniper-tagged / watched items when truncating.
  const preferred = sortMode === 'latest'
    ? [...sorted].sort((a, b) => {
      const aScore = (a.sniper ? 2 : 0) + (a.sniperWatched || a.sniperOverPrice ? 1 : 0);
      const bScore = (b.sniper ? 2 : 0) + (b.sniperWatched || b.sniperOverPrice ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return 0;
    })
    : sorted;
  // Re-sort preferred by latest/price while keeping preference as soft priority via stable partition
  const sniperFirst = preferred.filter((e) => e.sniper || e.sniperOverPrice || e.sniperWatched);
  const rest = preferred.filter((e) => !(e.sniper || e.sniperOverPrice || e.sniperWatched));
  const ordered = [
    ...(sortMode === 'price' ? sortEventsByPriceAsc(sniperFirst) : sortEventsLatestThenPrice(sniperFirst)),
    ...(sortMode === 'price' ? sortEventsByPriceAsc(rest) : sortEventsLatestThenPrice(rest)),
  ];
  return ordered.slice(0, normalized.filters.maxItemsPerPush);
}

function loadRecentAlertEvents(db, {
  serviceKey = 'telegram',
  lookbackMinutes = 60,
  fetchLimit = 500,
} = {}) {
  const minutes = Number(lookbackMinutes);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.floor(minutes), 24 * 60) : 60;
  const limit = Number(fetchLimit);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 2000) : 500;
  const sinceIso = new Date(Date.now() - safeMinutes * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT id, service_key, provider_key, country_iso2, alert_type, notified_at, payload_json
    FROM inventory_alert_log
    WHERE service_key = ?
      AND notified_at >= ?
    ORDER BY id DESC
    LIMIT ?
  `).all(serviceKey, sinceIso, safeLimit);

  return rows.map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload_json || '{}');
    } catch {
      payload = {};
    }
    return {
      type: payload.type || row.alert_type,
      providerKey: payload.providerKey || row.provider_key,
      providerName: payload.providerName || '',
      countryIso2: payload.countryIso2 || row.country_iso2,
      countryName: payload.countryName || row.country_iso2,
      previousStock: Number(payload.previousStock || 0),
      newStock: Number(payload.newStock || 0),
      minPriceUsd: Number(payload.minPriceUsd),
      minPriceOriginal: Number(payload.minPriceOriginal || payload.minPriceUsd || 0),
      currency: payload.currency || 'USD',
      notifiedAt: row.notified_at,
      alertLogId: row.id,
    };
  });
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
  source = 'auto',
}) {
  const config = getAlertWebhookConfig(db);
  if (!config.enabled) {
    return { skipped: true, reason: 'disabled' };
  }

  const stamped = annotateSniperEvents((events || []).map((event) => ({
    ...event,
    notifiedAt: event.notifiedAt || new Date().toISOString(),
  })), config, accountBalance);

  const sniperHits = stamped.filter((event) => event.sniper);
  let sniperResult = { skipped: true, reason: 'no_sniper_hits' };

  // Dedicated high-priority push for sniper countries — not truncated by maxItemsPerPush.
  if (sniperHits.length && config.sniper.enabled) {
    const sniperPayload = buildWebhookPayload({
      serviceKey,
      serviceLabel,
      events: sortEventsLatestThenPrice(sniperHits),
      providerKey,
      providerName,
      accountBalance,
      source: 'sniper',
      sortMode: 'latest',
      sniper: true,
    });
    sniperPayload.note = '狙击命中：有余额平台上的狙击国家补货/上新，请上游优先自动处理';
    sniperResult = await postAlertWebhook({ config, payload: sniperPayload, fetchImpl });
    if (db) {
      saveAlertWebhookStatus(db, {
        lastPushAt: new Date().toISOString(),
        lastPushSource: 'sniper',
        lastPushOk: Boolean(sniperResult?.ok),
        lastPushItemCount: Number(sniperResult?.itemCount || sniperHits.length || 0),
        lastPushError: sniperResult?.ok ? '' : String(sniperResult?.error || sniperResult?.reason || ''),
        lastSniperPushAt: new Date().toISOString(),
        lastSniperItemCount: sniperHits.length,
      });
    }
  }

  const filtered = filterEventsForWebhook(stamped, config, accountBalance, { sortMode: 'latest' });
  // Ensure sniper hits still appear in normal batch when they also pass filters.
  const filteredAnnotated = annotateSniperEvents(filtered, config, accountBalance);

  if (!filteredAnnotated.length && !(sniperHits.length && sniperResult?.ok)) {
    return {
      skipped: true,
      reason: filtered.length ? 'filtered_out' : 'filtered_out',
      evaluated: events?.length || 0,
      sniper: sniperResult,
      sniperHits: sniperHits.length,
    };
  }

  let normalResult = { skipped: true, reason: 'no_items' };
  if (filteredAnnotated.length) {
    const payload = buildWebhookPayload({
      serviceKey,
      serviceLabel,
      events: filteredAnnotated,
      providerKey,
      providerName,
      accountBalance,
      source,
      sortMode: 'latest',
    });

    normalResult = await postAlertWebhook({ config, payload, fetchImpl });
    if (db) {
      saveAlertWebhookStatus(db, {
        lastPushAt: new Date().toISOString(),
        lastPushSource: source,
        lastPushOk: Boolean(normalResult?.ok),
        lastPushItemCount: Number(normalResult?.itemCount || filteredAnnotated.length || 0),
        lastPushError: normalResult?.ok ? '' : String(normalResult?.error || normalResult?.reason || ''),
      });
    }
  }

  const ok = Boolean(normalResult?.ok || sniperResult?.ok);
  return {
    ok,
    status: normalResult?.status || sniperResult?.status,
    itemCount: filteredAnnotated.length,
    evaluated: events?.length || 0,
    sniperHits: sniperHits.length,
    sniper: sniperResult,
    normal: normalResult,
    error: ok ? undefined : (normalResult?.error || sniperResult?.error),
  };
}

async function pushLatestAlertWebhook({
  db,
  serviceKey = 'telegram',
  lookbackMinutes = 60,
  fetchImpl = fetch,
  resolveAccountBalance,
}) {
  const config = getAlertWebhookConfig(db);
  if (!config.url) {
    return { ok: false, skipped: true, reason: 'url_missing', message: 'Webhook URL 未配置' };
  }

  const recent = loadRecentAlertEvents(db, { serviceKey, lookbackMinutes });
  if (!recent.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'no_recent_alerts',
      message: `最近 ${lookbackMinutes} 分钟内没有告警日志可推送`,
      lookbackMinutes,
      evaluated: 0,
    };
  }

  const balanceCache = new Map();
  async function balanceFor(providerKey) {
    if (balanceCache.has(providerKey)) return balanceCache.get(providerKey);
    let balance = null;
    if (typeof resolveAccountBalance === 'function') {
      try {
        balance = await resolveAccountBalance(providerKey);
      } catch {
        balance = null;
      }
    }
    balanceCache.set(providerKey, balance);
    return balance;
  }

  const withBalances = [];
  for (const event of recent) {
    const accountBalance = await balanceFor(event.providerKey);
    withBalances.push({ ...event, accountBalance });
  }

  const filtered = filterEventsForWebhook(withBalances, config, null, { sortMode: 'latest' });
  const annotated = annotateSniperEvents(filtered, config, null);
  if (!annotated.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'filtered_out',
      message: '最近告警全部被当前过滤规则拦截（单价/余额/平台/类型），没有可推送条目',
      lookbackMinutes,
      evaluated: recent.length,
      filters: config.filters,
    };
  }

  const serviceLabel = serviceKey === 'telegram' ? 'Telegram 接码' : serviceKey;
  const payload = buildWebhookPayload({
    serviceKey,
    serviceLabel,
    events: annotated,
    source: 'manual_latest',
    sortMode: 'latest',
  });
  payload.manual = true;
  payload.note = `手动推送最近 ${lookbackMinutes} 分钟内、通过过滤的最新 ${annotated.length} 条（优先最新，其次低价；狙击国家已打标）`;
  payload.lookbackMinutes = lookbackMinutes;
  payload.evaluated = recent.length;

  const delivery = await postAlertWebhook({
    config: {
      ...config,
      enabled: true,
    },
    payload,
    fetchImpl,
  });

  const status = saveAlertWebhookStatus(db, {
    lastPushAt: new Date().toISOString(),
    lastPushSource: 'manual_latest',
    lastPushOk: Boolean(delivery?.ok),
    lastPushItemCount: Number(delivery?.itemCount || annotated.length || 0),
    lastPushError: delivery?.ok ? '' : String(delivery?.error || delivery?.reason || ''),
    lastManualPushAt: new Date().toISOString(),
  });

  return {
    ok: Boolean(delivery?.ok),
    httpStatus: delivery?.status,
    error: delivery?.error,
    itemCount: annotated.length,
    sniperItemCount: annotated.filter((row) => row.sniper).length,
    evaluated: recent.length,
    lookbackMinutes,
    status,
    preview: payload.items.slice(0, 8),
  };
}

module.exports = {
  WEBHOOK_SETTING_KEY,
  WEBHOOK_STATUS_KEY,
  annotateSniperEvents,
  buildSimplifiedWebhookItem,
  buildWebhookPayload,
  defaultWebhookConfig,
  defaultWebhookStatus,
  dispatchAlertWebhook,
  eventPassesSniperRules,
  eventPassesWebhookFilters,
  filterEventsForWebhook,
  getAlertWebhookConfig,
  getAlertWebhookStatus,
  getSniperTarget,
  isSniperCountryHit,
  isSniperCountryWatched,
  isWatchedCountryOverSniperPrice,
  loadRecentAlertEvents,
  normalizeCountryList,
  normalizeSniperConfig,
  normalizeSniperTargets,
  normalizeWebhookConfig,
  postAlertWebhook,
  publicWebhookConfig,
  pushLatestAlertWebhook,
  saveAlertWebhookConfig,
  saveAlertWebhookStatus,
  signWebhookBody,
  sortEventsByPriceAsc,
  sortEventsLatestThenPrice,
};
