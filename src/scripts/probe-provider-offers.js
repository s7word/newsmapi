#!/usr/bin/env node
'use strict';

/**
 * Live-probe provider offer adapters. Never prints full API keys.
 *
 *   node src/scripts/probe-provider-offers.js
 *   node src/scripts/probe-provider-offers.js --providers getsms,sms-rooms,smscode,codesverify,onlinesim
 *   node src/scripts/probe-provider-offers.js --services telegram,openai_chatgpt,instagram,twitter
 */

require('dotenv').config();

const { createDatabase } = require('../lib/db');
const { resolveProviderApiKey } = require('../lib/settings');
const { buildServiceConfig } = require('../config/services-catalog');
const { getProvider } = require('../lib/providers');
const { buildUrl, getText, request } = require('../lib/http');

const DEFAULT_PROVIDERS = [
  'getsms',
  'sms-rooms',
  'smscode',
  'codesverify',
  'onlinesim',
];
const DEFAULT_SERVICES = ['telegram', 'openai_chatgpt'];

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '(empty)';
  if (text.length <= 6) return `len=${text.length}`;
  return `len=${text.length} ${text.slice(0, 2)}…${text.slice(-2)}`;
}

function parseList(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) return fallback;
  return process.argv[index + 1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function summarizeOffer(offer) {
  if (!offer) return null;
  const tier = offer.tiers?.[0] || {};
  return {
    country: offer.countryIso2 || offer.countryName || '',
    product: tier.providerRef || offer.metadata?.serviceName || '',
    price: tier.priceOriginal,
    stock: tier.stock,
    tiers: offer.tiers?.length || 0,
  };
}

function summarizeResult(result) {
  const offers = Array.isArray(result?.offers) ? result.offers : [];
  return {
    error: result?.error || '',
    offerCount: offers.length,
    sample: summarizeOffer(offers[0]),
  };
}

async function probeFetchOffers({ db, providerKey, serviceKey }) {
  const serviceConfig = buildServiceConfig(serviceKey);
  const mapping = serviceConfig.providerMappings.find((item) => item.providerKey === providerKey);
  if (!mapping) {
    return { error: `No mapping for ${providerKey}/${serviceKey}`, offerCount: 0, sample: null };
  }
  if (!mapping.serviceCode) {
    return { error: 'Missing service code mapping', offerCount: 0, sample: null };
  }

  const apiKey = resolveProviderApiKey(db, mapping.keyEnv);
  const provider = getProvider(providerKey);
  const started = Date.now();
  const result = await provider.fetchProviderOffers({
    mapping,
    apiKey,
    exchangeRateService: {
      convertToUsd: async (amount) => Number(amount),
    },
  });
  return {
    ...summarizeResult(result),
    ms: Date.now() - started,
    serviceCode: mapping.serviceCode,
    hasKey: Boolean(apiKey),
    key: maskSecret(apiKey),
  };
}

async function safeRequest(label, url, options = {}) {
  try {
    const started = Date.now();
    const response = await request(url, { timeoutMs: options.timeoutMs || 20000, ...options });
    const text = String(response.text || '');
    return {
      label,
      ok: true,
      status: response.statusCode,
      ms: Date.now() - started,
      bytes: text.length,
      preview: text.replace(/\s+/g, ' ').slice(0, 180),
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: error.statusCode || 0,
      error: String(error.message || error).slice(0, 180),
      preview: String(error.body || '').replace(/\s+/g, ' ').slice(0, 180),
    };
  }
}

async function diagnoseGetsms(apiKey) {
  const user = String(process.env.GETSMS_USER || '').trim();
  const patterns = [
    ['cmd=balance key-only', buildUrl('https://getsms.online/api_command.php', { cmd: 'balance', api_key: apiKey })],
    ['cmd=list_services key-only', buildUrl('https://getsms.online/api_command.php', {
      cmd: 'list_services',
      api_key: apiKey,
      service: 'Telegram',
    })],
    ['cmd=services key-only', buildUrl('https://getsms.online/api_command.php', { cmd: 'services', api_key: apiKey })],
  ];
  if (user) {
    patterns.push(
      ['cmd=balance user+key', buildUrl('https://getsms.online/api_command.php', {
        cmd: 'balance',
        user,
        api_key: apiKey,
      })],
      ['cmd=list_services user+key', buildUrl('https://getsms.online/api_command.php', {
        cmd: 'list_services',
        user,
        api_key: apiKey,
        service: 'Telegram',
      })],
    );
  }
  const results = [];
  for (const [label, url] of patterns) {
    results.push(await safeRequest(label, url));
  }
  results.push(await safeRequest('public homepage', 'https://getsms.online/', { timeoutMs: 15000 }));
  results.push(await safeRequest('api docs', 'https://getsms.online/api_command_reference.php', { timeoutMs: 15000 }));
  return results;
}

async function diagnoseSmsRooms(apiKey) {
  const base = 'https://sms-rooms.com/stubs/handler_api.php';
  return [
    await safeRequest('getBalance', buildUrl(base, { action: 'getBalance', api_key: apiKey })),
    await safeRequest('getPricesV3 tg', buildUrl(base, { action: 'getPricesV3', api_key: apiKey, service: 'tg' })),
    await safeRequest('getPrices tg', buildUrl(base, { action: 'getPrices', api_key: apiKey, service: 'tg' })),
    await safeRequest('getCountries', buildUrl(base, { action: 'getCountries', api_key: apiKey })),
    await safeRequest('homepage', 'https://sms-rooms.com/', { timeoutMs: 15000 }),
    await safeRequest('prices page', 'https://sms-rooms.com/en/prices', { timeoutMs: 15000 }),
    await safeRequest('activations', 'https://sms-rooms.com/en/activations', { timeoutMs: 15000 }),
  ];
}

async function diagnoseSmsCode(apiKey) {
  const root = 'https://smscode.net/api/user';
  const countries = ['USA', 'US', 'united states', '1', 'GB', 'UK', 'India', 'IN'];
  const results = [
    await safeRequest('get_balance', buildUrl(`${root}/get_balance.php`, { customer: apiKey })),
    await safeRequest('get_rates POST USA', `${root}/get_rates.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `customer=${encodeURIComponent(apiKey)}&country=USA`,
    }),
  ];
  for (const country of countries) {
    results.push(await safeRequest(`get_rates GET ${country}`, buildUrl(`${root}/get_rates.php`, {
      customer: apiKey,
      country,
    })));
  }
  results.push(await safeRequest('get_apps', buildUrl(`${root}/get_apps.php`, { customer: apiKey })));
  results.push(await safeRequest('get_services', buildUrl(`${root}/get_services.php`, { customer: apiKey })));
  results.push(await safeRequest('get_countries', buildUrl(`${root}/get_countries.php`, { customer: apiKey })));
  results.push(await safeRequest('homepage', 'https://smscode.net/', { timeoutMs: 15000 }));
  results.push(await safeRequest('pricing page', 'https://smscode.net/pricing', { timeoutMs: 15000 }));
  results.push(await safeRequest('rates page', 'https://smscode.net/rates', { timeoutMs: 15000 }));
  return results;
}

async function diagnoseCodesVerify(apiKey) {
  const text = await getText(buildUrl('https://api.codesverify.com/get_rates.php', {
    customer: apiKey,
    country: 'USA',
  }), { timeoutMs: 25000 });
  let entries = [];
  try {
    const parsed = JSON.parse(text);
    entries = Array.isArray(parsed) ? parsed : (parsed.data || parsed.rates || []);
  } catch {
    entries = [];
  }
  const names = entries.map((entry) => String(entry?.app || entry?.name || '')).filter(Boolean);
  const interesting = names.filter((name) => /telegram|instagram|twitter|openai|chatgpt|\bx\b|^ig/i.test(name));
  return {
    bytes: text.length,
    entryCount: entries.length,
    interestingApps: interesting.slice(0, 40),
    sampleApps: names.slice(0, 15),
  };
}

async function main() {
  const providerKeys = parseList('--providers', DEFAULT_PROVIDERS);
  const serviceKeys = parseList('--services', DEFAULT_SERVICES);
  const diagnose = process.argv.includes('--diagnose');
  const db = createDatabase(process.env.DATABASE_PATH || './data/app.sqlite');

  console.log(JSON.stringify({
    getsmsUserConfigured: Boolean(String(process.env.GETSMS_USER || '').trim()),
    providers: providerKeys,
    services: serviceKeys,
  }));

  for (const providerKey of providerKeys) {
    for (const serviceKey of serviceKeys) {
      try {
        const result = await probeFetchOffers({ db, providerKey, serviceKey });
        console.log(JSON.stringify({ kind: 'offers', providerKey, serviceKey, ...result }));
      } catch (error) {
        console.log(JSON.stringify({
          kind: 'offers',
          providerKey,
          serviceKey,
          error: String(error.message || error).slice(0, 200),
        }));
      }
    }
  }

  if (!diagnose) return;

  const { listProviders } = require('../config/providers-catalog');
  const catalog = listProviders();
  const keyFor = (providerKey) => {
    const definition = catalog.find((item) => item.providerKey === providerKey);
    return definition ? resolveProviderApiKey(db, definition.keyEnv) : '';
  };

  if (providerKeys.includes('getsms')) {
    console.log(JSON.stringify({ kind: 'diagnose', providerKey: 'getsms', results: await diagnoseGetsms(keyFor('getsms')) }));
  }
  if (providerKeys.includes('sms-rooms')) {
    console.log(JSON.stringify({ kind: 'diagnose', providerKey: 'sms-rooms', results: await diagnoseSmsRooms(keyFor('sms-rooms')) }));
  }
  if (providerKeys.includes('smscode')) {
    console.log(JSON.stringify({ kind: 'diagnose', providerKey: 'smscode', results: await diagnoseSmsCode(keyFor('smscode')) }));
  }
  if (providerKeys.includes('codesverify')) {
    console.log(JSON.stringify({ kind: 'diagnose', providerKey: 'codesverify', ...(await diagnoseCodesVerify(keyFor('codesverify'))) }));
  }
}

main().catch((error) => {
  console.error(String(error.message || error).slice(0, 240));
  process.exitCode = 1;
});
