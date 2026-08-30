import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseBalancePayload,
  resolveCountrySlug,
  fetchProviderOffers,
} from '../src/lib/providers/smstg';

describe('smstg provider', () => {
  it('parses balance from JSON and legacy text shapes', () => {
    expect(parseBalancePayload({ balance: 12.5 })).toBe(12.5);
    expect(parseBalancePayload({ message: 'ACCESS_BALANCE:9.99' })).toBe(9.99);
    expect(parseBalancePayload({ raw: 'ACCESS_BALANCE:3.20' })).toBe(3.2);
  });

  it('maps country tokens to lowercase ISO slugs', () => {
    expect(resolveCountrySlug('US')).toBe('us');
    expect(resolveCountrySlug('in')).toBe('in');
  });

  it('scrapes public country prices for telegram service', async () => {
    global.fetch = vi.fn();
    const responses = [
      '<url>https://smstg.org/en/countries/in</url><url>https://smstg.org/en/countries/us</url>',
      '<a href="https://smstg.org/en/countries/in" title="Buy Telegram account India for $0.20 — OTP"></a>',
      '<title>Buy Telegram account United States for $1.25 — OTP</title>',
    ];
    for (const body of responses) {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => body,
      });
    }

    const exchangeRateService = {
      convertToUsd: async (amount) => Number(amount),
    };

    const result = await fetchProviderOffers({
      mapping: {
        providerKey: 'smstg',
        displayName: 'SMSTG',
        serviceCode: 'tg',
        baseUrl: 'https://smstg.org/api',
      },
      exchangeRateService,
      apiKey: 'test-key',
    });

    expect(result.error).toBe('');
    expect(result.offers.length).toBe(2);
    const india = result.offers.find((row) => row.countryIso2 === 'IN');
    const us = result.offers.find((row) => row.countryIso2 === 'US');
    expect(india?.minPriceUsd).toBe(0.2);
    expect(us?.minPriceUsd).toBe(1.25);
  });

  it('rejects non-telegram services', async () => {
    const result = await fetchProviderOffers({
      mapping: {
        providerKey: 'smstg',
        displayName: 'SMSTG',
        serviceCode: 'dr',
        baseUrl: 'https://smstg.org/api',
      },
      exchangeRateService: { convertToUsd: async (v) => v },
      apiKey: 'test-key',
    });
    expect(result.error).toMatch(/Telegram/);
    expect(result.offers).toEqual([]);
  });
});
