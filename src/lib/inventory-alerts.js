'use strict';

const { diffProviderOffers } = require('./offer-diff');
const {
  formatInventoryAlertLines,
  sendTelegramMessage,
  splitTelegramMessages,
} = require('./telegram-notifier');
const {
  listTelegramAlertRecipients,
  resolveTelegramNotifyChatIds,
  sendTelegramBroadcast,
} = require('./telegram-recipients');
const { getSetting, setSetting } = require('./settings');
const { getProviderDefinition, resolvePortalUrl } = require('../config/providers-catalog');
const { getProviderAlertCode } = require('../config/provider-alert-codes');
const { resolveProviderAccountBalance } = require('./provider-account-balance');

const ALERT_TYPE_LABELS = {
  new_listing: '新上架',
  restock: '补货',
};

function parseServiceKeys(raw) {
  const values = String(raw || 'telegram')
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(values);
}

function isInventoryAlertEnabled(db = null) {
  const enabled = String(process.env.TELEGRAM_ALERT_ENABLED || 'true').toLowerCase() !== 'false';
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatIds = db
    ? resolveTelegramNotifyChatIds(db, getSetting, setSetting)
    : resolveTelegramNotifyChatIds(null, () => null, () => {});
  return enabled && Boolean(token && chatIds.length);
}

function shouldRefreshServiceEveryCycle(serviceKey, db = null) {
  if (!isInventoryAlertEnabled(db)) return false;
  return parseServiceKeys(process.env.TELEGRAM_ALERT_SERVICE_KEYS).has(serviceKey);
}

function createInventoryAlertStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_alert_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_key TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      country_iso2 TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      notified_at TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
  `);

  function wasRecentlyNotified(dedupeKey, cooldownMs) {
    const row = db.prepare(`
      SELECT notified_at
      FROM inventory_alert_log
      WHERE dedupe_key = ?
    `).get(dedupeKey);
    if (!row?.notified_at) return false;
    const notifiedMs = new Date(row.notified_at).getTime();
    if (!Number.isFinite(notifiedMs)) return false;
    return Date.now() - notifiedMs < cooldownMs;
  }

  function recordNotification(event, serviceKey, dedupeKey) {
    db.prepare(`
      INSERT INTO inventory_alert_log (
        service_key, provider_key, country_iso2, alert_type, dedupe_key, notified_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        notified_at = excluded.notified_at,
        payload_json = excluded.payload_json
    `).run(
      serviceKey,
      event.providerKey,
      event.countryIso2,
      event.type,
      dedupeKey,
      new Date().toISOString(),
      JSON.stringify(event),
    );
  }

  return {
    wasRecentlyNotified,
    recordNotification,
  };
}

function buildDedupeKey(serviceKey, event, cooldownMs) {
  if (event.type === 'new_listing') {
    return `${serviceKey}:${event.providerKey}:${event.countryIso2}:new_listing`;
  }
  const bucket = Math.floor(Date.now() / cooldownMs);
  return `${serviceKey}:${event.providerKey}:${event.countryIso2}:restock:${bucket}`;
}

function createInventoryAlertService({ db }) {
  const store = createInventoryAlertStore(db);
  const serviceKeys = parseServiceKeys(process.env.TELEGRAM_ALERT_SERVICE_KEYS);
  const restockCooldownMs = Number(process.env.TELEGRAM_ALERT_RESTOCK_COOLDOWN_MS || 21600000);
  const maxMessages = Number(process.env.TELEGRAM_ALERT_MAX_MESSAGES_PER_REFRESH || 20);
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();

  function getRecipientsForProvider(providerKey) {
    return listTelegramAlertRecipients(db, getSetting, setSetting, providerKey);
  }

  async function processProviderRefresh({
    serviceKey,
    providerKey,
    providerName,
    previousPayload,
    newPayload,
  }) {
    if (!isInventoryAlertEnabled(db) || !serviceKeys.has(serviceKey)) {
      return { skipped: true, reason: 'disabled' };
    }

    const recipients = getRecipientsForProvider(providerKey);
    if (!recipients.length) {
      return { skipped: true, reason: 'no_recipients' };
    }

    const events = diffProviderOffers({
      providerKey,
      providerName,
      previousOffers: previousPayload?.offers || [],
      newOffers: newPayload?.offers || [],
    });

    const pending = [];
    for (const event of events) {
      const dedupeKey = buildDedupeKey(serviceKey, event, restockCooldownMs);
      const cooldown = event.type === 'new_listing' ? Number.MAX_SAFE_INTEGER : restockCooldownMs;
      if (store.wasRecentlyNotified(dedupeKey, cooldown)) continue;
      pending.push({ event, dedupeKey });
    }

    if (!pending.length) {
      return { skipped: true, reason: 'no_events', evaluated: events.length };
    }

    const serviceLabel = serviceKey === 'telegram' ? 'Telegram 接码' : serviceKey;
    const definition = getProviderDefinition(providerKey);
    const alertCode = getProviderAlertCode(providerKey);
    const displayName = providerName || definition?.displayName || '';
    const pendingEvents = pending.map((row) => row.event);
    const accountBalance = await resolveProviderAccountBalance(db, providerKey);
    const withSource = formatInventoryAlertLines(pendingEvents, {
      serviceLabel,
      providerName: displayName,
      alertCode,
      includeSource: true,
      portalUrl: resolvePortalUrl(definition || { providerKey }),
      accountBalance,
    });
    const withoutSource = formatInventoryAlertLines(pendingEvents, {
      serviceLabel,
      includeSource: false,
    });

    const sourceRecipients = recipients.filter((row) => row.includeSource !== false);
    const genericRecipients = recipients.filter((row) => row.includeSource === false);
    let messageCount = 0;

    async function broadcastTo(targetRecipients, text) {
      if (!targetRecipients.length) return;
      const chunks = splitTelegramMessages(text).slice(0, maxMessages);
      messageCount += chunks.length;
      for (const chunk of chunks) {
        await sendTelegramBroadcast({
          botToken,
          chatIds: targetRecipients.map((row) => row.chatId),
          text: chunk,
          sendTelegramMessage,
        });
      }
    }

    await broadcastTo(sourceRecipients, withSource);
    await broadcastTo(genericRecipients, withoutSource);

    for (const row of pending) {
      store.recordNotification(row.event, serviceKey, row.dedupeKey);
    }

    return {
      sent: true,
      eventCount: pending.length,
      messageCount,
      recipientCount: recipients.length,
      types: pending.map((row) => row.event.type),
    };
  }

  return {
    isEnabled: () => isInventoryAlertEnabled(db),
    shouldRefreshServiceEveryCycle: (serviceKey) => shouldRefreshServiceEveryCycle(serviceKey, db),
    processProviderRefresh,
  };
}

module.exports = {
  ALERT_TYPE_LABELS,
  createInventoryAlertService,
  isInventoryAlertEnabled,
  shouldRefreshServiceEveryCycle,
};
