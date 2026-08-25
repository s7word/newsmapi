import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/lib/db';
import {
  buildDedupeKey,
  createInventoryAlertService,
  parseRestockCooldownMs,
} from '../src/lib/inventory-alerts';

describe('inventory-alerts', () => {
  let db;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = createDatabase(':memory:');
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_NOTIFY_CHAT_ID = '12345';
    process.env.TELEGRAM_ALERT_SERVICE_KEYS = 'telegram';
    process.env.TELEGRAM_ALERT_RESTOCK_COOLDOWN_MS = '0';
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  const baseOffer = (overrides = {}) => ({
    providerKey: 'hero-sms',
    providerName: 'Hero SMS',
    countryIso2: 'BR',
    countryName: 'Brazil',
    countryDisplayName: 'Brazil',
    status: 'in_stock',
    currency: 'USD',
    minPriceUsd: 0.2,
    minPriceOriginal: 0.2,
    inventoryTotal: 8,
    tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 8, providerRef: '' }],
    lastFetchedAt: '2026-08-24T00:00:00.000Z',
    errorMessage: '',
    metadata: {},
    ...overrides,
  });

  it('notifies every 0→stock restock episode when cooldown is 0', async () => {
    const service = createInventoryAlertService({ db });
    const outOfStock = {
      offers: [
        baseOffer({
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 0, providerRef: '' }],
        }),
      ],
    };

    const first = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: outOfStock,
      newPayload: { offers: [baseOffer({ inventoryTotal: 12 })] },
    });
    expect(first.sent).toBe(true);
    expect(first.eventCount).toBe(1);
    expect(first.types).toEqual(['restock']);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: outOfStock,
      newPayload: { offers: [baseOffer({ inventoryTotal: 8 })] },
    });
    expect(second.sent).toBe(true);
    expect(second.eventCount).toBe(1);
    expect(second.types).toEqual(['restock']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('notifies when in-stock inventory increases', async () => {
    const service = createInventoryAlertService({ db });
    const result = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: { offers: [baseOffer({ inventoryTotal: 5 })] },
      newPayload: { offers: [baseOffer({ inventoryTotal: 20 })] },
    });
    expect(result.sent).toBe(true);
    expect(result.eventCount).toBe(1);
    expect(result.types).toEqual(['restock']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text).toContain('📦 补货');
    expect(body.text).toContain('5 → 20');
  });

  it('does not notify when inventory decreases or stays the same', async () => {
    const service = createInventoryAlertService({ db });
    const decrease = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: { offers: [baseOffer({ inventoryTotal: 20 })] },
      newPayload: { offers: [baseOffer({ inventoryTotal: 5 })] },
    });
    expect(decrease.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();

    const unchanged = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: { offers: [baseOffer({ inventoryTotal: 5 })] },
      newPayload: { offers: [baseOffer({ inventoryTotal: 5 })] },
    });
    expect(unchanged.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never re-notifies the same new listing', async () => {
    const service = createInventoryAlertService({ db });
    const previousPayload = { offers: [baseOffer({ countryIso2: 'US', countryName: 'United States' })] };
    const newPayload = {
      offers: [
        baseOffer({ countryIso2: 'US', countryName: 'United States' }),
        baseOffer({
          countryIso2: 'IN',
          countryName: 'India',
          countryDisplayName: 'India',
          inventoryTotal: 5,
        }),
      ],
    };

    const first = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload,
      newPayload,
    });
    expect(first.sent).toBe(true);
    expect(first.eventCount).toBe(1);
    expect(first.types).toEqual(['new_listing']);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload,
      newPayload,
    });
    expect(second.skipped).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses a unique restock dedupe key when cooldown is 0 (no Infinity bucket)', () => {
    expect(parseRestockCooldownMs(undefined)).toBe(0);
    expect(parseRestockCooldownMs('0')).toBe(0);
    expect(parseRestockCooldownMs('abc')).toBe(0);
    expect(parseRestockCooldownMs('5000')).toBe(5000);

    const key = buildDedupeKey('telegram', {
      type: 'restock',
      providerKey: 'hero-sms',
      countryIso2: 'BR',
      previousStock: 0,
      newStock: 12,
    }, 0);
    expect(key).not.toContain('Infinity');
    expect(key).toMatch(/^telegram:hero-sms:BR:restock:0-12-\d+$/);

    const bucketed = buildDedupeKey('telegram', {
      type: 'restock',
      providerKey: 'hero-sms',
      countryIso2: 'BR',
    }, 3600000);
    expect(bucketed).toMatch(/^telegram:hero-sms:BR:restock:\d+$/);
    expect(bucketed).not.toContain('Infinity');
  });

  it('uses chat id from database when env is empty', async () => {
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    const { addTelegramRecipient } = await import('../src/lib/telegram-recipients');
    const { getSetting, setSetting } = await import('../src/lib/settings');
    addTelegramRecipient(db, getSetting, setSetting, { chatId: '99999', label: 'test' });

    const service = createInventoryAlertService({ db });
    expect(service.isEnabled()).toBe(true);

    const result = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: {
        offers: [
          baseOffer({
            inventoryTotal: 0,
            status: 'out_of_stock',
            tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 0, providerRef: '' }],
          }),
        ],
      },
      newPayload: { offers: [baseOffer({ inventoryTotal: 5 })] },
    });
    expect(result.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('routes alerts by recipient provider filter and includeSource', async () => {
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    const { addTelegramRecipient, updateTelegramRecipient } = await import('../src/lib/telegram-recipients');
    const { getSetting, setSetting } = await import('../src/lib/settings');

    const filtered = addTelegramRecipient(db, getSetting, setSetting, { chatId: '1001', label: 'A' });
    const generic = addTelegramRecipient(db, getSetting, setSetting, { chatId: '1002', label: 'B' });
    updateTelegramRecipient(db, getSetting, setSetting, filtered.id, {
      includeSource: true,
      providerKeys: ['smstg'],
    });
    updateTelegramRecipient(db, getSetting, setSetting, generic.id, {
      includeSource: false,
      providerKeys: null,
    });

    const service = createInventoryAlertService({ db });
    const previousPayload = {
      offers: [
        baseOffer({
          providerKey: 'hero-sms',
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 0, providerRef: '' }],
        }),
      ],
    };
    const newPayload = { offers: [baseOffer({ providerKey: 'hero-sms', inventoryTotal: 9 })] };

    const heroResult = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload,
      newPayload,
    });
    expect(heroResult.sent).toBe(true);
    expect(heroResult.recipientCount).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const heroBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(heroBody.chat_id).toBe('1002');
    expect(heroBody.text).not.toContain('P01');
    expect(heroBody.text).not.toContain('Hero SMS');
    expect(heroBody.text).not.toContain('hero-sms');
    expect(heroBody.text).not.toContain('打开平台查看');
    expect(heroBody.text).not.toContain('https://hero-sms.com');
    expect(heroBody.text).toContain('Brazil (BR)');

    const smstgPrevious = {
      offers: [
        baseOffer({
          providerKey: 'smstg',
          countryIso2: 'IN',
          countryName: 'India',
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 0, providerRef: '' }],
        }),
      ],
    };
    const smstgResult = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'smstg',
      providerName: 'SMSTG',
      previousPayload: smstgPrevious,
      newPayload: {
        offers: [baseOffer({
          providerKey: 'smstg',
          countryIso2: 'IN',
          countryName: 'India',
          inventoryTotal: 4,
        })],
      },
    });
    expect(smstgResult.sent).toBe(true);
    expect(smstgResult.recipientCount).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const smstgBodies = global.fetch.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body));
    const sourceMessage = smstgBodies.find((row) => row.chat_id === '1001');
    const genericMessage = smstgBodies.find((row) => row.chat_id === '1002');
    expect(sourceMessage.text).toContain('来源编号');
    expect(sourceMessage.text).toMatch(/P\d{2}/);
    expect(sourceMessage.text).toContain('SMSTG');
    expect(sourceMessage.text).toContain('<a href="https://smstg.org">打开平台查看</a>');
    expect(sourceMessage.text).toContain('🔗 平台链接：https://smstg.org');
    expect(sourceMessage.text).toContain('💰 账户余额：—（未测试）');
    expect(genericMessage.text).not.toContain('SMSTG');
    expect(genericMessage.text).not.toContain('来源编号');
    expect(genericMessage.text).not.toContain('打开平台查看');
    expect(genericMessage.text).not.toContain('https://smstg.org');
    expect(genericMessage.text).not.toContain('账户余额');
  });

  it('includes cached connectivity balance for source-enabled recipients', async () => {
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    const { addTelegramRecipient, updateTelegramRecipient } = await import('../src/lib/telegram-recipients');
    const { getSetting, setSetting, saveProviderConnectivity } = await import('../src/lib/settings');
    const recipient = addTelegramRecipient(db, getSetting, setSetting, { chatId: '1184856337', label: '运营测试' });
    updateTelegramRecipient(db, getSetting, setSetting, recipient.id, { includeSource: true });
    saveProviderConnectivity(db, 'smstg', {
      ok: true,
      balance: '12.50',
      currency: 'USD',
      checkedAt: new Date().toISOString(),
    });

    const service = createInventoryAlertService({ db });
    const result = await service.processProviderRefresh({
      serviceKey: 'telegram',
      providerKey: 'smstg',
      providerName: 'SMSTG',
      previousPayload: {
        offers: [
          baseOffer({
            providerKey: 'smstg',
            countryIso2: 'IN',
            countryName: 'India',
            inventoryTotal: 0,
            status: 'out_of_stock',
            tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 0, providerRef: '' }],
          }),
        ],
      },
      newPayload: {
        offers: [baseOffer({
          providerKey: 'smstg',
          countryIso2: 'IN',
          countryName: 'India',
          inventoryTotal: 4,
        })],
      },
    });

    expect(result.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe('1184856337');
    expect(body.text).toContain('来源编号');
    expect(body.text).toContain('💰 账户余额：USD 12.50');
    expect(body.text).toContain('<a href="https://smstg.org">打开平台查看</a>');
    expect(body.text).toContain('🔗 平台链接：https://smstg.org');
    expect(body.text).toContain('href=');
    expect(body.text).toContain('https://');
    expect(body.text).not.toContain('SMSTG_API_KEY');
    expect(body.disable_web_page_preview).toBe(true);
  });

  it('skips non-configured services', async () => {
    const service = createInventoryAlertService({ db });
    const result = await service.processProviderRefresh({
      serviceKey: 'openai_chatgpt',
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousPayload: { offers: [baseOffer()] },
      newPayload: { offers: [baseOffer({ inventoryTotal: 99 })] },
    });
    expect(result.skipped).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
