import { describe, expect, it, vi } from 'vitest';
import { fetchProviderOffers as fetchFiveSim } from '../src/lib/providers/fivesim';
import { fetchProviderOffers as fetchNexSms } from '../src/lib/providers/nexsms';
import { fetchProviderOffers as fetchSmsVerification } from '../src/lib/providers/sms-verification-number';
import { fetchProviderOffers as fetchHero } from '../src/lib/providers/hero-sms';
import { fetchProviderOffers as fetchGrizzly } from '../src/lib/providers/grizzlysms';
import { fetchProviderOffers as fetchTiger } from '../src/lib/providers/tiger-sms';
import { buildCountryLookup as buildTigerCountryLookup } from '../src/lib/providers/tiger-sms';
import { fetchProviderOffers as fetchSmsPool } from '../src/lib/providers/smspool';
import { extractCountriesForService } from '../src/lib/providers/smsbower';

const exchangeRateService = {
  convertToUsd: async (amount) => Number(amount),
};

function mockFetchSequence(responses) {
  global.fetch = vi.fn();
  for (const response of responses) {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(response),
    });
  }
}

describe('provider adapters', () => {
  it('parses tiger-sms country arrays from getCountries', () => {
    const lookup = buildTigerCountryLookup([
      { id: 12, eng: 'United States' },
      { id: 1, eng: 'Ukraine' },
    ]);
    expect(lookup.get('12')).toBe('United States');
    expect(lookup.get('1')).toBe('Ukraine');
  });

  it('parses smsbower country sheet', () => {
    const countries = extractCountriesForService({
      services: {
        '247': {
          countries: {
            1: {
              id: 1,
              iso: 'US',
              title: 'United States',
              positions: {
                1: { price: 0.25, count: 10, agent_ids: [11] },
              },
            },
          },
        },
      },
    }, 247);

    expect(countries).toHaveLength(1);
    expect(countries[0].iso).toBe('US');
    expect(countries[0].tiers[0].stock).toBe(10);
  });

  it('parses 5sim product prices', async () => {
    mockFetchSequence([
      {
        openai: {
          england: {
            virtual34: { cost: 0.12, count: 7, rate: 99.9 },
          },
        },
      },
    ]);

    const result = await fetchFiveSim({
      mapping: { providerKey: '5sim', displayName: '5SIM', serviceCode: 'openai', baseUrl: 'https://5sim.net/v1' },
      exchangeRateService,
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('GB');
    expect(result.offers[0].tiers[0].providerRef).toBe('virtual34');
  });

  it('parses nexsms country price map', async () => {
    mockFetchSequence([
      { data: [{ id: 1, name: 'United States' }] },
      { data: [{ code: 'dr', name: 'OpenAI (ChatGPT)' }] },
      { code: 0, data: { countryId: 1, countryName: 'United States', priceMap: { '0.12': 8, '0.16': 3 } } },
    ]);

    const result = await fetchNexSms({
      mapping: { providerKey: 'nexsms', displayName: 'NexSMS', serviceCode: 'dr', baseUrl: 'https://api.nexsms.net/api' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].tiers).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[2][0]).not.toContain('countryId=');
  });

  it('merges duplicate NexSMS country routes into one offer', async () => {
    mockFetchSequence([
      { data: [{ id: 11, name: 'Philippines' }, { id: 12, name: 'Philippines route 2' }] },
      { data: [{ code: 'dr', name: 'OpenAI (ChatGPT)' }] },
      {
        code: 0,
        data: [
          { countryId: 11, countryName: 'Philippines', priceMap: { '0.10': 8, '0.20': 3 } },
          { countryId: 12, countryName: 'Philippines', priceMap: { '0.10': 5, '0.30': 2 } },
        ],
      },
    ]);

    const result = await fetchNexSms({
      mapping: { providerKey: 'nexsms', displayName: 'NexSMS', serviceCode: 'dr', baseUrl: 'https://api.nexsms.net/api' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].countryIso2).toBe('PH');
    expect(result.offers[0].inventoryTotal).toBe(18);
    expect(result.offers[0].tiers).toEqual([
      { priceOriginal: 0.1, priceUsd: 0.1, stock: 13, providerRef: '' },
      { priceOriginal: 0.2, priceUsd: 0.2, stock: 3, providerRef: '' },
      { priceOriginal: 0.3, priceUsd: 0.3, stock: 2, providerRef: '' },
    ]);
  });

  it('parses sms-verification-number prices', async () => {
    mockFetchSequence([
      [{ id: 1, name: 'United States' }],
      [{ id: 'dr', name: 'ChatGPT (openAI.com)', price: 0.22, quantity: 15 }],
    ]);

    const result = await fetchSmsVerification({
      mapping: { providerKey: 'sms-verification-number', displayName: 'SMS Verification Number', serviceCode: 'dr', baseUrl: 'https://sms-verification-number.com/stubs/handler_api' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
  });

  it('parses activate-compatible providers', async () => {
    const originalHeroApiKey = process.env.HERO_SMS_API_KEY;
    mockFetchSequence([
      { 1: { eng: 'United States' } },
      { 1: { dr: { cost: 0.31, count: 4 } } },
    ]);
    const heroResult = await fetchHero({
      mapping: { providerKey: 'hero-sms', displayName: 'Hero SMS', serviceCode: 'dr', baseUrl: 'https://hero-sms.com/stubs/handler_api.php' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(heroResult.error).toBe('');
    expect(heroResult.offers[0].countryIso2).toBe('US');

    const compatiblePayload = {
      usa: {
        dr: {
          price: 0.31,
          count: 4,
        },
      },
    };

    mockFetchSequence([
      { 1: { eng: 'United States' } },
      compatiblePayload,
    ]);
    const grizzlyResult = await fetchGrizzly({
      mapping: { providerKey: 'grizzlysms', displayName: 'Grizzly SMS', serviceCode: 'dr', baseUrl: 'https://api.grizzlysms.com/stubs/handler_api.php' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(grizzlyResult.error).toBe('');

    mockFetchSequence([
      [{ id: 12, eng: 'United States' }],
      { 12: { dr: { cost: '0.0390', count: 1000 } } },
    ]);
    const tigerResult = await fetchTiger({
      mapping: {
        providerKey: 'tiger-sms',
        displayName: 'Tiger SMS',
        serviceCode: 'dr',
        baseUrl: 'https://api.tiger-sms.com/stubs/handler_api.php',
      },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(tigerResult.error).toBe('');
    expect(tigerResult.offers.length).toBeGreaterThan(0);
    expect(tigerResult.offers[0].minPriceUsd).toBe(0.039);

    mockFetchSequence([
      [
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 2,
          country_name: 'United Kingdom',
          short_name: 'GB',
          pool: 3,
          price: '0.07',
        },
      ],
      { success: 1, amount: 42 },
    ]);
    const poolResult = await fetchSmsPool({
      mapping: { providerKey: 'smspool', displayName: 'SMSPool', serviceCode: '671', baseUrl: 'https://api.smspool.net' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(poolResult.error).toBe('');
    expect(poolResult.offers[0].countryIso2).toBe('GB');
    expect(poolResult.offers[0].inventoryTotal).toBe(42);
    expect(poolResult.offers[0].tiers[0].providerRef).toBe('3');
    process.env.HERO_SMS_API_KEY = originalHeroApiKey;
  });

  it('reuses cached SMSPool stock outside the rolling batch', async () => {
    const previousStockBatchSize = process.env.SMSPOOL_STOCK_BATCH_SIZE;
    process.env.SMSPOOL_STOCK_BATCH_SIZE = '1';
    mockFetchSequence([
      [
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 68,
          country_name: 'Brazil',
          short_name: 'BR',
          pool: 12,
          price: '0.26',
        },
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
            country: 2,
            country_name: 'United Kingdom',
            short_name: 'GB',
            pool: 3,
            price: '0.07',
        },
      ],
      { success: 1, amount: 100 },
    ]);

    const poolResult = await fetchSmsPool({
      mapping: { providerKey: 'smspool', displayName: 'SMSPool', serviceCode: '671', baseUrl: 'https://api.smspool.net' },
      exchangeRateService,
      apiKey: 'key',
      previousSnapshot: {
        offers: [
          {
            countryIso2: 'BR',
            inventoryTotal: 900,
            lastFetchedAt: '2026-05-01T00:00:00.000Z',
              metadata: { stockFetchedAt: '2026-05-01T00:00:00.000Z' },
            },
            {
              countryIso2: 'GB',
              inventoryTotal: 800,
              tiers: [{ priceOriginal: 0.07, priceUsd: 0.07, stock: 800, providerRef: '3' }],
              lastFetchedAt: '2026-05-02T00:00:00.000Z',
              metadata: { stockFetchedAt: '2026-05-02T00:00:00.000Z' },
            },
        ],
      },
    });

    const br = poolResult.offers.find((offer) => offer.countryIso2 === 'BR');
    const gb = poolResult.offers.find((offer) => offer.countryIso2 === 'GB');
    expect(br.inventoryTotal).toBe(100);
    expect(br.metadata.stockRefreshStatus).toBe('refreshed');
    expect(gb.inventoryTotal).toBe(800);
    expect(gb.metadata.stockRefreshStatus).toBe('cached');
    expect(gb.status).toBe('in_stock');
    if (previousStockBatchSize === undefined) {
      delete process.env.SMSPOOL_STOCK_BATCH_SIZE;
    } else {
      process.env.SMSPOOL_STOCK_BATCH_SIZE = previousStockBatchSize;
    }
  });

  it('keeps real low-price SMSPool pools when they have stock', async () => {
    mockFetchSequence([
      [
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 12,
          country_name: 'Philippines',
          short_name: 'PH',
          pool: 3,
          price: '0.02',
        },
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 12,
          country_name: 'Philippines',
          short_name: 'PH',
          pool: 7,
          price: '0.04',
        },
      ],
      { success: 1, amount: 5685 },
      { success: 1, amount: 0 },
    ]);

    const poolResult = await fetchSmsPool({
      mapping: { providerKey: 'smspool', displayName: 'SMSPool', serviceCode: '671', baseUrl: 'https://api.smspool.net' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(poolResult.error).toBe('');
    expect(poolResult.offers[0].countryIso2).toBe('PH');
    expect(poolResult.offers[0].minPriceOriginal).toBe(0.02);
    expect(poolResult.offers[0].inventoryTotal).toBe(5685);
    expect(poolResult.offers[0].tiers[0]).toMatchObject({
      priceOriginal: 0.02,
      stock: 5685,
      providerRef: '3',
    });
  });

  it('parses smspva service prices', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({
        statusCode: 200,
        data: {
          scode: 'opt132',
          clist: [{
            ccode: 'US',
            cname: 'United States',
            opers: [{ opcode: 'Total_US', price: 0.15, count: 12 }],
          }],
        },
      }),
    });

    const { fetchProviderOffers } = await import('../src/lib/providers/smspva');
    const result = await fetchProviderOffers({
      mapping: { providerKey: 'smspva', displayName: 'SMSPVA', serviceCode: 'opt132' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
    expect(result.offers[0].tiers[0].priceOriginal).toBe(0.15);
    expect(result.offers[0].tiers[0].stock).toBe(12);
  });

  it('parses onlinesim per-country tariffs', async () => {
    process.env.ONLINESIM_RATES_DELAY_MS = '0';
    process.env.ONLINESIM_SERVICE_COOLDOWN_MS = '0';
    process.env.ONLINESIM_CATALOG_TTL_MS = '0';
    const { fetchProviderOffers, resetOnlineSimRuntime } = await import('../src/lib/providers/onlinesim');
    resetOnlineSimRuntime();
    mockFetchSequence([
      {
        response: '1',
        countries: {
          _1: { name: 'USA', original: 'usa', code: 1, enable: true },
        },
      },
      {
        response: '1',
        services: {
          _openai: { id: 158, count: 42, price: '3.21', service: 'ChatGPT', slug: 'openai' },
        },
      },
    ]);

    const result = await fetchProviderOffers({
      mapping: { providerKey: 'onlinesim', displayName: 'OnlineSim', serviceCode: 'openai' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
    expect(result.offers[0].tiers[0].priceOriginal).toBe(3.21);
    expect(result.offers[0].tiers[0].stock).toBe(42);
    delete process.env.ONLINESIM_RATES_DELAY_MS;
    delete process.env.ONLINESIM_SERVICE_COOLDOWN_MS;
    delete process.env.ONLINESIM_CATALOG_TTL_MS;
  });

  it('parses sms-bus country prices', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          code: 200,
          data: { '52': { id: 52, code: 'openai', title: 'OpenAI/ChatGPT' } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          code: 200,
          data: { '1': { id: 1, title: 'United States', code: 'us' } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          code: 200,
          data: {
            '52': {
              country_id: 1,
              project_id: 52,
              project_code: 'openai',
              cost: 1.25,
              total_count: 120,
              title: 'United States of America',
              code: 'us',
            },
          },
        }),
      });

    const { fetchProviderOffers } = await import('../src/lib/providers/sms-bus');
    const result = await fetchProviderOffers({
      mapping: { providerKey: 'sms-bus', displayName: 'SMS-Bus', serviceCode: 'openai' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
    expect(result.offers[0].tiers[0].priceOriginal).toBe(1.25);
    expect(result.offers[0].tiers[0].stock).toBe(120);
  });

  it('parses sms-rooms getPricesV3 country tiers', async () => {
    mockFetchSequence([
      { 1: { eng: 'United States' } },
      { 1: { tg: { price: 0.22, count: 8 } } },
    ]);
    const { fetchProviderOffers } = await import('../src/lib/providers/sms-rooms');
    const result = await fetchProviderOffers({
      mapping: {
        providerKey: 'sms-rooms',
        displayName: 'SMS-Rooms',
        serviceCode: 'tg',
        baseUrl: 'https://sms-rooms.com/stubs/handler_api.php',
      },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
    expect(result.offers[0].tiers[0].priceOriginal).toBe(0.22);
    expect(result.offers[0].tiers[0].stock).toBe(8);
  });

  it('falls back from getPricesV3 BAD_ACTION to getPrices for sms-rooms', async () => {
    mockFetchSequence([
      { 12: { eng: 'United States' } },
      'BAD_ACTION',
      { 12: { tg: { cost: 0.18, count: 3 } } },
    ]);
    const { fetchProviderOffers } = await import('../src/lib/providers/sms-rooms');
    const result = await fetchProviderOffers({
      mapping: {
        providerKey: 'sms-rooms',
        displayName: 'SMS-Rooms',
        serviceCode: 'tg',
        baseUrl: 'https://sms-rooms.com/stubs/handler_api.php',
      },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(result.error).toBe('');
    expect(result.offers[0].tiers[0].priceOriginal).toBe(0.18);
    expect(result.offers[0].tiers[0].stock).toBe(3);
  });

  it('reports sms-rooms BAD_KEY instead of unexpected payload', async () => {
    mockFetchSequence(['BAD_KEY', 'BAD_KEY']);
    const { fetchProviderOffers } = await import('../src/lib/providers/sms-rooms');
    const result = await fetchProviderOffers({
      mapping: {
        providerKey: 'sms-rooms',
        displayName: 'SMS-Rooms',
        serviceCode: 'tg',
        baseUrl: 'https://sms-rooms.com/stubs/handler_api.php',
      },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(result.offers).toEqual([]);
    expect(result.error).toContain('BAD_KEY');
  });

  it('matches SMSCode Telegram variants and classifies invalid keys', async () => {
    const {
      collectMatchingTiers,
      parseRatesPayload,
      fetchProviderOffers,
    } = await import('../src/lib/providers/smscode');

    const tiers = collectMatchingTiers([
      { app: 'Telegram', rate: '0.40', stock: 5 },
      { app: 'Telegram1', rate: '0.55' },
      { app: 'WhatsApp', rate: '0.20', stock: 9 },
    ], 'Telegram', 'Telegram');
    expect(tiers).toEqual([
      { priceOriginal: 0.4, stock: 5, providerRef: 'Telegram' },
      { priceOriginal: 0.55, stock: 1, providerRef: 'Telegram1' },
    ]);

    expect(parseRatesPayload({ data: [{ app: 'Telegram', rate: '0.11' }] })).toHaveLength(1);
    expect(() => parseRatesPayload('Customer Not Found.')).toThrow(/API Key 无效/);

    mockFetchSequence(['Customer Not Found.']);
    process.env.SMSCODE_COUNTRIES = 'USA';
    const invalid = await fetchProviderOffers({
      mapping: { providerKey: 'smscode', displayName: 'SMSCode.net', serviceCode: 'Telegram' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(invalid.error).toContain('API Key 无效');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => '',
    });
    const failed = await fetchProviderOffers({
      mapping: { providerKey: 'smscode', displayName: 'SMSCode.net', serviceCode: 'Telegram' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(failed.error).toContain('HTTP 500');
    delete process.env.SMSCODE_COUNTRIES;
  });

  it('parses CodesVerify get_rates telegram tiers', async () => {
    mockFetchSequence([[
      { app: 'TelegramUS5', rate: '1.50' },
      { app: 'Telegram7', rate: '0.30' },
      { app: 'OpenAI', rate: '0.54' },
    ]]);
    const { fetchProviderOffers, collectMatchingTiers } = await import('../src/lib/providers/codesverify');
    const tiers = collectMatchingTiers([
      { app: 'TelegramUS5', rate: '1.50' },
      { app: 'Telegram7', rate: '0.30' },
      { app: 'OpenAI', rate: '0.54' },
    ], 'telegram');
    expect(tiers.map((tier) => tier.providerRef)).toEqual(['Telegram7', 'TelegramUS5']);
    const twitterTiers = collectMatchingTiers([
      { app: 'X / TwitterUS5', rate: '0.40' },
      { app: 'Twitter6', rate: '0.15' },
      { app: 'Xbox Live', rate: '0.99' },
    ], 'twitter');
    expect(twitterTiers.map((tier) => tier.providerRef)).toEqual(['Twitter6', 'X / TwitterUS5']);
    expect(twitterTiers.every((tier) => tier.stock === 1)).toBe(true);

    const result = await fetchProviderOffers({
      mapping: { providerKey: 'codesverify', displayName: 'CodesVerify', serviceCode: 'telegram' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
    expect(result.offers[0].minPriceOriginal).toBe(0.3);
    expect(result.offers[0].tiers).toHaveLength(2);
  });

  it('retries OnlineSim catalog after INTERVAL_CONCURRENT_REQUESTS_ERROR', async () => {
    process.env.ONLINESIM_RATES_DELAY_MS = '0';
    process.env.ONLINESIM_RATES_RETRIES = '2';
    process.env.ONLINESIM_SERVICE_COOLDOWN_MS = '0';
    process.env.ONLINESIM_CATALOG_TTL_MS = '0';
    const { fetchProviderOffers, resetOnlineSimRuntime } = await import('../src/lib/providers/onlinesim');
    resetOnlineSimRuntime();
    mockFetchSequence([
      { response: 'INTERVAL_CONCURRENT_REQUESTS_ERROR' },
      {
        response: '1',
        country: 1,
        countries: { _1: { name: 'USA', original: 'usa', code: 1, enable: true } },
        services: { _telegram: { id: 7, count: 9, price: '1.25', slug: 'telegram' } },
      },
    ]);
    const result = await fetchProviderOffers({
      mapping: { providerKey: 'onlinesim', displayName: 'OnlineSim', serviceCode: 'telegram' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(result.error).toBe('');
    expect(result.offers[0].tiers[0].priceOriginal).toBe(1.25);
    expect(result.offers[0].tiers[0].stock).toBe(9);
    delete process.env.ONLINESIM_RATES_DELAY_MS;
    delete process.env.ONLINESIM_RATES_RETRIES;
    delete process.env.ONLINESIM_SERVICE_COOLDOWN_MS;
    delete process.env.ONLINESIM_CATALOG_TTL_MS;
  });

  it('defaults OnlineSim to sequential fetches and reuses catalog across services', async () => {
    process.env.ONLINESIM_RATES_DELAY_MS = '0';
    process.env.ONLINESIM_SERVICE_COOLDOWN_MS = '0';
    process.env.ONLINESIM_CATALOG_TTL_MS = '60000';
    delete process.env.ONLINESIM_RATES_SEQUENTIAL;
    const {
      fetchProviderOffers,
      resetOnlineSimRuntime,
      resolveConcurrency,
    } = await import('../src/lib/providers/onlinesim');
    resetOnlineSimRuntime();
    expect(resolveConcurrency()).toBe(1);

    mockFetchSequence([
      {
        response: '1',
        country: 1,
        countries: {
          _1: { name: 'USA', original: 'usa', code: 1, enable: true },
          _7: { name: 'Russia', original: 'rus', code: 7, enable: true },
        },
        services: {
          _telegram: { id: 7, count: 9, price: '1.25', slug: 'telegram' },
          _twitter: { id: 10, count: 2, price: '1.90', slug: 'twitter' },
        },
      },
      {
        response: '1',
        services: { _telegram: { id: 7, count: 3, price: '0.80', slug: 'telegram' } },
      },
      {
        response: '1',
        services: { _twitter: { id: 10, count: 4, price: '2.10', slug: 'twitter' } },
      },
    ]);

    const telegram = await fetchProviderOffers({
      mapping: { providerKey: 'onlinesim', displayName: 'OnlineSim', serviceCode: 'telegram' },
      exchangeRateService,
      apiKey: 'key',
    });
    const twitter = await fetchProviderOffers({
      mapping: { providerKey: 'onlinesim', displayName: 'OnlineSim', serviceCode: 'twitter' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(telegram.error).toBe('');
    expect(twitter.error).toBe('');
    expect(twitter.offers).toHaveLength(2);
    expect(twitter.offers.map((offer) => offer.tiers[0].priceOriginal).sort()).toEqual([1.9, 2.1]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    delete process.env.ONLINESIM_RATES_DELAY_MS;
    delete process.env.ONLINESIM_SERVICE_COOLDOWN_MS;
    delete process.env.ONLINESIM_CATALOG_TTL_MS;
  });

  it('explains GetSMS missing user as configuration, not a public API', async () => {
    const previousUser = process.env.GETSMS_USER;
    delete process.env.GETSMS_USER;
    const { fetchProviderOffers, resolveCredentials } = await import('../src/lib/providers/getsms');
    expect(() => resolveCredentials('only-a-key')).toThrow(/user\|api_key/);
    const result = await fetchProviderOffers({
      mapping: { providerKey: 'getsms', displayName: 'GetSMS', serviceCode: 'Telegram' },
      exchangeRateService,
      apiKey: 'only-a-key',
    });
    expect(result.error).toMatch(/GETSMS_USER|user\|api_key/);
    expect(result.error).toMatch(/没有公开报价接口/);
    if (previousUser === undefined) delete process.env.GETSMS_USER;
    else process.env.GETSMS_USER = previousUser;
  });
});
