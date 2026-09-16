#!/usr/bin/env node

'use strict';

const {
  callApi: callSmsbowerApi,
  extractCountriesForService,
  getCatalog,
  getServicePriceSheet,
  resolveService,
} = require('./src/lib/providers/smsbower');

function printHelp() {
  console.log(`
Usage:
  node smsbower_probe.js prices --service <code|id> [--country <id[,id]>] [--iso <iso[,iso]>] [--all] [--json]
  node smsbower_probe.js probe --api-key <key> --service <code|id> [--country <id[,id]>] [--iso <iso[,iso]>] [--all] [--json]

Commands:
  prices   Query current SMSBower price tiers for a service.
  probe    Buy a number with getNumberV2, read canGetAnotherSms, then cancel immediately.

Options:
  --api-key <key>      SMSBower API key. Required for probe.
  --service <value>    Service code, id, slug, or title. Example: dr, tg, 247.
  --country <list>     Country id list. Example: 53,52,1
  --iso <list>         Country ISO list. Example: SA,TH,US
  --all                Use all countries currently listed for the service.
  --json               Print JSON instead of a text table.
  --include-empty      Keep price tiers whose count is 0.
  --show-attempts      Include every provider attempt in text output for probe.
  --help               Show this help.

Examples:
  node smsbower_probe.js prices --service dr --iso SA
  node smsbower_probe.js prices --service tg --country 53,52 --json
  node smsbower_probe.js probe --api-key YOUR_KEY --service dr --iso SA
  node smsbower_probe.js probe --api-key YOUR_KEY --service tg --country 53,52 --show-attempts
`.trim());
}

