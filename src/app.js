'use strict';

const express = require('express');
const path = require('node:path');
const {
  buildServiceConfig,
  listServices,
} = require('./config/services-catalog');
const { aggregateByCountry } = require('./lib/aggregator');
const { loadOpenAiSupportedCountries } = require('./lib/openai-supported-country-config');
const { loadRecommendedCountryConfig } = require('./lib/recommended-country-config');
const {
  getExchangeRates,
  getAllProviderSnapshots,
  getAllProviderStates,
  getLatestRefreshEvent,
  upsertServiceConfig,
} = require('./lib/db');
const {
  bootstrapAdminPassword,
  destroySession,
  extractBearerToken,
  getAdminPasswordRecord,
  getProviderConnectivityMap,
  getSession,
  getSetting,
  listProviderKeySettings,
  login,
  requireAdmin,
  resolveProviderApiKey,
  saveProviderConnectivityFromTest,
  setAdminPassword,
  setSetting,
  upsertProviderKey,
} = require('./lib/settings');
const { listProviders, getProviderDefinition, resolvePortalUrl } = require('./config/providers-catalog');
const { listProviderAlertCatalog, resolveProviderAlertMeta } = require('./config/provider-alert-codes');
const { testProviderKeySafe } = require('./lib/provider-key-test');
const { buildProvidersPanel } = require('./lib/providers-panel');
const {
  discoverTelegramNotifyChatId,
  resolveTelegramNotifyChatIds,
} = require('./lib/telegram-chat-discovery');
const {
  addTelegramRecipient,
  listTelegramRecipients,
  maskChatId,
  removeTelegramRecipient,
  sendTelegramBroadcast,
  updateTelegramRecipient,
} = require('./lib/telegram-recipients');
const { sendTelegramMessage, formatInventoryAlertLines } = require('./lib/telegram-notifier');
const { isInventoryAlertEnabled } = require('./lib/inventory-alerts');
const { resolveProviderAccountBalance } = require('./lib/provider-account-balance');
const {
  getGatewayMeta,
  getUnifiedBalance,
  getUnifiedPrices,
  proxyActivate,
  createUnifiedOrder,
  getUnifiedOrderStatus,
  cancelUnifiedOrder,
  requireGatewayAuth,
} = require('./lib/gateway');

