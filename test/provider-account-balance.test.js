import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { saveProviderConnectivity } from '../src/lib/settings';
import {
  isConnectivityStale,
  resolveProviderAccountBalance,
} from '../src/lib/provider-account-balance';

describe('resolveProviderAccountBalance', () => {
  let db;
  const originalFetch = global.fetch;

  beforeEach(() => {
    db = createDatabase(':memory:');
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('treats missing or old checkedAt as stale', () => {
    expect(isConnectivityStale(null)).toBe(true);
    expect(isConnectivityStale({ checkedAt: 'not-a-date' })).toBe(true);
    expect(isConnectivityStale({
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    })).toBe(true);
    expect(isConnectivityStale({
      checkedAt: new Date().toISOString(),
    })).toBe(false);
  });

  it('returns cached balance without a live probe when fresh', async () => {
    saveProviderConnectivity(db, 'smstg', {
      ok: true,
      balance: '12.50',
      currency: 'USD',
      checkedAt: new Date().toISOString(),
    });

    const balance = await resolveProviderAccountBalance(db, 'smstg');
    expect(balance).toEqual({
      balance: '12.50',
      currency: 'USD',
      countryCount: undefined,
      mode: undefined,
      ok: true,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips live refresh when there is no API key', async () => {
    const balance = await resolveProviderAccountBalance(db, 'hero-sms');
    expect(balance).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
