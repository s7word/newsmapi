import { describe, expect, it } from 'vitest';

async function loadDiffModule() {
  return await import('../src/lib/offer-diff.js');
}

describe('offer-diff', () => {
  const baseOffer = (overrides = {}) => ({
    providerKey: 'hero-sms',
    providerName: 'Hero SMS',
    countryIso2: 'US',
    countryName: 'United States',
    countryDisplayName: 'United States',
    status: 'in_stock',
    currency: 'USD',
    minPriceUsd: 0.12,
    minPriceOriginal: 0.12,
    inventoryTotal: 10,
    tiers: [{ priceUsd: 0.12, priceOriginal: 0.12, stock: 10, providerRef: '' }],
    lastFetchedAt: '2026-08-24T00:00:00.000Z',
    errorMessage: '',
    metadata: {},
    ...overrides,
  });

  it('indexes offers by provider and country', async () => {
    const mod = await loadDiffModule();
    expect(mod.offerKey({ providerKey: 'hero-sms', countryIso2: 'us' })).toBe('hero-sms:US');
    const map = new Map();
    for (const offer of [baseOffer()]) {
      if (!offer?.providerKey || !offer?.countryIso2) continue;
      map.set(mod.offerKey(offer), offer);
    }
    expect(map.size).toBe(1);
  });

  it('skips baseline when previous catalog is empty', async () => {
    const mod = await loadDiffModule();
    const diffProviderOffers = mod.diffProviderOffers;
    const events = diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers: [],
      newOffers: [baseOffer()],
    });
    expect(events).toEqual([]);
  });

  it('detects new listing with stock', async () => {
    const mod = await loadDiffModule();
    const diffProviderOffers = mod.diffProviderOffers;
    const previousOffers = [baseOffer({ countryIso2: 'US' })];
    const newOffers = [
      baseOffer({ countryIso2: 'US' }),
      baseOffer({ countryIso2: 'IN', countryName: 'India', inventoryTotal: 5 }),
    ];
    const events = diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers,
      newOffers,
    });
    expect(previousOffers.length).toBe(1);
    expect(newOffers.length).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('new_listing');
    expect(events[0].countryIso2).toBe('IN');
    expect(events[0].newStock).toBe(5);
  });

  it('detects restock from zero inventory', async () => {
    const mod = await loadDiffModule();
    const diffProviderOffers = mod.diffProviderOffers;
    const events = diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers: [
        baseOffer({
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.12, priceOriginal: 0.12, stock: 0, providerRef: '' }],
        }),
      ],
      newOffers: [baseOffer({ inventoryTotal: 8 })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('restock');
    expect(events[0].previousStock).toBe(0);
    expect(events[0].newStock).toBe(8);
  });

  it('detects restock when in-stock inventory increases', async () => {
    const mod = await loadDiffModule();
    const events = mod.diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers: [baseOffer({ inventoryTotal: 5 })],
      newOffers: [baseOffer({ inventoryTotal: 20 })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('restock');
    expect(events[0].previousStock).toBe(5);
    expect(events[0].newStock).toBe(20);
  });

  it('ignores inventory decreases', async () => {
    const mod = await loadDiffModule();
    const events = mod.diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers: [baseOffer({ inventoryTotal: 20 })],
      newOffers: [baseOffer({ inventoryTotal: 5 })],
    });
    expect(events).toEqual([]);
  });

  it('ignores unchanged inventory', async () => {
    const mod = await loadDiffModule();
    const events = mod.diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers: [baseOffer({ inventoryTotal: 5 })],
      newOffers: [baseOffer({ inventoryTotal: 5 })],
    });
    expect(events).toEqual([]);
  });

  it('ignores countries that stay out of stock', async () => {
    const mod = await loadDiffModule();
    const diffProviderOffers = mod.diffProviderOffers;
    const events = diffProviderOffers({
      providerKey: 'hero-sms',
      providerName: 'Hero SMS',
      previousOffers: [
        baseOffer({
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.12, priceOriginal: 0.12, stock: 0, providerRef: '' }],
        }),
      ],
      newOffers: [
        baseOffer({
          inventoryTotal: 0,
          status: 'out_of_stock',
          tiers: [{ priceUsd: 0.12, priceOriginal: 0.12, stock: 0, providerRef: '' }],
        }),
      ],
    });
    expect(events).toEqual([]);
  });

  it('diffs per supplier tier when providerRef is present', async () => {
    const mod = await loadDiffModule();
    const smsbowerOffer = (tiers, overrides = {}) => baseOffer({
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      countryIso2: 'IQ',
      countryName: 'Iraq',
      inventoryTotal: tiers.reduce((sum, tier) => sum + tier.stock, 0),
      minPriceUsd: tiers[0]?.priceUsd ?? 0,
      minPriceOriginal: tiers[0]?.priceOriginal ?? 0,
      tiers,
      ...overrides,
    });

    const events = mod.diffProviderOffers({
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      previousOffers: [
        smsbowerOffer([
          { priceUsd: 0.283, priceOriginal: 0.283, stock: 100, providerRef: '3193' },
          { priceUsd: 0.794, priceOriginal: 0.794, stock: 50, providerRef: '3451' },
        ]),
      ],
      newOffers: [
        smsbowerOffer([
          { priceUsd: 0.283, priceOriginal: 0.283, stock: 100, providerRef: '3193' },
          { priceUsd: 0.794, priceOriginal: 0.794, stock: 80, providerRef: '3451' },
        ]),
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'restock',
      countryIso2: 'IQ',
      providerRef: '3451',
      supplierIds: ['3451'],
      previousStock: 50,
      newStock: 80,
      minPriceUsd: 0.794,
    });
  });

  it('emits separate restocks for multiple supplier tiers in one refresh', async () => {
    const mod = await loadDiffModule();
    const offer = (tiers) => baseOffer({
      providerKey: 'smsbower',
      countryIso2: 'IQ',
      inventoryTotal: tiers.reduce((sum, tier) => sum + tier.stock, 0),
      tiers,
    });
    const events = mod.diffProviderOffers({
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      previousOffers: [
        offer([
          { priceUsd: 0.283, priceOriginal: 0.283, stock: 10, providerRef: '3193' },
          { priceUsd: 1, priceOriginal: 1, stock: 0, providerRef: '2579' },
        ]),
      ],
      newOffers: [
        offer([
          { priceUsd: 0.283, priceOriginal: 0.283, stock: 20, providerRef: '3193' },
          { priceUsd: 1, priceOriginal: 1, stock: 5, providerRef: '2579' },
        ]),
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.providerRef).sort()).toEqual(['2579', '3193']);
    expect(events.find((event) => event.providerRef === '2579')).toMatchObject({
      type: 'restock',
      minPriceUsd: 1,
      previousStock: 0,
      newStock: 5,
    });
  });

  it('uses tier price for sniper accuracy instead of country minimum', async () => {
    const mod = await loadDiffModule();
    const events = mod.diffProviderOffers({
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      previousOffers: [
        baseOffer({
          providerKey: 'smsbower',
          countryIso2: 'IQ',
          inventoryTotal: 100,
          tiers: [
            { priceUsd: 0.283, priceOriginal: 0.283, stock: 100, providerRef: '3193' },
            { priceUsd: 1, priceOriginal: 1, stock: 0, providerRef: '2579' },
          ],
        }),
      ],
      newOffers: [
        baseOffer({
          providerKey: 'smsbower',
          countryIso2: 'IQ',
          inventoryTotal: 105,
          minPriceUsd: 0.283,
          tiers: [
            { priceUsd: 0.283, priceOriginal: 0.283, stock: 100, providerRef: '3193' },
            { priceUsd: 1, priceOriginal: 1, stock: 5, providerRef: '2579' },
          ],
        }),
      ],
    });

    const expensiveTier = events.find((event) => event.providerRef === '2579');
    expect(expensiveTier?.minPriceUsd).toBe(1);
    expect(expensiveTier?.minPriceUsd).not.toBe(0.283);
  });
});
