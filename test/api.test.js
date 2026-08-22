import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createDatabase, saveProviderSnapshot, saveProviderState } from '../src/lib/db';
import { setAdminPassword, upsertProviderKey } from '../src/lib/settings';

describe('API endpoints', () => {
  process.env.ADMIN_REFRESH_TOKEN = 'test-admin-token';
  process.env.ADMIN_PASSWORD = 'test-admin-token';

  function setupApp() {
    const db = createDatabase(':memory:');
    setAdminPassword(db, 'test-admin-token');
    saveProviderSnapshot(db, 'smsbower', {
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      offers: [
        {
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
        },
      ],
      error: '',
    }, 'openai_chatgpt');
    saveProviderState(db, {
      provider_key: 'smsbower',
      service_key: 'openai_chatgpt',
      status: 'success',
      last_attempted_at: '2026-05-27T12:00:00.000Z',
      last_success_at: '2026-05-27T12:00:00.000Z',
      error_message: '',
    });

    const refreshController = {
      getState() {
        return { isRunning: false };
      },
      async refreshAll() {
        return { accepted: true, status: 'success' };
      },
      triggerRefresh() {
        return { accepted: true, status: 'started' };
      },
    };

    return { app: createApp({ db, refreshController }), db };
  }

  it('serves meta and compare payloads', async () => {
    const { app } = setupApp();
    const meta = await request(app).get('/api/meta');
    expect(meta.status).toBe(200);
    expect(meta.body.service.serviceKey).toBe('openai_chatgpt');
    expect(Array.isArray(meta.body.services)).toBe(true);
    expect(meta.body.services.length).toBeGreaterThan(1);
    expect(Array.isArray(meta.body.service.recommendedWhitelistIso2)).toBe(true);
    expect(Array.isArray(meta.body.service.registerSupportedWhitelistIso2)).toBe(true);
    expect(Array.isArray(meta.body.service.whatsappSupportedWhitelistIso2)).toBe(true);
    expect(meta.body.countryListSync.status).toBe('bundled');
    expect(meta.body.recommendationConfig.filePath).toBeUndefined();
    expect(meta.body.providers.some((provider) => provider.providerKey === 'sms-activate')).toBe(true);

    const compare = await request(app).get('/api/compare?mode=register&sort=price_asc');
    expect(compare.status).toBe(200);
    expect(compare.body.rows).toHaveLength(1);
    expect(compare.body.rows[0].countryIso2).toBe('US');
    expect(compare.body.recommendationConfig.filePath).toBeUndefined();

    const summary = await request(app).get('/api/compare?mode=register&sort=price_asc&summary=1');
    expect(summary.status).toBe(200);
    expect(summary.body.rows).toHaveLength(1);
    expect(summary.body.rows[0].offers).toEqual([]);
    expect(summary.headers['cache-control']).toContain('max-age=15');

    const recommended = await request(app).get('/api/compare?mode=recommended&sort=price_asc');
    expect(recommended.status).toBe(200);

    const whatsapp = await request(app).get('/api/compare?mode=whatsapp&sort=price_asc');
    expect(whatsapp.status).toBe(200);
    expect(whatsapp.body.filters.mode).toBe('whatsapp');

    const telegram = await request(app).get('/api/meta?service=telegram');
    expect(telegram.status).toBe(200);
    expect(telegram.body.service.serviceKey).toBe('telegram');
    expect(telegram.body.service.modes).toContain('all');
  });

  it('triggers manual refresh endpoint', async () => {
    const { app } = setupApp();
    const response = await request(app)
      .post('/api/refresh')
      .set('x-admin-refresh-token', 'test-admin-token');
    expect(response.status).toBe(202);
    expect(response.body.accepted).toBe(true);
  });

  it('rejects manual refresh without admin token', async () => {
    const { app } = setupApp();
    const response = await request(app).post('/api/refresh');
    expect(response.status).toBe(403);
    expect(response.body.accepted).toBe(false);
  });

  it('supports admin login, key settings, and key connectivity tests', async () => {
    const { app, db } = setupApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ password: 'test-admin-token' });
    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
    expect(login.body.token).toBeTruthy();

    const token = login.body.token;
    const settings = await request(app)
      .get('/api/settings/keys')
      .set('Authorization', `Bearer ${token}`);
    expect(settings.status).toBe(200);
    expect(Array.isArray(settings.body.providers)).toBe(true);

    const save = await request(app)
      .put('/api/settings/keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ keys: { HERO_SMS_API_KEY: 'hero-demo-key' } });
    expect(save.status).toBe(200);
    expect(save.body.ok).toBe(true);

    upsertProviderKey(db, 'HERO_SMS_API_KEY', 'hero-demo-key');
    const hero = save.body.providers.find((provider) => provider.keyEnv === 'HERO_SMS_API_KEY');
    expect(hero.hasKey).toBe(true);
    expect(hero.source).toBe('database');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'ACCESS_BALANCE:9.99',
    });

    const testKey = await request(app)
      .post('/api/settings/keys/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ keyEnv: 'HERO_SMS_API_KEY' });
    expect(testKey.status).toBe(200);
    expect(testKey.body.ok).toBe(true);
    expect(testKey.body.message).toContain('9.99');
    expect(testKey.body.connectivity?.balance).toBe('9.99');

    const panel = await request(app)
      .get('/api/settings/providers-panel?service=openai_chatgpt')
      .set('Authorization', `Bearer ${token}`);
    expect(panel.status).toBe(200);
    expect(Array.isArray(panel.body.providers)).toBe(true);
    const heroPanel = panel.body.providers.find((provider) => provider.keyEnv === 'HERO_SMS_API_KEY');
    expect(heroPanel.refresh).toBeTruthy();
    expect(heroPanel.connectivity?.balance).toBe('9.99');
  });

  it('handles malformed API requests without exposing stack traces', async () => {
    const { app } = setupApp();
    const response = await request(app)
      .post('/api/refresh')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('bad_request');
  });
});