function createApp({ db, refreshController, countrySyncController, exchangeRateService }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  const recommendationFilePath = process.env.RECOMMENDED_COUNTRY_PATHS_FILE || './data/recommended-country-paths.txt';
  const openAiSupportedCountriesFilePath = process.env.OPENAI_SUPPORTED_COUNTRIES_FILE || './data/openai-supported-api-countries.txt';
  const openAiWhatsAppCountriesFilePath = process.env.OPENAI_WHATSAPP_COUNTRIES_FILE || './data/openai-supported-whatsapp-countries.txt';
  const adminRefreshToken = String(process.env.ADMIN_REFRESH_TOKEN || '').trim();
  const refreshIntervalMs = Number(process.env.REFRESH_INTERVAL_MS || 60000);
  const exposeProviderErrors = String(process.env.EXPOSE_PROVIDER_ERRORS || '').toLowerCase() === 'true';

  bootstrapAdminPassword(db);

  function resolveServiceKey(raw) {
    const key = String(raw || 'openai_chatgpt').trim();
    const available = listServices().map((service) => service.serviceKey);
    return available.includes(key) ? key : 'openai_chatgpt';
  }

  function redactProviderError(message) {
    if (exposeProviderErrors) return message || '';
    return message ? '平台异常' : '';
  }

  function redactCompareRows(rows) {
    return rows.map((row) => ({
      ...row,
      offers: row.offers.map((offer) => ({
        ...offer,
        errorMessage: redactProviderError(offer.errorMessage),
      })),
    }));
  }

  function setApiCacheHeaders(res) {
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
  }

  function setNoStore(res) {
    res.set('Cache-Control', 'no-store');
  }

  function isProviderConfigured(mapping) {
    return Boolean(resolveProviderApiKey(db, mapping.keyEnv) || mapping.publicWithoutKey);
  }

  app.get('/api/meta', (req, res) => {
    setApiCacheHeaders(res);
    const serviceKey = resolveServiceKey(req.query.service);
    const serviceConfig = buildServiceConfig(serviceKey);
    upsertServiceConfig(db, serviceConfig);

    const latestRefresh = getLatestRefreshEvent(db);
    const states = getAllProviderStates(db, serviceKey);
    const snapshots = new Map(getAllProviderSnapshots(db, serviceKey).map((snapshot) => [snapshot.providerKey, snapshot]));
    const usdRates = getExchangeRates(db, 'USD');
    const recommendationConfig = loadRecommendedCountryConfig(recommendationFilePath, serviceConfig.recommendedWhitelistIso2);
    const openAiSupportedCountries = loadOpenAiSupportedCountries(openAiSupportedCountriesFilePath);
    const openAiWhatsAppCountries = loadOpenAiSupportedCountries(openAiWhatsAppCountriesFilePath);
    const rawCountryListSync = countrySyncController?.getState?.() || {
      status: 'bundled',
      lastSuccessAt: '',
      errorMessage: '',
      apiCountryCount: openAiSupportedCountries.whitelist.length,
      whatsappCountryCount: openAiWhatsAppCountries.whitelist.length,
    };
    const countryListSync = {
      status: rawCountryListSync.status,
      lastAttemptAt: rawCountryListSync.lastAttemptAt || '',
      lastSuccessAt: rawCountryListSync.lastSuccessAt || '',
      errorMessage: rawCountryListSync.errorMessage ? '官网国家列表同步异常' : '',
      apiCountryCount: rawCountryListSync.apiCountryCount || openAiSupportedCountries.whitelist.length,
      whatsappCountryCount: rawCountryListSync.whatsappCountryCount || openAiWhatsAppCountries.whitelist.length,
      sources: rawCountryListSync.sources || {},
    };
    const connectivityMap = getProviderConnectivityMap(db);

    const adminConfigured = Boolean(getAdminPasswordRecord(db));

    res.json({
      services: listServices(),
      service: {
        serviceKey: serviceConfig.serviceKey,
        displayName: serviceConfig.displayName,
        category: serviceConfig.category,
        modes: serviceConfig.modes,
        bindWhitelistIso2: serviceConfig.bindWhitelistIso2,
        recommendedWhitelistIso2: recommendationConfig.whitelist,
        registerSupportedWhitelistIso2: openAiSupportedCountries.whitelist,
        whatsappSupportedWhitelistIso2: openAiWhatsAppCountries.whitelist,
      },
      display: {
        primaryCurrency: 'CNY',
        secondaryCurrency: 'USD',
        cnyRateFromUsd: Number(usdRates?.payload?.rates?.CNY || 7.2),
        refreshIntervalMs,
      },
      auth: {
        adminConfigured,
      },
      recommendationConfig: {
        updatedAt: recommendationConfig.updatedAt,
        source: recommendationConfig.source,
        entries: recommendationConfig.entries,
      },
      countryListSync,
      providers: serviceConfig.providerMappings.map((mapping) => {
        const state = states.get(mapping.providerKey);
        const snapshot = snapshots.get(mapping.providerKey);
        const definition = getProviderDefinition(mapping.providerKey);
        const connectivity = connectivityMap[mapping.providerKey] || null;
        return {
          providerKey: mapping.providerKey,
          displayName: mapping.displayName,
          serviceCode: mapping.serviceCode,
          supportsCurrentService: Boolean(mapping.serviceCode),
          configured: isProviderConfigured(mapping),
          status: state?.status || 'idle',
          lastAttemptedAt: state?.last_attempted_at || '',
          lastSuccessAt: state?.last_success_at || '',
          errorMessage: redactProviderError(state?.error_message),
          offerCount: snapshot?.payload?.offers?.length || 0,
          portalUrl: resolvePortalUrl(definition || {}),
          accountBalance: connectivity
            ? {
              ok: Boolean(connectivity.ok),
              balance: connectivity.balance,
              currency: connectivity.currency,
              checkedAt: connectivity.checkedAt || '',
              message: connectivity.message || '',
            }
            : null,
        };
      }),
      lastRefresh: latestRefresh,
      refreshState: refreshController.getState().isRunning ? 'running' : 'idle',
    });
  });

  app.get('/api/compare', (req, res) => {
    setApiCacheHeaders(res);
    const serviceKey = resolveServiceKey(req.query.service);
    const serviceConfig = buildServiceConfig(serviceKey);
    const allowedModes = serviceConfig.modes || ['all'];
    const requestedMode = String(req.query.mode || '');
    const mode = allowedModes.includes(requestedMode)
      ? requestedMode
      : (allowedModes[0] || 'all');

    const filters = {
      mode,
      country: req.query.country || '',
      provider: req.query.provider || '',
      status: req.query.status || '',
      sort: req.query.sort || 'price_asc',
    };

    const snapshots = getAllProviderSnapshots(db, serviceKey);
    const providerStates = getAllProviderStates(db, serviceKey);
    const recommendationConfig = loadRecommendedCountryConfig(recommendationFilePath, serviceConfig.recommendedWhitelistIso2);
    const openAiSupportedCountries = loadOpenAiSupportedCountries(openAiSupportedCountriesFilePath);
    const openAiWhatsAppCountries = loadOpenAiSupportedCountries(openAiWhatsAppCountriesFilePath);
    const includeOffers = String(req.query.summary || '') !== '1';
    const rows = redactCompareRows(aggregateByCountry({
      snapshots,
      states: providerStates,
      filters,
      whitelist: serviceConfig.bindWhitelistIso2,
      recommendedWhitelist: recommendationConfig.whitelist,
      recommendationPathByIso2: recommendationConfig.pathByIso2,
      openAiSupportedWhitelist: openAiSupportedCountries.whitelist,
      whatsappSupportedWhitelist: openAiWhatsAppCountries.whitelist,
      includeOffers,
    }));

    const countries = rows.map((row) => ({
      iso2: row.countryIso2,
      name: row.countryName,
      displayName: row.countryDisplayName || row.countryName,
      chineseName: row.countryNameZh || row.countryName,
      englishName: row.countryNameEn || row.countryName,
      recommendationPath: row.recommendationPath,
    }));

    res.json({
      serviceKey,
      filters,
      recommendationConfig: {
        updatedAt: recommendationConfig.updatedAt,
        source: recommendationConfig.source,
      },
      countries,
      rows,
      updatedAt: getLatestRefreshEvent(db)?.completed_at || '',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    setNoStore(res);
    const password = String(req.body?.password || '');
    const result = login(db, password);
    if (!result.ok) {
      const status = result.reason === 'admin_password_not_configured' ? 503 : 401;
      res.status(status).json(result);
      return;
    }
    res.setHeader(
      'Set-Cookie',
      `smsbazaar_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(result.expiresInMs / 1000)}`,
    );
    res.json({
      ok: true,
      token: result.token,
      expiresInMs: result.expiresInMs,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    setNoStore(res);
    const token = extractBearerToken(req);
    destroySession(token);
    res.setHeader('Set-Cookie', 'smsbazaar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    setNoStore(res);
    const token = extractBearerToken(req);
    const session = getSession(token);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      username: session.username,
      adminConfigured: Boolean(getAdminPasswordRecord(db)),
    });
  });

  app.get('/api/settings/keys', requireAdmin(db), (req, res) => {
    setNoStore(res);
    res.json({
      providers: listProviderKeySettings(db),
      adminConfigured: Boolean(getAdminPasswordRecord(db)),
    });
  });

  app.get('/api/settings/providers-panel', requireAdmin(db), (req, res) => {
    setNoStore(res);
    const serviceKey = resolveServiceKey(req.query.service);
    res.json({
      serviceKey,
      providers: buildProvidersPanel(db, serviceKey),
      adminConfigured: Boolean(getAdminPasswordRecord(db)),
    });
  });

  app.get('/api/settings/telegram', requireAdmin(db), (req, res) => {
    setNoStore(res);
    const chatIds = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
    const recipients = listTelegramRecipients(db, getSetting, setSetting);
    const tokenConfigured = Boolean(String(process.env.TELEGRAM_BOT_TOKEN || '').trim());
    let inventoryAlertLogCount = 0;
    try {
      inventoryAlertLogCount = db.prepare('SELECT COUNT(*) AS count FROM inventory_alert_log').get()?.count || 0;
    } catch {
      inventoryAlertLogCount = 0;
    }
    res.json({
      alertsEnabled: isInventoryAlertEnabled(db),
      tokenConfigured,
      chatIdConfigured: chatIds.length > 0,
      recipientCount: chatIds.length,
      chatIdMasked: chatIds[0] ? maskChatId(chatIds[0]) : '',
      botUsername: 'rscbot2026_bot',
      alertServiceKeys: String(process.env.TELEGRAM_ALERT_SERVICE_KEYS || 'telegram'),
      inventoryAlertLogCount,
      recipients,
      providerCatalog: listProviderAlertCatalog(),
    });
  });

  app.get('/api/settings/telegram/recipients', requireAdmin(db), (req, res) => {
    setNoStore(res);
    res.json({
      recipients: listTelegramRecipients(db, getSetting, setSetting),
      recipientCount: resolveTelegramNotifyChatIds(db, getSetting, setSetting).length,
    });
  });

  app.post('/api/settings/telegram/recipients', requireAdmin(db), (req, res) => {
    setNoStore(res);
    try {
      const recipient = addTelegramRecipient(db, getSetting, setSetting, {
        chatId: req.body?.chatId,
        label: req.body?.label,
      });
      res.status(recipient.created ? 201 : 200).json({ ok: true, recipient });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'add_failed' });
    }
  });

  app.put('/api/settings/telegram/recipients/:id', requireAdmin(db), (req, res) => {
    setNoStore(res);
    try {
      const recipient = updateTelegramRecipient(db, getSetting, setSetting, req.params.id, {
        label: req.body?.label,
        enabled: req.body?.enabled,
        chatId: req.body?.chatId,
        includeSource: req.body?.includeSource,
        providerKeys: req.body?.providerKeys,
      });
      if (!recipient) {
        res.status(404).json({ ok: false, error: 'not_found' });
        return;
      }
      res.json({ ok: true, recipient });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || 'update_failed' });
    }
  });

  app.delete('/api/settings/telegram/recipients/:id', requireAdmin(db), (req, res) => {
    setNoStore(res);
    const removed = removeTelegramRecipient(db, getSetting, setSetting, req.params.id);
    if (!removed) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  app.put('/api/settings/telegram', requireAdmin(db), (req, res) => {
    setNoStore(res);
    const chatId = String(req.body?.chatId ?? '').trim();
    if (!chatId) {
      res.status(400).json({ ok: false, error: 'chat_id_required' });
      return;
    }
    const recipient = addTelegramRecipient(db, getSetting, setSetting, {
      chatId,
      label: String(req.body?.label || '默认推送'),
    });
    res.json({ ok: true, recipient });
  });

  app.post('/api/settings/telegram/test', requireAdmin(db), async (req, res) => {
    setNoStore(res);
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) {
      res.status(400).json({ ok: false, error: 'bot_token_missing' });
      return;
    }

    const allRecipients = listTelegramRecipients(db, getSetting, setSetting);
    let discovery = null;
    const targetRecipientId = String(req.body?.recipientId || '').trim();
    let targetRecipients = targetRecipientId
      ? allRecipients.filter((row) => row.id === targetRecipientId && row.enabled)
      : allRecipients.filter((row) => row.enabled);

    if (targetRecipientId && !targetRecipients.length) {
      res.status(404).json({ ok: false, error: 'recipient_not_found' });
      return;
    }

    if (!targetRecipients.length) {
      const waitSeconds = Math.min(50, Math.max(0, Number(req.body?.waitSeconds || 0)));
      discovery = await discoverTelegramNotifyChatId({
        db,
        getSetting,
        setSetting,
        botToken: token,
        longPollSeconds: waitSeconds,
      });
      targetRecipients = listTelegramRecipients(db, getSetting, setSetting)
        .filter((row) => row.enabled);
    }

    if (!targetRecipients.length) {
      const fallbackIds = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
      targetRecipients = fallbackIds.map((chatId) => ({
        chatId,
        enabled: true,
        includeSource: true,
        providerKeys: null,
      }));
    }

    if (!targetRecipients.length) {
      res.status(400).json({
        ok: false,
        error: 'chat_id_missing',
        message: '尚未配置推送对象。请在推送管理中添加 Chat ID，或向 @rscbot2026_bot 发送私聊。',
        discovery,
      });
      return;
    }

    const sampleEvents = [
      {
        type: 'new_listing',
        countryIso2: 'IN',
        countryName: 'India',
        previousStock: 0,
        newStock: 12,
        minPriceUsd: 0.2,
        currency: 'USD',
      },
      {
        type: 'restock',
        countryIso2: 'BR',
        countryName: 'Brazil',
        previousStock: 0,
        newStock: 8,
        minPriceUsd: 0.35,
        currency: 'USD',
      },
    ];
    const catalog = listProviderAlertCatalog();
    const testHeader = '🧪 <b>SMSBazaar 推送格式测试</b>\n\n以下为模拟告警样式：\n\n';

    function resolveSampleProvider(recipient) {
      if (Array.isArray(recipient.providerKeys) && recipient.providerKeys.length) {
        return catalog.find((row) => recipient.providerKeys.includes(row.providerKey))
          || resolveProviderAlertMeta(recipient.providerKeys[0]);
      }
      return catalog.find((row) => row.providerKey === 'smstg') || catalog[0];
    }

    try {
      const results = [];
      for (const recipient of targetRecipients) {
        if (Array.isArray(recipient.providerKeys) && recipient.providerKeys.length === 0) {
          results.push({ chatId: recipient.chatId, ok: false, error: 'no_providers_selected' });
          continue;
        }
        const sampleProvider = resolveSampleProvider(recipient);
        const includeSource = recipient.includeSource !== false;
        const sampleDefinition = getProviderDefinition(sampleProvider?.providerKey) || {};
        const accountBalance = includeSource
          ? await resolveProviderAccountBalance(db, sampleProvider?.providerKey)
          : null;
        const sampleText = formatInventoryAlertLines(sampleEvents, {
          serviceLabel: 'Telegram 接码',
          providerName: sampleProvider?.displayName || '',
          alertCode: sampleProvider?.alertCode || '',
          includeSource,
          portalUrl: resolvePortalUrl(sampleDefinition.providerKey
            ? sampleDefinition
            : { ...sampleDefinition, providerKey: sampleProvider?.providerKey }),
          accountBalance,
        });
        const chunkResults = await sendTelegramBroadcast({
          botToken: token,
          chatIds: [recipient.chatId],
          text: `${testHeader}${sampleText}`,
          sendTelegramMessage,
        });
        results.push(...chunkResults);
      }
      const failed = results.filter((row) => !row.ok);
      if (failed.length === results.length) {
        res.status(502).json({
          ok: false,
          error: 'send_failed',
          message: failed[0]?.error || 'all_failed',
          results: results.map((row) => ({ ...row, chatId: maskChatId(row.chatId) })),
        });
        return;
      }
      res.json({
        ok: true,
        sent: true,
        results: results.map((row) => ({ ...row, chatId: maskChatId(row.chatId) })),
        discovery,
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: 'send_failed', message: error.message });
    }
  });

  app.put('/api/settings/keys', requireAdmin(db), (req, res) => {
    setNoStore(res);
    const keys = req.body?.keys && typeof req.body.keys === 'object' ? req.body.keys : {};
    const allowed = new Set(listProviders().map((provider) => provider.keyEnv));
    const updated = [];

    for (const [keyEnv, value] of Object.entries(keys)) {
      if (!allowed.has(keyEnv)) continue;
      // Empty string clears the stored key (falls back to env).
      upsertProviderKey(db, keyEnv, String(value ?? '').trim());
      updated.push(keyEnv);
    }

    if (typeof req.body?.adminPassword === 'string' && req.body.adminPassword.trim()) {
      setAdminPassword(db, req.body.adminPassword.trim());
    }

    res.json({
      ok: true,
      updated,
      providers: listProviderKeySettings(db),
    });
  });

  app.post('/api/settings/keys/test', requireAdmin(db), async (req, res) => {
    setNoStore(res);
    const keyEnv = String(req.body?.keyEnv || '').trim();
    const providerDef = listProviders().find((provider) => provider.keyEnv === keyEnv);
    if (!providerDef) {
      res.status(400).json({ ok: false, error: 'invalid_key_env' });
      return;
    }

    const draftKey = String(req.body?.apiKey ?? '').trim();
    const apiKey = draftKey || resolveProviderApiKey(db, keyEnv);
    const result = await testProviderKeySafe(providerDef.providerKey, apiKey);
    saveProviderConnectivityFromTest(db, result);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/settings/keys/test-all', requireAdmin(db), async (req, res) => {
    setNoStore(res);
    const draftKeys = req.body?.keys && typeof req.body.keys === 'object' ? req.body.keys : {};
    const providers = listProviders();
    const results = await Promise.all(providers.map(async (provider) => {
      const draftKey = String(draftKeys[provider.keyEnv] ?? '').trim();
      const apiKey = draftKey || resolveProviderApiKey(db, provider.keyEnv);
      if (!apiKey && !provider.publicWithoutKey) {
        return {
          ok: false,
          providerKey: provider.providerKey,
          displayName: provider.displayName,
          keyEnv: provider.keyEnv,
          message: '未配置 API Key',
          details: {},
          latencyMs: 0,
        };
      }
      const result = await testProviderKeySafe(provider.providerKey, apiKey);
      saveProviderConnectivityFromTest(db, result);
      return result;
    }));

    res.json({
      ok: results.every((result) => result.ok),
      results,
    });
  });

  app.post('/api/refresh', async (req, res) => {
    setNoStore(res);
    const serviceKey = resolveServiceKey(req.body?.service || req.query.service);

    const sessionToken = extractBearerToken(req);
    const session = getSession(sessionToken);
    const providedToken = String(
      req.get('x-admin-refresh-token')
      || req.get('authorization')?.replace(/^Bearer\s+/i, '')
      || '',
    ).trim();

    const authorizedBySession = Boolean(session);
    const authorizedByLegacyToken = Boolean(adminRefreshToken) && providedToken === adminRefreshToken;

    if (!authorizedBySession && !authorizedByLegacyToken) {
      if (!adminRefreshToken && !getAdminPasswordRecord(db)) {
        res.status(503).json({
          accepted: false,
          reason: 'admin_refresh_not_configured',
        });
        return;
      }
      res.status(403).json({
        accepted: false,
        reason: 'forbidden',
      });
      return;
    }

    const result = typeof refreshController.triggerRefresh === 'function'
      ? refreshController.triggerRefresh('manual', serviceKey)
      : await refreshController.refreshAll('manual', serviceKey);
    res.status(result.accepted ? 202 : 429).json(result);
  });

  app.get('/api/gateway/v1/meta', (req, res) => {
    setApiCacheHeaders(res);
    res.json(getGatewayMeta());
  });

  app.get('/api/gateway/v1/prices', async (req, res) => {
    const providerKey = String(req.query.provider || '').trim();
    if (!providerKey) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'bad_request',
        message: '缺少 provider 参数',
      });
      return;
    }

    const source = String(req.query.source || 'snapshot').trim().toLowerCase();
    const serviceKey = resolveServiceKey(req.query.service);

    if (source === 'live') {
      const auth = requireGatewayAuth(req, res, db);
      if (!auth) return;
      if (!exchangeRateService) {
        res.status(503).json({
          schema: 'smsbazaar.gateway.v1',
          status: 'error',
          code: 'exchange_rates_unavailable',
          message: '汇率服务未就绪',
        });
        return;
      }
      try {
        const payload = await getUnifiedPrices({
          db,
          exchangeRateService,
          providerKey,
          serviceKey,
          source: 'live',
          auth,
        });
        setNoStore(res);
        res.json(payload);
      } catch (error) {
        res.status(400).json({
          schema: 'smsbazaar.gateway.v1',
          status: 'error',
          code: 'prices_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    setApiCacheHeaders(res);
    try {
      const payload = await getUnifiedPrices({
        db,
        exchangeRateService,
        providerKey,
        serviceKey,
        source: 'snapshot',
        auth: { mode: 'public' },
      });
      res.json(payload);
    } catch (error) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'prices_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/gateway/v1/balance', async (req, res) => {
    setNoStore(res);
    const auth = requireGatewayAuth(req, res, db);
    if (!auth) return;

    const providerKey = String(req.query.provider || '').trim();
    if (!providerKey) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'bad_request',
        message: '缺少 provider 参数',
      });
      return;
    }

    try {
      const payload = await getUnifiedBalance({ db, providerKey, auth });
      res.status(payload.status === 'ok' ? 200 : 400).json(payload);
    } catch (error) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'balance_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/gateway/v1/activate', async (req, res) => {
    setNoStore(res);
    const auth = requireGatewayAuth(req, res, db);
    if (!auth) return;

    const providerKey = String(req.query.provider || '').trim();
    if (!providerKey) {
      res.status(400).json({
        status: 'error',
        message: 'BAD_PROVIDER',
      });
      return;
    }

    try {
      const result = await proxyActivate({
        db,
        providerKey,
        query: req.query,
        auth,
      });
      if (result.contentType === 'application/json') {
        res.type('application/json').send(result.body);
        return;
      }
      res.type('text/plain').send(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'BAD_KEY') {
        res.type('text/plain').send('BAD_KEY');
        return;
      }
      if (message === 'BAD_ACTION') {
        res.type('text/plain').send('BAD_ACTION');
        return;
      }
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'activate_proxy_failed',
        message,
      });
    }
  });

  function readOrderParams(req) {
    const source = { ...req.query, ...req.body };
    return {
      providerKey: String(source.provider || '').trim(),
      serviceKey: String(source.service || 'openai_chatgpt').trim(),
      activationId: String(source.activationId || source.id || '').trim(),
      country: source.country,
      countryId: source.countryId,
      operator: source.operator,
      maxPrice: source.maxPrice,
      price: source.price,
      providerIds: source.providerIds,
      serviceId: source.serviceId,
      projectId: source.projectId,
      pool: source.pool,
      phoneNumber: source.phoneNumber,
      state: source.state,
      areacode: source.areacode,
      markup: source.markup,
    };
  }

  app.post('/api/gateway/v1/order', async (req, res) => {
    setNoStore(res);
    const auth = requireGatewayAuth(req, res, db);
    if (!auth) return;

    const params = readOrderParams(req);
    if (!params.providerKey) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'bad_request',
        message: '缺少 provider 参数',
      });
      return;
    }

    try {
      const payload = await createUnifiedOrder({
        db,
        auth,
        ...params,
      });
      res.status(payload.status === 'ok' ? 200 : 400).json(payload);
    } catch (error) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'order_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/gateway/v1/order', async (req, res) => {
    setNoStore(res);
    const auth = requireGatewayAuth(req, res, db);
    if (!auth) return;

    const params = readOrderParams(req);
    if (!params.providerKey || !params.activationId) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'bad_request',
        message: '缺少 provider 或 activationId 参数',
      });
      return;
    }

    try {
      const payload = await getUnifiedOrderStatus({
        db,
        auth,
        ...params,
      });
      res.status(payload.status === 'ok' ? 200 : 400).json(payload);
    } catch (error) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'order_status_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/gateway/v1/order/cancel', async (req, res) => {
    setNoStore(res);
    const auth = requireGatewayAuth(req, res, db);
    if (!auth) return;

    const params = readOrderParams(req);
    if (!params.providerKey || !params.activationId) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'bad_request',
        message: '缺少 provider 或 activationId 参数',
      });
      return;
    }

    try {
      const payload = await cancelUnifiedOrder({
        db,
        auth,
        ...params,
      });
      res.status(payload.status === 'ok' ? 200 : 400).json(payload);
    } catch (error) {
      res.status(400).json({
        schema: 'smsbazaar.gateway.v1',
        status: 'error',
        code: 'order_cancel_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const clientDist = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      const relativePath = path.relative(clientDist, filePath);
      if (relativePath.startsWith(`assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (relativePath.startsWith(`fonts${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'), {
      headers: { 'Cache-Control': 'no-cache' },
    }, (error) => {
      if (error) next();
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof URIError || error?.type === 'entity.parse.failed' || error?.status === 400) {
      res.status(400).json({ error: 'bad_request' });
      return;
    }

    console.error(error);
    res.status(500).json({ error: 'internal_server_error' });
  });

  return app;
}

module.exports = {
  createApp,
};
