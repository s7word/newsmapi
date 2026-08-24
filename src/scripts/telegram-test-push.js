#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { createDatabase } = require('../lib/db');
const { getSetting, setSetting } = require('../lib/settings');
const { discoverTelegramNotifyChatId, resolveTelegramNotifyChatId } = require('../lib/telegram-chat-discovery');
const { sendTelegramMessage } = require('../lib/telegram-notifier');

async function main() {
  const waitSeconds = Math.min(50, Math.max(0, Number(process.argv[2] || 0)));
  const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';
  const db = createDatabase(dbPath);
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN 未配置');
    process.exit(1);
  }

  let chatId = resolveTelegramNotifyChatId(db, getSetting);
  if (!chatId) {
    console.log(`未发现 Chat ID，${waitSeconds ? `长轮询 ${waitSeconds}s 等待私聊消息…` : '尝试 getUpdates…'}`);
    const discovery = await discoverTelegramNotifyChatId({
      db,
      getSetting,
      setSetting,
      botToken: token,
      longPollSeconds: waitSeconds,
    });
    console.log('discovery:', JSON.stringify(discovery, null, 2));
    chatId = discovery.chatId || resolveTelegramNotifyChatId(db, getSetting);
  }

  if (!chatId) {
    console.error('仍无 Chat ID。请向 @rscbot2026_bot 发送一条私聊后重试：');
    console.error('  node src/scripts/telegram-test-push.js 25');
    process.exit(1);
  }

  await sendTelegramMessage({
    botToken: token,
    chatId,
    text: [
      '🧪 <b>SMSBazaar 测试推送</b>',
      '',
      '若你看到本条消息，说明 Bot 推送链路正常。',
      `时间：${new Date().toISOString()}`,
    ].join('\n'),
  });

  console.log(`测试消息已发送至 chat id ${chatId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
