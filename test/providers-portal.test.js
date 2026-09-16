import { describe, expect, it } from 'vitest';
import { getProviderDefinition, listProviders, resolvePortalUrl } from '../src/config/providers-catalog';

describe('resolvePortalUrl', () => {
  it('uses portal override for smsbower', () => {
    expect(resolvePortalUrl({
      providerKey: 'smsbower',
      baseUrl: 'https://smsbower.page/stubs/handler_api.php',
    })).toBe('https://smsbower.app');
  });

  it('derives portal host from baseUrl when no override', () => {
    expect(resolvePortalUrl({
      providerKey: 'smstg',
      baseUrl: 'https://smstg.org/api',
    })).toBe('https://smstg.org');
  });

  it('prefers explicit portalUrl', () => {
    expect(resolvePortalUrl({
      providerKey: 'custom',
      portalUrl: 'https://example.com/dashboard',
      baseUrl: 'https://api.example.com',
    })).toBe('https://example.com/dashboard');
  });

  it('returns a portal URL for every catalog provider', () => {
    for (const provider of listProviders()) {
      expect(resolvePortalUrl(provider), provider.providerKey).toMatch(/^https?:\/\//);
    }
  });

  it('documents GetSMS user|api_key configuration in the catalog', () => {
    const getsms = getProviderDefinition('getsms');
    expect(getsms.settingsHint).toMatch(/user\|api_key/);
    expect(getsms.keyPlaceholder).toMatch(/@/);
    expect(getsms.publicWithoutKey).toBe(false);
  });

  it('documents FangyuanSms clientId|apiKey configuration in the catalog', () => {
    const fangyuan = getProviderDefinition('fangyuan-sms');
    expect(fangyuan.settingsHint).toMatch(/clientId\|apiKey/);
    expect(fangyuan.keyPlaceholder).toMatch(/\|/);
    expect(fangyuan.publicWithoutKey).toBe(false);
    expect(resolvePortalUrl(fangyuan)).toMatch(/getfangyuan\.com/);
  });
});
