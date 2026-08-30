import { describe, expect, it, vi } from 'vitest';
import {
  annotateSniperEvents,
  buildWebhookPayload,
  eventPassesWebhookFilters,
  filterEventsForWebhook,
  normalizeWebhookConfig,
  postAlertWebhook,
  signWebhookBody,
} from '../src/lib/alert-webhook';

describe('alert-webhook', () => {
  it('filters by max price and require balance', () => {
    const config = normalizeWebhookConfig({
      enabled: true,
      url: 'http://example.test/hook',
      filters: {
        maxPriceUsd: 0.5,
        requireBalance: true,
        alertTypes: ['restock', 'new_listing'],
      },
    });

    const events = [
      { type: 'restock', providerKey: 'a', countryIso2: 'US', minPriceUsd: 0.2 },
      { type: 'restock', providerKey: 'a', countryIso2: 'GB', minPriceUsd: 0.9 },
      { type: 'new_listing', providerKey: 'a', countryIso2: 'IN', minPriceUsd: 0.1 },
    ];

    const withBalance = filterEventsForWebhook(events, config, { balance: '3.2', currency: 'USD' });
    expect(withBalance.map((row) => row.countryIso2)).toEqual(['IN', 'US']);

    const noBalance = filterEventsForWebhook(events, config, { balance: '0', currency: 'USD' });
    expect(noBalance).toEqual([]);
  });

  it('marks sniper countries and builds sniper payload', () => {
    const config = normalizeWebhookConfig({
      enabled: true,
      url: 'http://example.test/hook',
      filters: {
        maxPriceUsd: 0.2,
        requireBalance: true,
        alertTypes: ['restock', 'new_listing'],
      },
      sniper: {
        enabled: true,
        targets: [
          { country: 'IR', maxPriceUsd: 0.9 },
          { country: 'IQ', maxPriceUsd: 1.8 },
        ],
        requireBalance: true,
      },
    });

    const events = [
      { type: 'restock', providerKey: 'smsbower', countryIso2: 'IR', minPriceUsd: 0.12 },
      { type: 'restock', providerKey: 'smsbower', countryIso2: 'IR', minPriceUsd: 1.2 },
      { type: 'restock', providerKey: 'smsbower', countryIso2: 'IQ', minPriceUsd: 1.5 },
      { type: 'restock', providerKey: 'smsbower', countryIso2: 'US', minPriceUsd: 0.1 },
    ];
    const annotated = annotateSniperEvents(events, config, { balance: '10', currency: 'USD' });
    expect(annotated.filter((row) => row.sniper).map((row) => `${row.countryIso2}:${row.minPriceUsd}`))
      .toEqual(['IR:0.12', 'IQ:1.5']);
    expect(annotated.find((row) => row.countryIso2 === 'IR' && row.minPriceUsd === 1.2)).toMatchObject({
      sniper: false,
      sniperOverPrice: true,
      sniperWatched: true,
      sniperMaxPriceUsd: 0.9,
    });

    // Over-ceiling watched country still passes notify filter even above global maxPrice.
    const filtered = filterEventsForWebhook(annotated, config, { balance: '10', currency: 'USD' });
    expect(filtered.some((row) => row.countryIso2 === 'IR' && row.minPriceUsd === 1.2)).toBe(true);
    expect(filtered.find((row) => row.countryIso2 === 'IR' && row.minPriceUsd === 1.2).sniper).toBe(false);

    const payload = buildWebhookPayload({
      serviceKey: 'telegram',
      serviceLabel: 'Telegram 接码',
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      accountBalance: { balance: '10', currency: 'USD' },
      events: annotated.filter((row) => row.sniper),
      source: 'sniper',
      sniper: true,
    });
    expect(payload.source).toBe('sniper');
    expect(payload.sniper).toBe(true);
    expect(payload.items[0].sniper).toBe(true);
    expect(payload.items[0].tags).toContain('sniper');
    expect(payload.items[0].priority).toBe('sniper');
  });

  it('when truncating, prefers newest alerts over older cheap ones', () => {
    const config = normalizeWebhookConfig({
      enabled: true,
      url: 'http://example.test/hook',
      filters: {
        maxPriceUsd: 1,
        maxItemsPerPush: 2,
        alertTypes: ['restock'],
      },
    });

    const events = [
      {
        type: 'restock',
        providerKey: 'a',
        countryIso2: 'US',
        minPriceUsd: 0.05,
        notifiedAt: '2026-08-30T10:00:00.000Z',
      },
      {
        type: 'restock',
        providerKey: 'a',
        countryIso2: 'IN',
        minPriceUsd: 0.18,
        notifiedAt: '2026-08-30T12:00:00.000Z',
      },
      {
        type: 'restock',
        providerKey: 'a',
        countryIso2: 'PH',
        minPriceUsd: 0.12,
        notifiedAt: '2026-08-30T11:00:00.000Z',
      },
    ];

    const filtered = filterEventsForWebhook(events, config, { balance: '5', currency: 'USD' });
    expect(filtered.map((row) => row.countryIso2)).toEqual(['IN', 'PH']);
  });

  it('builds simplified payload sorted by price', async () => {
    const payload = buildWebhookPayload({
      serviceKey: 'telegram',
      serviceLabel: 'Telegram 接码',
      providerKey: 'smstg',
      providerName: 'SMSTG',
      accountBalance: { balance: '1.5', currency: 'USD' },
      events: [
        {
          type: 'restock',
          providerKey: 'smstg',
          countryIso2: 'US',
          countryName: 'United States',
          previousStock: 1,
          newStock: 5,
          minPriceUsd: 1.2,
          currency: 'USD',
        },
        {
          type: 'restock',
          providerKey: 'smstg',
          countryIso2: 'IN',
          countryName: 'India',
          previousStock: 0,
          newStock: 9,
          minPriceUsd: 0.15,
          currency: 'USD',
        },
      ],
    });

    expect(payload.schema).toBe('smsall.alert.v1');
    expect(payload.items[0].country).toBe('IN');
    expect(payload.items[0].priceUsd).toBe(0.15);
    expect(payload.items[0].balance).toBe(1.5);
    expect(payload.items[1].country).toBe('US');
  });

  it('posts webhook with signature headers', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 204,
      text: async () => '',
    }));

    const payload = {
      schema: 'smsall.alert.v1',
      itemCount: 1,
      items: [{ type: 'restock', country: 'IN', priceUsd: 0.1 }],
    };
    const secret = 'hook-secret';
    const result = await postAlertWebhook({
      config: { enabled: true, url: 'http://example.test/hook', secret, timeoutMs: 3000 },
      payload,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(init.headers['X-Smsall-Signature']).toBe(signWebhookBody(secret, init.body));
  });

  it('rejects wrong alert type when filtered', () => {
    const ok = eventPassesWebhookFilters(
      { type: 'restock', providerKey: 'a', minPriceUsd: 0.2 },
      normalizeWebhookConfig({ filters: { alertTypes: ['new_listing'] } }).filters,
      null,
    );
    expect(ok).toBe(false);
  });
});
