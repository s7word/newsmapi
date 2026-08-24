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
      newOffers: [baseOffer({ inventoryTotal: 42 })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('restock');
    expect(events[0].previousStock).toBe(0);
    expect(events[0].newStock).toBe(42);
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
});