function parseArgs(argv) {
  const args = {
    command: '',
    service: '',
    apiKey: '',
    countryIds: [],
    isoCodes: [],
    all: false,
    json: false,
    includeEmpty: false,
    showAttempts: false,
    help: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    switch (key) {
      case 'api-key':
        args.apiKey = String(next || '').trim();
        i += 1;
        break;
      case 'service':
        args.service = String(next || '').trim();
        i += 1;
        break;
      case 'country':
        args.countryIds = splitCsv(next).map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
        i += 1;
        break;
      case 'iso':
        args.isoCodes = splitCsv(next).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
        i += 1;
        break;
      case 'all':
        args.all = true;
        break;
      case 'json':
        args.json = true;
        break;
      case 'include-empty':
        args.includeEmpty = true;
        break;
      case 'show-attempts':
        args.showAttempts = true;
        break;
      case 'help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  args.command = positional[0] || '';
  return args;
}

function splitCsv(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function getCountriesForService(sheet, serviceId, includeEmpty) {
  const countries = extractCountriesForService(sheet, serviceId).map((country) => ({
    ...country,
    tiers: country.tiers
      .map((tier, index) => ({
        price: tier.priceOriginal,
        count: tier.stock,
        rankId: index,
        rank: `tier-${index + 1}`,
        providerIds: String(tier.providerRef || '')
          .split(',')
          .map((value) => Number.parseInt(value, 10))
          .filter(Number.isFinite),
      }))
      .filter((tier) => includeEmpty || tier.count > 0),
  }));
  return countries.sort((left, right) => left.id - right.id);
}

function selectCountries(countries, args) {
  if (args.all || (!args.countryIds.length && !args.isoCodes.length)) {
    return countries;
  }

  const byId = new Map();
  const byIso = new Map(countries.map((country) => [country.iso, country]));
  for (const country of countries) {
    byId.set(country.id, country);
    if (Number.isFinite(country.apiCountryCode)) {
      byId.set(country.apiCountryCode, country);
    }
  }
  const selected = [];
  const seen = new Set();

  for (const id of args.countryIds) {
    const country = byId.get(id);
    if (!country || seen.has(country.id)) continue;
    seen.add(country.id);
    selected.push(country);
  }

  for (const iso of args.isoCodes) {
    const country = byIso.get(iso);
    if (!country || seen.has(country.id)) continue;
    seen.add(country.id);
    selected.push(country);
  }

  return selected;
}

async function callApi(apiKey, params) {
  return callSmsbowerApi(apiKey, params);
}

function parseCanGetAnotherSms(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return null;
}

async function probeCountry(apiKey, service, country) {
  const attempts = [];

  for (const tier of country.tiers) {
    if (!tier.providerIds.length) continue;
    for (const providerId of tier.providerIds) {
      const response = await callApi(apiKey, {
        action: 'getNumberV2',
        service: service.activate_org_code,
        country: country.apiCountryCode,
        maxPrice: tier.price,
        providerIds: providerId,
      });

      const attempt = {
        providerId,
        price: tier.price,
        rank: tier.rank,
        rankId: tier.rankId,
        response,
      };
      attempts.push(attempt);

      if (typeof response === 'string') {
        if (response === 'NO_NUMBERS') continue;
        if (/^(BAD_KEY|BAD_ACTION|BAD_SERVICE|BAD_COUNTRY|NO_BALANCE)/.test(response)) {
          return {
            status: 'error',
            country,
            attempts,
            error: response,
          };
        }
        continue;
      }

      if (!response || typeof response !== 'object' || !response.activationId || !response.phoneNumber) {
        continue;
      }

      let cancelResponse = '';
      try {
        cancelResponse = await callApi(apiKey, {
          action: 'setStatus',
          status: 8,
          id: response.activationId,
        });
      } catch (error) {
        cancelResponse = `CANCEL_FAILED: ${error.message}`;
      }

      return {
        status: 'success',
        country,
        attempts,
        match: {
          activationId: String(response.activationId),
          phoneNumber: String(response.phoneNumber),
          activationCost: Number(response.activationCost || tier.price),
          canGetAnotherSms: parseCanGetAnotherSms(response.canGetAnotherSms),
          rawCanGetAnotherSms: response.canGetAnotherSms,
          providerId,
          rank: tier.rank,
          rankId: tier.rankId,
          cancelResponse,
        },
      };
    }
  }

  return {
    status: 'no-number',
    country,
    attempts,
  };
}

function formatTier(tier) {
  return `${tier.rank} price=${tier.price} count=${tier.count} providerIds=${tier.providerIds.join(',')}`;
}

function printPricesText(service, countries) {
  console.log(`service=${service.activate_org_code} serviceId=${service.id} title=${service.title}`);
  for (const country of countries) {
    console.log('');
    console.log(`[${country.iso}] ${country.title} countryId=${country.id} apiCountry=${country.apiCountryCode} minPrice=${country.minPrice} totalCount=${country.count}`);
    if (!country.tiers.length) {
      console.log('  no tiers');
      continue;
    }
    for (const tier of country.tiers) {
      console.log(`  ${formatTier(tier)}`);
    }
  }
}

function printProbeText(service, results, showAttempts) {
  console.log(`service=${service.activate_org_code} serviceId=${service.id} title=${service.title}`);
  for (const result of results) {
    const country = result.country;
    console.log('');
    console.log(`[${country.iso}] ${country.title} countryId=${country.id} apiCountry=${country.apiCountryCode}`);
    for (const tier of country.tiers) {
      console.log(`  tier ${formatTier(tier)}`);
    }

    if (result.status === 'success') {
      console.log(`  probe success providerId=${result.match.providerId} activationCost=${result.match.activationCost} canGetAnotherSms=${result.match.canGetAnotherSms} raw=${result.match.rawCanGetAnotherSms} cancel=${result.match.cancelResponse}`);
    } else if (result.status === 'no-number') {
      console.log('  probe no-number');
    } else {
      console.log(`  probe error=${result.error}`);
    }

    if (showAttempts && result.attempts.length) {
      for (const attempt of result.attempts) {
        const response = typeof attempt.response === 'string'
          ? attempt.response
          : JSON.stringify(attempt.response);
        console.log(`  attempt providerId=${attempt.providerId} price=${attempt.price} rank=${attempt.rank} response=${response}`);
      }
    }
  }
}

async function runPricesCommand(args) {
  const catalog = await getCatalog();
  const service = resolveService(args.service, catalog);
  const sheet = await getServicePriceSheet(service.id);
  const countries = selectCountries(getCountriesForService(sheet, service.id, args.includeEmpty), args);

  if (!countries.length) {
    throw new Error('No countries matched the given filters.');
  }

  if (args.json) {
    console.log(JSON.stringify({
      service: {
        id: service.id,
        title: service.title,
        code: service.activate_org_code,
        slug: service.slug,
      },
      countries,
    }, null, 2));
    return;
  }

  printPricesText(service, countries);
}

async function runProbeCommand(args) {
  if (!args.apiKey) {
    throw new Error('Missing --api-key');
  }

  if (!args.all && !args.countryIds.length && !args.isoCodes.length) {
    throw new Error('Probe requires --country, --iso, or --all.');
  }

  const catalog = await getCatalog();
  const service = resolveService(args.service, catalog);
  const sheet = await getServicePriceSheet(service.id);
  const countries = selectCountries(getCountriesForService(sheet, service.id, args.includeEmpty), args);

  if (!countries.length) {
    throw new Error('No countries matched the given filters.');
  }

  const results = [];
  for (const country of countries) {
    results.push(await probeCountry(args.apiKey, service, country));
  }

  if (args.json) {
    console.log(JSON.stringify({
      service: {
        id: service.id,
        title: service.title,
        code: service.activate_org_code,
        slug: service.slug,
      },
      results,
    }, null, 2));
    return;
  }

  printProbeText(service, results, args.showAttempts);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    return;
  }
  if (args.command === 'prices') {
    await runPricesCommand(args);
    return;
  }
  if (args.command === 'probe') {
    await runProbeCommand(args);
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
