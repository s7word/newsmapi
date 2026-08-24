import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { createInventoryAlertService } from '../src/lib/inventory-alerts';

describe('inventory-alerts', () => {
  let db;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = createDatabase(':memory:');
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_NOTIFY_CHAT_ID = '12345';
    process.env.TELEGRAM_ALERT_SERVICE_KEYS = 'telegram';
    process.env.TELEGRAM_ALERT_RESTOCK_COOLDOWN_MS = '3600000';
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

  it('sends telegram message on restock and dedupes repeats', async () => {
    const service = createInventoryAlertService({ db });
    const previousPayload = {
      offers: [
        baseOffer({
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.2, priceOriginal: 0.2, stock: 0, providerRef: '' }],
        }),
      ],
    };
    const newPayload = {
      offers: [baseOffer({ inventoryTotal: 12 })],
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

  it('uses chat id from database when env is empty', async () => {
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    const { setSetting } = await import('../src/lib/settings');
    setSetting(db, 'telegram_notify_chat_id', '99999');

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
