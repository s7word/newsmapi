import { describe, expect, it } from 'vitest';
import {
  formatConnectivityBalance,
  formatInventoryAlertLines,
} from '../src/lib/telegram-notifier';

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
    expect(text).toContain('🔗 平台链接：https://smstg.org');
    expect(text).toContain('💰 账户余额：—（未测试）');
    expect(text).not.toContain('SMSTG_API_KEY');
    expect(text).not.toContain('baseUrl');
    expect(text).not.toContain('keyEnv');
  });

  it('shows cached platform balance after the source header', () => {
    const text = formatInventoryAlertLines(sampleEvents, {
      serviceLabel: 'Telegram 接码',
      providerName: 'SMSTG',
      alertCode: 'P24',
      includeSource: true,
      portalUrl: 'https://smstg.org',
      accountBalance: { balance: '12.50', currency: 'USD' },
    });

    expect(text).toContain('来源编号');
    expect(text).toContain('💰 账户余额：USD 12.50');
    expect(text.indexOf('来源编号')).toBeLessThan(text.indexOf('账户余额'));
    expect(text.indexOf('账户余额')).toBeLessThan(text.indexOf('打开平台查看'));
    expect(text).toContain('<a href="https://smstg.org">打开平台查看</a>');
    expect(text).toContain('🔗 平台链接：https://smstg.org');
    expect(text).toContain('href=');
    expect(text).toContain('https://');
  });

  it('matches frontend connectivity balance formatting', () => {
    expect(formatConnectivityBalance({ balance: '12.50', currency: 'USD' })).toBe('USD 12.50');
    expect(formatConnectivityBalance({ countryCount: 18 })).toBe('18 个国家');
    expect(formatConnectivityBalance({ mode: 'public' })).toBe('公开接口');
    expect(formatConnectivityBalance({ ok: true })).toBe('已联通');
    expect(formatConnectivityBalance({ ok: false })).toBe('—');
    expect(formatConnectivityBalance(null)).toBe('—');
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
    expect(text).toContain('💰 账户余额：—（未测试）');
    expect(text).not.toContain('打开平台查看');
    expect(text).not.toContain('<a href');
    expect(text).not.toContain('平台链接');
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
    expect(text).not.toContain('账户余额');
    expect(text).not.toContain('平台链接');
    expect(text).toContain('India (IN)');
    expect(text).toContain('0 → 12');
    expect(text).toContain('$0.2000');
  });
});
