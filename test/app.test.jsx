import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../client/src/App';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.setItem('smsbazaar_admin_token', 'test-token');
    global.fetch = vi.fn(async (url) => {
      if (String(url).startsWith('/api/auth/me')) {
        return {
          ok: true,
          json: async () => ({ authenticated: true, username: 's7word' }),
        };
      }

      if (String(url).startsWith('/api/settings/providers-panel')) {
        return {
          ok: true,
          json: async () => ({
            providers: [
              {
                providerKey: 'smsbower',
                displayName: 'SMSBower',
                status: 'success',
                configured: true,
                portalUrl: 'https://smsbower.app',
                accountBalance: {
                  ok: true,
                  balance: '12.50',
                  currency: 'USD',
                  checkedAt: '2026-05-27T12:00:00.000Z',
                },
              },
            ],
          }),
        };
      }

      if (String(url).startsWith('/api/meta')) {
        return {
          ok: true,
          json: async () => ({
            services: [
              { serviceKey: 'openai_chatgpt', displayName: 'OPENAI (ChatGPT)', modes: ['register', 'bind', 'recommended', 'whatsapp'] },
              { serviceKey: 'telegram', displayName: 'Telegram', modes: ['all'] },
            ],
            service: {
              serviceKey: 'openai_chatgpt',
              displayName: 'OPENAI (ChatGPT)',
              modes: ['register', 'bind', 'recommended', 'whatsapp'],
              bindWhitelistIso2: ['US'],
            },
            display: { cnyRateFromUsd: 7.2, refreshIntervalMs: 60000 },
            providers: [
              {
                providerKey: 'smsbower',
                displayName: 'SMSBower',
                status: 'success',
                configured: true,
                portalUrl: 'https://smsbower.app',
                accountBalance: {
                  ok: true,
                  balance: '12.50',
                  currency: 'USD',
                  checkedAt: '2026-05-27T12:00:00.000Z',
                },
              },
            ],
            lastRefresh: { completed_at: '2026-05-27T12:00:00.000Z' },
            refreshState: 'idle',
            auth: { adminConfigured: true, siteAuthEnabled: true },
          }),
        };
      }

      if (String(url).startsWith('/api/compare')) {
        const isSummary = String(url).includes('summary=1');
        const payload = {
          rows: [
            {
              countryIso2: 'US',
              countryName: 'United States',
              providerCount: 1,
              inventoryTotal: 9,
              minPriceUsd: 0.11,
              minPriceOriginal: 0.11,
              cheapestCurrency: 'USD',
              lastFetchedAt: '2026-05-27T12:00:00.000Z',
              offers: isSummary
                ? []
                : [
                    {
                      providerKey: 'smsbower',
                      providerName: 'SMSBower',
                      status: 'in_stock',
                      currency: 'USD',
                      minPriceOriginal: 0.11,
                      minPriceUsd: 0.11,
                      inventoryTotal: 9,
                      lastFetchedAt: '2026-05-27T12:00:00.000Z',
                      tiers: [{ priceOriginal: 0.11, priceUsd: 0.11, stock: 9, providerRef: '' }],
                      errorMessage: '',
                    },
                  ],
            },
          ],
          countries: [{ iso2: 'US', name: 'United States' }],
          updatedAt: '2026-05-27T12:00:00.000Z',
        };

        return {
          ok: true,
          json: async () => payload,
        };
      }

      throw new Error(`Unhandled fetch for ${url}`);
    });
  });

  it('loads rows and expands provider details', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: /United States/i })).toBeInTheDocument();
    const initialCompareCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/compare'));
    expect(initialCompareCalls.length).toBeGreaterThanOrEqual(1);
    expect(initialCompareCalls.some(([url]) => String(url).includes('summary=1'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /United States/i }));
    expect(await screen.findByRole('heading', { name: 'SMSBower' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /打开平台/i })).toHaveAttribute('href', 'https://smsbower.app');
    expect(screen.getByText('USD 12.50')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('country=US'),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('switches mode and refreshes rows', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /United States/i });
    fireEvent.click(screen.getByRole('button', { name: /绑定白名单国家/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('mode=bind'),
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /目前推荐国家\(自测\)/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('mode=recommended'),
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /WhatsApp 接码/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('mode=whatsapp'),
        expect.any(Object),
      );
    });
  });
});
