'use strict';

const { buildUrl, createProviderError, makeOffer } = require('./helpers');
const { getText } = require('../http');
const { toCountryInfo } = require('../country-normalizer');

const DEFAULT_BASE_URL = 'https://smstg.org/api';
const SITE_ORIGIN = 'https://smstg.org';
const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;
const USER_AGENT = 'SMSBazaar/1.0 (+https://sms.fur.li/)';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function resolveCountrySlug(country) {
  const token = String(country || 'US').trim();
  if (!token) return 'us';
  if (/^[a-z]{2}$/i.test(token)) return token.toLowerCase();
  const countryInfo = toCountryInfo(token);
  if (countryInfo?.iso2) return String(countryInfo.iso2).toLowerCase();
  return token.toLowerCase();
}

async function smstgApiRequest(baseUrl, apiKey, action, params = {}) {
  const url = buildUrl(`${normalizeBaseUrl(baseUrl)}/${String(action || '').trim()}`, {
    api_key: apiKey,
    ...params,
  });
  const text = await getText(url, {
    timeoutMs: 30000,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

function parseBalancePayload(payload) {
  if (payload == null) throw new Error('平台返回空响应');
  if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
  if (payload?.balance != null && Number.isFinite(Number(payload.balance))) {
    return Number(payload.balance);
  }
  if (payload?.data?.balance != null && Number.isFinite(Number(payload.data.balance))) {
    return Number(payload.data.balance);
  }
  const message = String(payload?.message || payload?.raw || '').trim();
  if (/^ACCESS_BALANCE:/i.test(message)) {
    return Number(message.split(':').slice(1).join(':').trim());
  }
  if (/^ACCESS_BALANCE:/i.test(String(payload?.raw || ''))) {
    return Number(String(payload.raw).split(':').slice(1).join(':').trim());
  }
  if (/^\d+(\.\d+)?$/.test(message)) return Number(message);
  if (message === 'BAD_KEY') throw new Error('BAD_KEY');
  if (message) throw new Error(message);
  throw new Error('无法解析余额响应');
}

async function getBalance(apiKey, baseUrl = DEFAULT_BASE_URL) {
  const payload = await smstgApiRequest(baseUrl, apiKey, 'getBalance');
  const balance = parseBalancePayload(payload);
  return String(balance);
}

async function parseSitemapCountrySlugs() {
  const xml = await getText(SITEMAP_URL, {
    timeoutMs: 20000,
    headers: { 'User-Agent': USER_AGENT },
  });
  const slugs = [...xml.matchAll(/\/countries\/([a-z]{2})\b/gi)].map((match) => match[1].toLowerCase());
  return [...new Set(slugs)];
}

function parseHomepagePriceMap(html) {
  const map = new Map();
  const patterns = [
    /href="https:\/\/smstg\.org\/en\/countries\/([a-z]{2})"[^>]*title="[^"]*?\$([\d.]+)/gi,
    /href="https:\/\/smstg\.org\/ru\/countries\/([a-z]{2})"[^>]*title="[^"]*?\$([\d.]+)/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      map.set(match[1].toLowerCase(), Number(match[2]));
      match = pattern.exec(html);
    }
  }
  return map;
}

function extractPriceFromCountryHtml(html) {
  const titleUsd = html.match(/for\s+\$([\d.]+)/i);
  if (titleUsd?.[1]) return Number(titleUsd[1]);
  const chipUsd = html.match(/class="country-price"[^>]*>\s*\$([\d.]+)/i);
  if (chipUsd?.[1]) return Number(chipUsd[1]);
  return 0;
}

async function resolveCountryPrices(slugs) {
  const homepageHtml = await getText(`${SITE_ORIGIN}/en`, {
    timeoutMs: 20000,
    headers: { 'User-Agent': USER_AGENT },
  });
  const priceMap = parseHomepagePriceMap(homepageHtml);

  for (const slug of slugs) {
    if (priceMap.has(slug)) continue;
    try {
      const html = await getText(`${SITE_ORIGIN}/en/countries/${slug}`, {
        timeoutMs: 15000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const price = extractPriceFromCountryHtml(html);
      if (price > 0) priceMap.set(slug, price);
    } catch {
      // ignore per-country scrape failures
    }
  }

  return priceMap;
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  const providerKey = mapping.providerKey;
  const providerName = mapping.displayName;
  const serviceCode = String(mapping.serviceCode || '').trim().toLowerCase();

  if (serviceCode && serviceCode !== 'tg') {
    return createProviderError(
      providerKey,
      providerName,
      new Error('SMSTG 仅提供 Telegram 成品账号（telegram 服务）'),
    );
  }

  try {
    const slugs = await parseSitemapCountrySlugs();
    const priceMap = await resolveCountryPrices(slugs);
    const now = new Date().toISOString();
    const offers = [];

    for (const slug of slugs) {
      const price = Number(priceMap.get(slug) || 0);
      const country = toCountryInfo(slug.toUpperCase());
      offers.push(await makeOffer({
        providerKey,
        providerName,
        countryValue: country.iso2 || slug.toUpperCase(),
        countryName: country.displayName || slug.toUpperCase(),
        currency: 'USD',
        tiers: price > 0
          ? [{ priceOriginal: price, stock: 1, providerRef: slug }]
          : [],
        exchangeRateService,
        lastFetchedAt: now,
        status: price > 0 ? 'in_stock' : 'out_of_stock',
        metadata: {
          countrySlug: slug,
          productType: 'telegram_account',
          pricingSource: 'public_site',
        },
      }));
    }

    return {
      providerKey,
      providerName,
      offers,
      lastFetchedAt: now,
      error: '',
    };
  } catch (error) {
    return createProviderError(providerKey, providerName, error);
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  fetchProviderOffers,
  getBalance,
  smstgApiRequest,
  parseBalancePayload,
  resolveCountrySlug,
};
