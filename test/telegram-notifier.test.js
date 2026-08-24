import { describe, expect, it } from 'vitest';
import { formatInventoryAlertLines } from '../src/lib/telegram-notifier';

const sampleEvents = [
  {
    type: 'new_listing',
    countryIso2: 'IN',
    countryName: 'India',
    previousStock: 0,
    newStock: 12,
    minPriceUsd: 0.2,
    currency: 'USD',
  },
];

describe('formatInventoryAlertLines', () => {
  it('shows internal alert code, display name, and portal link when includeSource is true', () => {
    const text = formatInventoryAlertLines(sampleEvents, {
      serviceLabel: 'Telegram 接码',
      providerName: 'SMSTG',
      alertCode: 'P24',
      includeSource: true,
      providerKey: 'smstg',
      portalUrl: 'https://smstg.org',
      keyEnv: 'SMSTG_API_KEY',
    });

    expect(text).toContain('来源编号');
    expect(text).toContain('P24');
    expect(text).toContain('SMSTG');
    expect(text).toContain('Telegram 接码');
    expect(text).toContain('新上架');
    expect(text).toContain('India (IN)');
    expect(text).toContain('<a href="https://smstg.org">打开平台查看</a>');
    expect(text).not.toContain('SMSTG_API_KEY');
    expect(text).not.toContain('baseUrl');
    expect(text).not.toContain('keyEnv');
  });

  it('escapes portal URL for the href attribute', () => {
    const text = formatInventoryAlertLines(sampleEvents, {
      includeSource: true,
      portalUrl: 'https://example.com/view?a=1&b="x"',
    });

    expect(text).toContain('<a href="https://example.com/view?a=1&amp;b=&quot;x&quot;">打开平台查看</a>');
  });

  it('omits portal link when includeSource is true but portalUrl is empty', () => {
    const text = formatInventoryAlertLines(sampleEvents, {
      serviceLabel: 'Telegram 接码',
      providerName: 'SMSTG',
      alertCode: 'P24',
      includeSource: true,
      portalUrl: '   ',
    });

    expect(text).toContain('来源编号');
    expect(text).not.toContain('打开平台查看');
    expect(text).not.toContain('<a href');
  });

  it('omits platform name, code, and link when includeSource is false', () => {
    const text = formatInventoryAlertLines(sampleEvents, {
      serviceLabel: 'Telegram 接码',
      providerName: 'SMSTG',
      alertCode: 'P24',
      includeSource: false,
      portalUrl: 'https://smstg.org',
    });

    expect(text).not.toContain('来源编号');
    expect(text).not.toContain('P24');
    expect(text).not.toContain('SMSTG');
    expect(text).not.toContain('Telegram 接码');
    expect(text).not.toContain('打开平台查看');
    expect(text).not.toContain('https://smstg.org');
    expect(text).not.toContain('<a href');
    expect(text).toContain('India (IN)');
    expect(text).toContain('0 → 12');
    expect(text).toContain('$0.2000');
  });
});
