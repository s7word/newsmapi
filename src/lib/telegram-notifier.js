'use strict';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function formatInventoryAlertLines(events, options = {}) {
  const {
    serviceLabel = '接码',
    providerName = '',
    includeSource = true,
    alertCode = '',
    portalUrl = '',
  } = options;

  const header = [];
  if (includeSource) {
    const code = escapeHtml(alertCode || '');
    const name = escapeHtml(providerName || '未知平台');
    header.push(code
      ? `🔔 来源编号 <b>${code}</b> · ${name}`
      : `🔔 来源 · ${name}`);
    const href = String(portalUrl || '').trim();
    if (href) {
      header.push(`🔗 <a href="${escapeHtmlAttribute(href)}">打开平台查看</a>`);
    }
    header.push(`📱 服务：${escapeHtml(serviceLabel)}`);
  }

  const lines = events.map((event) => {
    const typeLabel = event.type === 'new_listing' ? '🆕 新上架' : '📦 补货';
    const country = escapeHtml(event.countryName || event.countryIso2);
    const iso2 = escapeHtml(event.countryIso2);
    const stockLine = `${event.previousStock} → ${event.newStock}`;
    const priceUsd = Number(event.minPriceUsd || 0);
    const currency = escapeHtml(event.currency || 'USD');
    const priceLine = priceUsd > 0 ? `$${priceUsd.toFixed(4)} ${currency}` : '—';
    return [
      `<b>${typeLabel}</b>`,
      `国家：${country} (${iso2})`,
      `库存：${stockLine}`,
      `最低价：${priceLine}`,
    ].join('\n');
  });

  return [header.join('\n'), '━━━━━━━━━━━━━━', ...lines].filter(Boolean).join('\n\n');
}

module.exports = {
  escapeHtml,
  formatInventoryAlertLines,
  sendTelegramMessage,
  splitTelegramMessages,
};
