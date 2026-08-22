import { describe, expect, it, vi } from 'vitest';
import { testProviderKeySafe } from '../src/lib/provider-key-test';

describe('provider key test', () => {
  it('detects invalid activate-style API keys', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'BAD_KEY',
    });

    const result = await testProviderKeySafe('hero-sms', 'invalid-key');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('BAD_KEY');
  });

  it('accepts valid activate-style balance responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'ACCESS_BALANCE:12.5',
    });

    const result = await testProviderKeySafe('hero-sms', 'valid-key');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('12.5');
  });

  it('reports missing keys for providers that require them', async () => {
    const result = await testProviderKeySafe('nexsms', '');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('未配置');
  });
});
