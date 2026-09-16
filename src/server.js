'use strict';

require('dotenv').config();

const { buildServiceConfig } = require('./config/service-config');
const { listServices } = require('./config/services-catalog');
const { createApp } = require('./app');
const { createDatabase, upsertServiceConfig } = require('./lib/db');
const { createExchangeRateService } = require('./lib/exchange-rates');
const { createRefreshController } = require('./lib/refresh-controller');
const { createOpenAiCountrySync } = require('./lib/openai-country-sync');
const { createInventoryAlertService } = require('./lib/inventory-alerts');
const { bootstrapAdminPassword, getSetting, setSetting } = require('./lib/settings');
const { startTelegramChatDiscovery, resolveTelegramNotifyChatIds } = require('./lib/telegram-chat-discovery');
const { sendTelegramMessage } = require('./lib/telegram-notifier');

const port = Number(process.env.PORT || 8787);
const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const refreshIntervalMs = Number(process.env.REFRESH_INTERVAL_MS || 120000);
const refreshCooldownMs = Number(process.env.REFRESH_COOLDOWN_MS || 30000);
const databasePath = process.env.DATABASE_PATH || './data/app.sqlite';
const exchangeRateUrl = process.env.EXCHANGE_RATE_URL || 'https://api.frankfurter.app/latest?from=USD';
const openAiSupportedCountriesFilePath = process.env.OPENAI_SUPPORTED_COUNTRIES_FILE || './data/openai-supported-api-countries.txt';
const openAiWhatsAppCountriesFilePath = process.env.OPENAI_WHATSAPP_COUNTRIES_FILE || './data/openai-supported-whatsapp-countries.txt';
const openAiCountrySyncStateFilePath = process.env.OPENAI_COUNTRY_SYNC_STATE_FILE || './data/openai-country-sync-state.json';

async function bootstrap() {
  const db = createDatabase(databasePath);
  bootstrapAdminPassword(db);
  upsertServiceConfig(db, buildServiceConfig('openai_chatgpt'));

  const exchangeRateService = createExchangeRateService({
    db,
    rateUrl: exchangeRateUrl,
  });

  const inventoryAlertService = createInventoryAlertService({ db });
  const telegramChatIds = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
  const telegramToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (telegramToken && telegramChatIds.length) {
    console.log(`Telegram inventory alerts: enabled (${telegramChatIds.length} recipient(s))`);
  } else if (telegramToken) {
    console.log('Telegram inventory alerts: waiting for chat id — message @rscbot2026_bot to bind');
  } else {
    console.log('Telegram inventory alerts: disabled (TELEGRAM_BOT_TOKEN not set)');
  }

  const telegramChatDiscovery = startTelegramChatDiscovery({
    db,
    getSetting,
    setSetting,
    sendTelegramMessage,
  });

  const refreshController = createRefreshController({
    db,
    exchangeRateService,
    refreshCooldownMs,
    inventoryAlertService,
  });

  const countrySyncController = createOpenAiCountrySync({
    apiCountriesFilePath: openAiSupportedCountriesFilePath,
    whatsappCountriesFilePath: openAiWhatsAppCountriesFilePath,
    stateFilePath: openAiCountrySyncStateFilePath,
    syncIntervalMs: Number(process.env.OPENAI_COUNTRY_SYNC_INTERVAL_MS || 86400000),
    retryIntervalMs: Number(process.env.OPENAI_COUNTRY_SYNC_RETRY_MS || 3600000),
    checkIntervalMs: Number(process.env.OPENAI_COUNTRY_SYNC_CHECK_MS || 3600000),
    enabled: String(process.env.OPENAI_COUNTRY_SYNC_ENABLED || 'true').toLowerCase() !== 'false',
  });

  const app = createApp({
    db,
    refreshController,
    countrySyncController,
    exchangeRateService,
  });

  const server = app.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });

  const alertStartupKeys = listServices()
    .map((service) => service.serviceKey)
    .filter((key) => inventoryAlertService.shouldRefreshServiceEveryCycle?.(key));

  for (const key of alertStartupKeys) {
    refreshController.refreshAll('startup', key).catch((error) => {
      console.error(`Initial ${key} refresh failed: ${error.message}`);
    });
  }

  refreshController.refreshAll('startup', 'openai_chatgpt').catch((error) => {
    console.error(`Initial openai_chatgpt refresh failed: ${error.message}`);
  });
  countrySyncController.start();

  const interval = setInterval(() => {
    refreshController.refreshAll('scheduled').catch((error) => {
      console.error(`Scheduled refresh failed: ${error.message}`);
    });
  }, refreshIntervalMs);

  const shutdown = () => {
    clearInterval(interval);
    telegramChatDiscovery.stop();
    countrySyncController.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
