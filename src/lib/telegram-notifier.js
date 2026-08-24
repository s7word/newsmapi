'use strict';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitTelegramMessages(text, maxLen = 4000) {
  const chunks = [];
  let remaining = String(text || '').trim();
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTelegramMessage({ botToken, chatId, text, parseMode = 'HTML' }) {
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();
  if (!token || !chat) {
    throw new Error('Telegram bot token or chat id missing');
  }

  const url = `${TELEGRAM_API_ROOT}/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: String(text || ''),
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });

  const body = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { raw: body };
  }

  if (!response.ok || payload?.ok === false) {
    const description = payload?.description || body.slice(0, 300) || `HTTP ${response.status}`;
    throw new Error(`Telegram sendMessage failed: ${description}`);
  }

  return payload;
}

function formatInventoryAlertLines(events, serviceLabel) {
  const header = `📦 <b>${escapeHtml(serviceLabel)} 补货 / 上新</b>`;
  const lines = events.map((event) => {
    const typeLabel = event.type === 'new_listing' ? '新上架' : '补货';
    const country = escapeHtml(event.countryName || event.countryIso2);
    const provider = escapeHtml(event.providerName || event.providerKey);
    const stockLine = `${event.previousStock} → ${event.newStock}`;
    const priceUsd = Number(event.minPriceUsd || 0);
    const priceLine = priceUsd > 0 ? `$${priceUsd.toFixed(4)}` : '—';
    return [
      `• <b>${typeLabel}</b> · ${provider}`,
      `  ${country} (${escapeHtml(event.countryIso2)})`,
      `  库存 ${stockLine} · ${priceLine}`,
    ].join('\n');
  });
  return [header, ...lines].join('\n\n');
}

module.exports = {
  escapeHtml,
  formatInventoryAlertLines,
  sendTelegramMessage,
  splitTelegramMessages,
};
