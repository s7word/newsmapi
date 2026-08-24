'use strict';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';
const TELEGRAM_NOTIFY_CHAT_SETTING = 'telegram_notify_chat_id';

function getTelegramBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function resolveTelegramNotifyChatId(db, getSetting) {
  const fromEnv = String(process.env.TELEGRAM_NOTIFY_CHAT_ID || '').trim();
  if (fromEnv) return fromEnv;
  if (!db || !getSetting) return '';
  const stored = getSetting(db, TELEGRAM_NOTIFY_CHAT_SETTING, '');
  return String(stored || '').trim();
}

async function fetchTelegramUpdates(botToken, offset = 0) {
  const token = String(botToken || '').trim();
  if (!token) return { ok: false, result: [] };

  const params = new URLSearchParams();
  if (offset > 0) params.set('offset', String(offset));
  params.set('timeout', '0');
  params.set('allowed_updates', JSON.stringify(['message', 'channel_post', 'my_chat_member']));

  const url = `${TELEGRAM_API_ROOT}/bot${token}/getUpdates?${params.toString()}`;
  const response = await fetch(url);
  const body = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { ok: false, description: body.slice(0, 200) };
  }
  return payload;
}

function pickChatIdFromUpdates(updates = []) {
  let best = null;
  for (const update of updates) {
    const chat =
      update?.message?.chat ||
      update?.channel_post?.chat ||
      update?.my_chat_member?.chat;
    if (!chat?.id) continue;
    const updateId = Number(update.update_id || 0);
    if (!best || updateId >= best.updateId) {
      best = { chatId: String(chat.id), updateId, chatType: chat.type || '' };
    }
  }
  return best;
}

async function discoverTelegramNotifyChatId({ db, getSetting, setSetting, botToken = getTelegramBotToken() }) {
  const token = String(botToken || '').trim();
  if (!token) return { discovered: false, reason: 'no_token' };

  const existing = resolveTelegramNotifyChatId(db, getSetting);
  if (existing) return { discovered: true, chatId: existing, source: 'configured' };

  const payload = await fetchTelegramUpdates(token);
  if (!payload?.ok) {
    return { discovered: false, reason: payload?.description || 'getUpdates_failed' };
  }

  const picked = pickChatIdFromUpdates(payload.result || []);
  if (!picked?.chatId) {
    return { discovered: false, reason: 'no_messages' };
  }

  if (db && setSetting) {
    setSetting(db, TELEGRAM_NOTIFY_CHAT_SETTING, picked.chatId);
  }

  const nextOffset = picked.updateId + 1;
  await fetchTelegramUpdates(token, nextOffset);

  return {
    discovered: true,
    chatId: picked.chatId,
    chatType: picked.chatType,
    source: 'getUpdates',
  };
}

function startTelegramChatDiscovery({
  db,
  getSetting,
  setSetting,
  sendTelegramMessage,
  pollIntervalMs = Number(process.env.TELEGRAM_CHAT_DISCOVERY_INTERVAL_MS || 30000),
  botToken = getTelegramBotToken(),
}) {
  const token = String(botToken || '').trim();
  if (!token) return { stop: () => {} };

  let stopped = false;
  let timer = null;
  let inFlight = false;

  async function poll() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const result = await discoverTelegramNotifyChatId({ db, getSetting, setSetting, botToken: token });
      if (result.discovered && result.source === 'getUpdates' && sendTelegramMessage) {
        const chatId = result.chatId;
        try {
          await sendTelegramMessage({
            botToken: token,
            chatId,
            text: '✅ SMSBazaar 告警已连接。将向本聊天推送 Telegram 接码补货 / 上新通知。',
          });
        } catch (error) {
          console.warn(`Telegram welcome message failed: ${error.message}`);
        }
        console.log(`Telegram notify chat id discovered: ${chatId} (${result.chatType || 'unknown'})`);
        stopped = true;
        if (timer) clearInterval(timer);
      }
    } catch (error) {
      console.warn(`Telegram chat discovery failed: ${error.message}`);
    } finally {
      inFlight = false;
    }
  }

  poll();
  timer = setInterval(poll, pollIntervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = {
  TELEGRAM_NOTIFY_CHAT_SETTING,
  discoverTelegramNotifyChatId,
  fetchTelegramUpdates,
  getTelegramBotToken,
  pickChatIdFromUpdates,
  resolveTelegramNotifyChatId,
  startTelegramChatDiscovery,
};
