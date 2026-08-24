#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { createDatabase } = require('../lib/db');
const { getSetting, setSetting } = require('../lib/settings');
const { discoverTelegramNotifyChatId, resolveTelegramNotifyChatIds } = require('../lib/telegram-chat-discovery');
const { sendTelegramMessage, formatInventoryAlertLines } = require('../lib/telegram-notifier');
const { sendTelegramBroadcast } = require('../lib/telegram-recipients');
const { resolveProviderAlertMeta } = require('../config/provider-alert-codes');

async function main() {
  const waitSeconds = Math.min(50, Math.max(0, Number(process.argv[2] || 0)));
  const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';
  const db = createDatabase(dbPath);
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN 未配置');
    process.exit(1);
  }

  let chatIds = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
  if (!chatIds.length) {
    console.log(`未发现 Chat ID，${waitSeconds ? `长轮询 ${waitSeconds}s 等待私聊消息…` : '尝试 getUpdates…'}`);
    const discovery = await discoverTelegramNotifyChatId({
      db,
      getSetting,
      setSetting,
      botToken: token,
      longPollSeconds: waitSeconds,
    });
    console.log('discovery:', JSON.stringify(discovery, null, 2));
    chatIds = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
  }

  if (!chatIds.length) {
    console.error('仍无 Chat ID。请在前端「推送 ID 管理」中添加，或向 @rscbot2026_bot 发送私聊后重试：');
    console.error('  node src/scripts/telegram-test-push.js 25');
    process.exit(1);
  }

  const sampleText = formatInventoryAlertLines([
    {
      type: 'restock',
      countryIso2: 'IN',
      countryName: 'India',
      previousStock: 0,
      newStock: 5,
      minPriceUsd: 0.2,
      currency: 'USD',
    },
  ], {
    serviceLabel: 'Telegram 接码',
    ...resolveProviderAlertMeta('smstg'),
    includeSource: true,
  });

  await sendTelegramBroadcast({
    botToken: token,
    chatIds,
    text: `🧪 <b>SMSBazaar 测试推送</b>\n\n${sampleText}`,
    sendTelegramMessage,
  });

  console.log(`测试消息已发送至 ${chatIds.length} 个对象`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
