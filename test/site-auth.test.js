import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createDatabase, saveProviderSnapshot, saveProviderState } from '../src/lib/db';

describe('site auth gate', () => {
  const prev = {
    disabled: process.env.SMSALL_AUTH_DISABLED,
    user: process.env.SMSALL_AUTH_USER,
    password: process.env.SMSALL_AUTH_PASSWORD,
  };

  afterEach(() => {
    process.env.SMSALL_AUTH_DISABLED = prev.disabled;
    process.env.SMSALL_AUTH_USER = prev.user;
    process.env.SMSALL_AUTH_PASSWORD = prev.password;
  });

  function setupApp() {
    process.env.SMSALL_AUTH_DISABLED = '0';
    process.env.SMSALL_AUTH_USER = 's7word';
    process.env.SMSALL_AUTH_PASSWORD = 'darking';

    const db = createDatabase(':memory:');
    saveProviderSnapshot(db, 'smsbower', {
      providerKey: 'smsbower',
      providerName: 'SMSBower',
      offers: [],
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

    return createApp({
      db,
      refreshController: {
        getState() { return { isRunning: false }; },
        triggerRefresh() { return { accepted: true, status: 'started' }; },
        async refreshAll() { return { accepted: true }; },
      },
    });
  }

  it('rejects meta without session', async () => {
    const app = setupApp();
    const meta = await request(app).get('/api/meta');
    expect(meta.status).toBe(401);
    expect(meta.body.authenticated).toBe(false);
  });

  it('logs in with s7word/darking and unlocks meta', async () => {
    const app = setupApp();
    const bad = await request(app)
      .post('/api/auth/login')
      .send({ username: 's7word', password: 'wrong' });
    expect(bad.status).toBe(401);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 's7word', password: 'darking' });
    expect(login.status).toBe(200);
    expect(login.body.ok).toBe(true);
    expect(login.body.username).toBe('s7word');

    const meta = await request(app)
      .get('/api/meta')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(meta.status).toBe(200);
    expect(meta.body.auth.siteAuthEnabled).toBe(true);
  });
});
