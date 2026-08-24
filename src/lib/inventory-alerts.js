'use strict';

const { diffProviderOffers } = require('./offer-diff');
const {
  formatInventoryAlertLines,
  sendTelegramMessage,
  splitTelegramMessages,
} = require('./telegram-notifier');
const { resolveTelegramNotifyChatId } = require('./telegram-chat-discovery');
const { getSetting } = require('./settings');

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
  const chatId = resolveTelegramNotifyChatId(db, getSetting);
  return enabled && Boolean(token && chatId);
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

  function getChatId() {
    return resolveTelegramNotifyChatId(db, getSetting);
  }

  async function processProviderRefresh({
    serviceKey,
    providerKey,
    providerName,
    previousPayload,
    newPayload,
  }) {
    const chatId = getChatId();
    if (!isInventoryAlertEnabled(db) || !serviceKeys.has(serviceKey)) {
      return { skipped: true, reason: 'disabled' };
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
    const text = formatInventoryAlertLines(pending.map((row) => row.event), serviceLabel);
    const chunks = splitTelegramMessages(text);
    const sentChunks = chunks.slice(0, maxMessages);

    for (const chunk of sentChunks) {
      await sendTelegramMessage({
        botToken,
        chatId,
        text: chunk,
      });
    }

    for (const row of pending) {
      store.recordNotification(row.event, serviceKey, row.dedupeKey);
    }

    return {
      sent: true,
      eventCount: pending.length,
      messageCount: sentChunks.length,
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
