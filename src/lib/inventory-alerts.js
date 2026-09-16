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
const {
  dispatchAlertWebhook,
  getAlertWebhookConfig,
} = require('./alert-webhook');

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

function isWebhookAlertEnabled(db = null) {
  if (!db) return false;
  const config = getAlertWebhookConfig(db);
  return Boolean(config.enabled && config.url);
}

function isAlertPipelineEnabled(db = null) {
  return isInventoryAlertEnabled(db) || isWebhookAlertEnabled(db);
}

function shouldRefreshServiceEveryCycle(serviceKey, db = null) {
  if (!isAlertPipelineEnabled(db)) return false;
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

function parseRestockCooldownMs(raw = process.env.TELEGRAM_ALERT_RESTOCK_COOLDOWN_MS) {
  if (raw == null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function tierDedupeSuffix(event) {
  const ref = String(event.providerRef || '').trim();
  if (!ref) return '';
  const price = Number(event.minPriceOriginal ?? event.minPriceUsd ?? 0);
  return `:${ref}:${Number.isFinite(price) ? price : 0}`;
}

function buildDedupeKey(serviceKey, event, cooldownMs) {
  const tier = tierDedupeSuffix(event);
  if (event.type === 'new_listing') {
    return `${serviceKey}:${event.providerKey}:${event.countryIso2}${tier}:new_listing`;
  }
  // Optional anti-flap only. cooldownMs <= 0 must not divide by zero (Infinity bucket).
  if (Number.isFinite(cooldownMs) && cooldownMs > 0) {
    const bucket = Math.floor(Date.now() / cooldownMs);
    return `${serviceKey}:${event.providerKey}:${event.countryIso2}${tier}:restock:${bucket}`;
  }
  return `${serviceKey}:${event.providerKey}:${event.countryIso2}${tier}:restock:${event.previousStock}-${event.newStock}-${Date.now()}`;
}

function createInventoryAlertService({ db }) {
  const store = createInventoryAlertStore(db);
  const serviceKeys = parseServiceKeys(process.env.TELEGRAM_ALERT_SERVICE_KEYS);
  const restockCooldownMs = parseRestockCooldownMs();
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
    if (!serviceKeys.has(serviceKey) || !isAlertPipelineEnabled(db)) {
      return { skipped: true, reason: 'disabled' };
    }

    const telegramEnabled = isInventoryAlertEnabled(db);
    const recipients = telegramEnabled ? getRecipientsForProvider(providerKey) : [];
    const webhookEnabled = isWebhookAlertEnabled(db);
    if (!recipients.length && !webhookEnabled) {
      return { skipped: true, reason: 'no_recipients' };
    }

    const events = diffProviderOffers({
      providerKey,
      providerName,
      previousOffers: previousPayload?.offers || [],
      newOffers: newPayload?.offers || [],
    });

    const pending = [];
    const seenRestockKeys = new Set();
    for (const event of events) {
      if (event.type === 'restock') {
        const restockKey = `${event.providerKey}:${event.countryIso2}${tierDedupeSuffix(event)}`;
        if (seenRestockKeys.has(restockKey)) continue;
        seenRestockKeys.add(restockKey);
      }

      const dedupeKey = buildDedupeKey(serviceKey, event, restockCooldownMs);
      if (event.type === 'new_listing') {
        if (store.wasRecentlyNotified(dedupeKey, Number.MAX_SAFE_INTEGER)) continue;
      } else if (restockCooldownMs > 0) {
        if (store.wasRecentlyNotified(dedupeKey, restockCooldownMs)) continue;
      }
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

    let messageCount = 0;
    if (recipients.length) {
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
    }

    let webhookResult = { skipped: true, reason: 'disabled' };
    if (webhookEnabled) {
      try {
        webhookResult = await dispatchAlertWebhook({
          db,
          serviceKey,
          serviceLabel,
          providerKey,
          providerName: displayName,
          events: pendingEvents,
          accountBalance,
        });
      } catch (error) {
        webhookResult = { ok: false, error: error.message || 'webhook_failed' };
        console.error(`Alert webhook failed for ${providerKey}/${serviceKey}: ${error.message}`);
      }
    }

    for (const row of pending) {
      store.recordNotification(row.event, serviceKey, row.dedupeKey);
    }

    return {
      sent: true,
      eventCount: pending.length,
      messageCount,
      recipientCount: recipients.length,
      webhook: webhookResult,
      types: pending.map((row) => row.event.type),
    };
  }

  return {
    isEnabled: () => isAlertPipelineEnabled(db),
    shouldRefreshServiceEveryCycle: (serviceKey) => shouldRefreshServiceEveryCycle(serviceKey, db),
    processProviderRefresh,
  };
}

module.exports = {
  ALERT_TYPE_LABELS,
  buildDedupeKey,
  createInventoryAlertService,
  isAlertPipelineEnabled,
  isInventoryAlertEnabled,
  isWebhookAlertEnabled,
  parseRestockCooldownMs,
  shouldRefreshServiceEveryCycle,
};
