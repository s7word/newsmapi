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
  it('shows internal alert code and display name when includeSource is true', () => {
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
    expect(text).not.toContain('smstg');
    expect(text).not.toContain('https://smstg.org');
    expect(text).not.toContain('SMSTG_API_KEY');
    expect(text).not.toContain('baseUrl');
  });

  it('omits platform name and code when includeSource is false', () => {
    const text = formatInventoryAlertLines(sampleEvents, {
      serviceLabel: 'Telegram 接码',
      providerName: 'SMSTG',
      alertCode: 'P24',
      includeSource: false,
    });

    expect(text).not.toContain('来源编号');
    expect(text).not.toContain('P24');
    expect(text).not.toContain('SMSTG');
    expect(text).not.toContain('Telegram 接码');
    expect(text).toContain('India (IN)');
    expect(text).toContain('0 → 12');
    expect(text).toContain('$0.2000');
  });
});
