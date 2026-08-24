'use strict';

const crypto = require('node:crypto');

const TELEGRAM_RECIPIENTS_SETTING = 'telegram_notify_recipients';
const LEGACY_CHAT_SETTING = 'telegram_notify_chat_id';

function normalizeChatId(raw) {
  return String(raw ?? '').trim();
}

function maskChatId(chatId) {
  const value = normalizeChatId(chatId);
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function normalizeRecipient(input = {}) {
  const chatId = normalizeChatId(input.chatId);
  if (!chatId) return null;
  return {
    id: String(input.id || `r_${crypto.randomBytes(6).toString('hex')}`),
    chatId,
    label: String(input.label || '').trim(),
    enabled: input.enabled !== false,
    createdAt: String(input.createdAt || new Date().toISOString()),
  };
}

function readRecipientsRaw(db, getSetting) {
  const stored = getSetting(db, TELEGRAM_RECIPIENTS_SETTING, null);
  if (Array.isArray(stored)) return stored;
  return [];
}

function writeRecipients(db, setSetting, recipients) {
  setSetting(db, TELEGRAM_RECIPIENTS_SETTING, recipients);
}

function migrateLegacyRecipients(db, getSetting, setSetting) {
  const recipients = readRecipientsRaw(db, getSetting);
  if (recipients.length) return recipients;

  const legacy = normalizeChatId(getSetting(db, LEGACY_CHAT_SETTING, ''));
  const fromEnv = normalizeChatId(process.env.TELEGRAM_NOTIFY_CHAT_ID || '');
  const chatId = legacy || fromEnv;
  if (!chatId) return [];

  const migrated = [normalizeRecipient({
    chatId,
    label: '默认推送',
    enabled: true,
  })];
  writeRecipients(db, setSetting, migrated);
  return migrated;
}

function listTelegramRecipients(db, getSetting, setSetting) {
  const recipients = migrateLegacyRecipients(db, getSetting, setSetting)
    .map((row) => normalizeRecipient(row))
    .filter(Boolean);
  return recipients.map((row) => ({
    ...row,
    chatIdMasked: maskChatId(row.chatId),
  }));
}

function resolveTelegramNotifyChatIds(db, getSetting, setSetting) {
  const envIds = String(process.env.TELEGRAM_NOTIFY_CHAT_ID || '')
    .split(/[,;\s]+/)
    .map((value) => normalizeChatId(value))
    .filter(Boolean);

  const recipients = migrateLegacyRecipients(db, getSetting, setSetting)
    .map((row) => normalizeRecipient(row))
    .filter(Boolean)
    .filter((row) => row.enabled)
    .map((row) => row.chatId);

  const merged = new Set([...envIds, ...recipients]);
  return [...merged];
}

function resolveTelegramNotifyChatId(db, getSetting, setSetting) {
  const ids = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
  return ids[0] || '';
}

function addTelegramRecipient(db, getSetting, setSetting, { chatId, label = '' }) {
  const normalized = normalizeRecipient({ chatId, label });
  if (!normalized) {
    throw new Error('chat_id_required');
  }

  const recipients = migrateLegacyRecipients(db, getSetting, setSetting)
    .map((row) => normalizeRecipient(row))
    .filter(Boolean);

  const existing = recipients.find((row) => row.chatId === normalized.chatId);
  if (existing) {
    existing.label = normalized.label || existing.label;
    existing.enabled = true;
    writeRecipients(db, setSetting, recipients);
    return { ...existing, chatIdMasked: maskChatId(existing.chatId), created: false };
  }

  recipients.push(normalized);
  writeRecipients(db, setSetting, recipients);
  return { ...normalized, chatIdMasked: maskChatId(normalized.chatId), created: true };
}

function updateTelegramRecipient(db, getSetting, setSetting, id, patch = {}) {
  const recipients = migrateLegacyRecipients(db, getSetting, setSetting)
    .map((row) => normalizeRecipient(row))
    .filter(Boolean);
  const index = recipients.findIndex((row) => row.id === id);
  if (index < 0) return null;

  if (patch.label != null) recipients[index].label = String(patch.label || '').trim();
  if (patch.enabled != null) recipients[index].enabled = Boolean(patch.enabled);
  if (patch.chatId != null) {
    const nextChatId = normalizeChatId(patch.chatId);
    if (!nextChatId) throw new Error('chat_id_required');
    recipients[index].chatId = nextChatId;
  }

  writeRecipients(db, setSetting, recipients);
  return {
    ...recipients[index],
    chatIdMasked: maskChatId(recipients[index].chatId),
  };
}

function removeTelegramRecipient(db, getSetting, setSetting, id) {
  const recipients = migrateLegacyRecipients(db, getSetting, setSetting)
    .map((row) => normalizeRecipient(row))
    .filter(Boolean);
  const next = recipients.filter((row) => row.id !== id);
  if (next.length === recipients.length) return false;
  writeRecipients(db, setSetting, next);
  return true;
}

async function sendTelegramBroadcast({ botToken, chatIds, text, sendTelegramMessage }) {
  const ids = [...new Set((chatIds || []).map((value) => normalizeChatId(value)).filter(Boolean))];
  const results = [];
  for (const chatId of ids) {
    try {
      await sendTelegramMessage({ botToken, chatId, text });
      results.push({ chatId, ok: true });
    } catch (error) {
      results.push({ chatId, ok: false, error: error.message });
    }
  }
  return results;
}

module.exports = {
  TELEGRAM_RECIPIENTS_SETTING,
  LEGACY_CHAT_SETTING,
  addTelegramRecipient,
  listTelegramRecipients,
  maskChatId,
  migrateLegacyRecipients,
  removeTelegramRecipient,
  resolveTelegramNotifyChatId,
  resolveTelegramNotifyChatIds,
  sendTelegramBroadcast,
  updateTelegramRecipient,
};
