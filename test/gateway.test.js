import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createDatabase, saveProviderSnapshot } from '../src/lib/db';
import { setAdminPassword, upsertProviderKey } from '../src/lib/settings';
import { listGatewayProviders, supportsActivateProxy } from '../src/lib/gateway/protocol-registry';

describe('gateway protocol registry', () => {
  it('lists all integrated providers with protocol metadata', () => {
    const providers = listGatewayProviders();
    expect(providers.length).toBeGreaterThan(20);
    expect(providers.every((provider) => provider.protocol && provider.capabilities?.length)).toBe(true);
    expect(supportsActivateProxy('hero-sms')).toBe(true);
    expect(supportsActivateProxy('getsms')).toBe(false);
  });
});

describe('gateway API', () => {
  process.env.GATEWAY_API_TOKEN = 'gateway-test-token';

  function setupApp() {
    const db = createDatabase(':memory:');
    setAdminPassword(db, 'admin-pass');
    upsertProviderKey(db, 'HERO_SMS_API_KEY', 'upstream-hero-key');
    saveProviderSnapshot(db, 'smsbower', {
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      offers: [{
        providerKey: 'smsbower',
        providerName: 'SMSBower',
        countryIso2: 'US',
        countryName: 'United States',
        status: 'in_stock',
        currency: 'USD',
        minPriceOriginal: 0.11,
        minPriceUsd: 0.11,
        inventoryTotal: 9,
        tiers: [{ priceOriginal: 0.11, priceUsd: 0.11, stock: 9, providerRef: '' }],
        lastFetchedAt: '2026-05-27T12:00:00.000Z',
        errorMessage: '',
      }],
      error: '',
    }, 'openai_chatgpt');

    const refreshController = {
      getState() { return { isRunning: false }; },
      triggerRefresh() { return { accepted: true }; },
    };

    return createApp({ db, refreshController });
  }

  it('serves public gateway meta', async () => {
    const app = setupApp();
    const res = await request(app).get('/api/gateway/v1/meta');
    expect(res.status).toBe(200);
    expect(res.body.schema).toBe('smsbazaar.gateway.v1');
    expect(res.body.providers.length).toBeGreaterThan(20);
  });

  it('reads snapshot prices without auth', async () => {
    const app = setupApp();
    const res = await request(app).get('/api/gateway/v1/prices?provider=smsbower&service=openai_chatgpt');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.source).toBe('snapshot');
    expect(res.body.offerCount).toBe(1);
  });

  it('rejects balance without auth', async () => {
    const app = setupApp();
    const res = await request(app).get('/api/gateway/v1/balance?provider=hero-sms');
    expect(res.status).toBe(401);
  });

  it('proxies activate handler with gateway token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'ACCESS_BALANCE:12.5',
    });

    const app = setupApp();
    const res = await request(app)
      .get('/api/gateway/v1/activate')
      .query({
        provider: 'hero-sms',
        action: 'getBalance',
        api_key: 'gateway-test-token',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('ACCESS_BALANCE:12.5');
  });
});
