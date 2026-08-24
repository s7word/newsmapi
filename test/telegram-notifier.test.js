import { describe, expect, it } from 'vitest';
import { formatInventoryAlertLines } from '../src/lib/telegram-notifier';

describe('formatInventoryAlertLines', () => {
  it('highlights provider platform in alert body', () => {
    const text = formatInventoryAlertLines([
      {
        type: 'new_listing',
        countryIso2: 'IN',
        countryName: 'India',
        previousStock: 0,
        newStock: 12,
        minPriceUsd: 0.2,
        currency: 'USD',
      },
    ], {
      serviceLabel: 'Telegram 接码',
      providerName: 'SMSTG',
      providerKey: 'smstg',
      portalUrl: 'https://smstg.org',
    });

    expect(text).toContain('平台：SMSTG');
    expect(text).toContain('smstg');
    expect(text).toContain('Telegram 接码');
    expect(text).toContain('新上架');
    expect(text).toContain('India (IN)');
    expect(text).toContain('https://smstg.org');
  });
});
