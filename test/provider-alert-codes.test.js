import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../src/config/providers-catalog';
import {
  getProviderAlertCode,
  listProviderAlertCatalog,
} from '../src/config/provider-alert-codes';

describe('provider alert codes', () => {
  it('assigns stable 1-based P-codes from catalog order', () => {
    expect(getProviderAlertCode('hero-sms')).toBe('P01');
    expect(getProviderAlertCode('smsbower')).toBe('P02');
    expect(getProviderAlertCode('5sim')).toBe('P03');
    expect(getProviderAlertCode('smstg')).toBe(`P${String(PROVIDERS.length - 1).padStart(2, '0')}`);
    expect(getProviderAlertCode('fangyuan-sms')).toBe(`P${String(PROVIDERS.length).padStart(2, '0')}`);
    expect(getProviderAlertCode('unknown-platform')).toBe('');
  });

  it('exposes admin catalog without integration secrets', () => {
    const catalog = listProviderAlertCatalog();
    expect(catalog).toHaveLength(PROVIDERS.length);
    expect(new Set(catalog.map((row) => row.alertCode)).size).toBe(PROVIDERS.length);
    expect(catalog[0]).toEqual({
      providerKey: 'hero-sms',
      displayName: 'Hero SMS',
      alertCode: 'P01',
    });
    expect(catalog.every((row) => !('baseUrl' in row) && !('keyEnv' in row))).toBe(true);
  });
});
