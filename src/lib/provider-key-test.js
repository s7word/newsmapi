'use strict';

const { getProviderDefinition } = require('../config/providers-catalog');
const { buildUrl, getJson } = require('./providers/helpers');
const { getText, request } = require('./http');
const smsbower = require('./providers/smsbower');
const codesverifyProvider = require('./providers/codesverify');

const ACTIVATE_FAIL = /^(BAD_KEY|ERROR_WRONG_KEY|BAD_ACTION|NO_KEY)/i;

function normalizeSmsPoolBaseUrl(baseUrl) {
  const raw = String(baseUrl || 'https://api.smspool.net').trim();
  if (!raw || raw.includes('/stubs/handler_api')) return 'https://api.smspool.net';
  return raw.replace(/\/+$/, '');
}

function parseActivateBalance(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('平台返回空响应');

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const payload = JSON.parse(trimmed);
      const title = String(payload?.title || payload?.error || '').trim();
      if (/BAD_KEY|UNAUTHORIZED/i.test(title) || /BAD_KEY/i.test(JSON.stringify(payload))) {
        throw new Error('API Key 无效 (BAD_KEY)');
      }
      if (title) throw new Error(title);
    } catch (error) {
      if (error.message === 'API Key 无效 (BAD_KEY)' || error.message !== 'Unexpected token') {
        throw error;
      }
    }
  }

  if (ACTIVATE_FAIL.test(trimmed) || /^BAD_/i.test(trimmed)) {
    throw new Error(trimmed === 'BAD_KEY' ? 'API Key 无效 (BAD_KEY)' : trimmed);
  }
  if (trimmed.startsWith('ACCESS_BALANCE:')) {
    const balance = trimmed.slice('ACCESS_BALANCE:'.length).trim();
  return {
    message: `连接成功 · 余额 ${balance} USD`,
    details: { balance, currency: 'USD' },
    endpoint: 'getBalance',
  };
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return {
      message: `连接成功 · 余额 ${trimmed}`,
      details: { balance: trimmed, currency: 'USD' },
      endpoint: 'getBalance',
    };
  }
  throw new Error(trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed);
}

async function testActivateCompatible(baseUrl, apiKey) {
  try {
    const text = await getText(buildUrl(baseUrl, {
      action: 'getBalance',
      api_key: apiKey,
    }), { timeoutMs: 15000 });
    return parseActivateBalance(text);
  } catch (error) {
    const body = String(error?.body || error?.message || '');
    if (/BAD_KEY/i.test(body)) {
      throw new Error('API Key 无效 (BAD_KEY)');
    }
    throw error;
  }
}

async function test5sim(baseUrl, apiKey) {
  if (!apiKey) {
    await getJson(buildUrl(`${baseUrl}/guest/prices`, { product: 'openai' }), { timeoutMs: 15000 });
    return {
      message: '公开价格接口可用（无需 Key）',
      details: { mode: 'public' },
      endpoint: 'GET /guest/prices',
    };
  }

  const profile = await getJson(`${baseUrl}/user/profile`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    timeoutMs: 15000,
  });

  const balance = profile?.balance ?? profile?.rating ?? '';
  const email = profile?.email || profile?.username || '';
  const balanceText = balance !== '' && balance !== undefined ? ` · 余额 ${balance}` : '';
  const identityText = email ? ` · ${email}` : '';
  return {
    message: `连接成功${identityText}${balanceText}`,
    details: {
      balance: balance !== '' && balance !== undefined ? String(balance) : undefined,
      currency: balance !== '' && balance !== undefined ? 'USD' : undefined,
      email: email || undefined,
      rating: profile?.rating,
    },
    endpoint: 'GET /user/profile',
  };
}

async function testSmsbower(definition, apiKey) {
  if (!apiKey) {
    await smsbower.getCatalog();
    return {
      message: '公开价格接口可用（无需 Key）',
      details: { mode: 'public' },
      endpoint: 'GET /guest/prices',
    };
  }
  return await testActivateCompatible(definition.baseUrl, apiKey);
}

async function testNexsms(baseUrl, apiKey) {
  const payload = await getJson(buildUrl(`${baseUrl}/countries`, { apiKey }), { timeoutMs: 15000 });
  if ('code' in payload && Number(payload.code) !== 0) {
    throw new Error(payload.message || `NexSMS 错误 (code=${payload.code})`);
  }
  const countries = Array.isArray(payload?.data) ? payload.data : [];
  return {
    message: `连接成功 · ${countries.length} 个国家`,
    details: { countryCount: countries.length },
    endpoint: 'GET /countries',
  };
}

async function testSmsVerification(baseUrl, apiKey) {
  const text = await getText(buildUrl(baseUrl, {
    action: 'getBalance',
    api_key: apiKey,
  }), { timeoutMs: 15000 });
  return parseActivateBalance(text);
}

async function testOnlinesim(apiKey) {
  const payload = await getJson(buildUrl('https://onlinesim.io/api/getBalance.php', {
    apikey: apiKey,
  }), { timeoutMs: 15000 });
  if (String(payload?.response) !== '1') {
    throw new Error(payload?.response || 'OnlineSim 余额查询失败');
  }
  const balance = payload?.balance ?? payload?.zbalance ?? '';
  return {
    message: `连接成功 · 余额 ${balance} USD`,
    details: { balance: String(balance), currency: 'USD' },
    endpoint: 'GET /api/getBalance.php',
  };
}

async function testSmsBus(apiKey) {
  const payload = await getJson(buildUrl('https://sms-bus.com/api/control/get/balance', {
    token: apiKey,
  }), { timeoutMs: 15000 });
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.message || 'SMS-Bus 余额查询失败');
  }
  const balance = payload?.data?.balance ?? '';
  const frozen = payload?.data?.frozen;
  const frozenText = frozen != null && frozen !== '' ? ` · 冻结 ${frozen}` : '';
  return {
    message: `连接成功 · 余额 ${balance}${frozenText}`,
    details: { balance: String(balance), currency: 'USD' },
    endpoint: 'GET /api/control/get/balance',
  };
}

async function testVibeSms(apiKey) {
  const payload = await getJson(buildUrl('https://api.vibe-sms.net/api/v1/balance', {
    api_key: apiKey,
  }), { timeoutMs: 15000 });

  if (payload?.error) {
    throw new Error(payload.error);
  }

  const balance = payload?.data?.balance ?? '';
  return {
    message: `连接成功 · 余额 ${balance} USD`,
    details: { balance: String(balance), currency: 'USD' },
    endpoint: 'GET /api/v1/balance',
  };
}

async function testCyberYozh(apiKey) {
  const payload = await getJson(buildUrl('https://app.cyberyozh.com/api/v1/numbers/search/', {
    provider: 'virtual',
    period: 'MIN_15',
    service_name: 'telegram',
    page_size: 1,
  }), {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
    },
    timeoutMs: 15000,
  });

  if (payload?.detail && /invalid api key/i.test(String(payload.detail))) {
    throw new Error('API Key 无效 (Invalid API key)');
  }

  const sample = Array.isArray(payload?.results) ? payload.results[0] : null;
  const priceText = sample?.price != null ? ` · 示例报价 ${sample.price} USD` : '';
  return {
    message: `连接成功 · SMS 搜索接口可用${priceText}`,
    details: {
      mode: 'search',
      sampleService: sample?.service_name || undefined,
      samplePrice: sample?.price != null ? String(sample.price) : undefined,
      currency: sample?.price != null ? 'USD' : undefined,
    },
    endpoint: 'GET /api/v1/numbers/search/',
  };
}

async function testVakSms(apiKey) {
  const payload = await getJson(buildUrl('https://vak-sms.com/api/getBalance/', {
    apiKey,
  }), { timeoutMs: 15000 });

  if (payload?.error) {
    const error = String(payload.error);
    if (/apiKeyNotFound|badKey|BAD_KEY/i.test(error)) {
      throw new Error('API Key 无效 (BAD_KEY)');
    }
    throw new Error(error);
  }

  const balance = payload?.balance ?? '';
  return {
    message: `连接成功 · 余额 ${balance} RUB`,
    details: { balance: String(balance), currency: 'RUB' },
    endpoint: 'GET /api/getBalance/',
  };
}

async function testJuicySms(apiKey) {
  try {
    const payload = await getJson('https://juicysms.com/api/v2/account', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      timeoutMs: 15000,
    });

    const balance = payload?.balance?.amount ?? '';
    const currency = payload?.balance?.currency || 'EUR';
    return {
      message: `连接成功 · 余额 ${balance} ${currency}`,
      details: { balance: String(balance), currency },
      endpoint: 'GET /api/v2/account',
    };
  } catch (error) {
    const body = String(error?.body || error?.message || '');
    if (/invalid_token|unauthenticated/i.test(body)) {
      throw new Error('API Key 无效 (invalid_token)');
    }
    throw error;
  }
}

async function testGiveSms(apiKey) {
  const payload = await getJson(buildUrl('https://give-sms.com/api/v1/', {
    method: 'getbalance',
    userkey: apiKey,
  }), { timeoutMs: 15000 });

  if (Number(payload?.status) === 401) {
    throw new Error('API Key 无效 (401)');
  }
  if (payload?.status && Number(payload.status) !== 200) {
    throw new Error(payload?.data?.msg || `Give SMS 错误 (${payload.status})`);
  }

  const balance = payload?.data?.balance ?? '';
  return {
    message: `连接成功 · 余额 ${balance} RUB`,
    details: { balance: String(balance), currency: 'RUB' },
    endpoint: 'GET /api/v1/?method=getbalance',
  };
}

async function testSmspva(apiKey) {
  const response = await request('https://api.smspva.com/activation/balance', {
    headers: { apikey: apiKey, Accept: 'application/json' },
    timeoutMs: 15000,
  });
  const payload = JSON.parse(response.text);
  if (Number(payload?.statusCode) !== 200) {
    throw new Error(payload?.message || `SMSPVA 错误 (${payload?.statusCode || 'unknown'})`);
  }
  const balance = payload?.data?.balance ?? '';
  return {
    message: `连接成功 · 余额 ${balance}`,
    details: { balance: String(balance), currency: 'USD' },
    endpoint: 'GET /activation/balance',
  };
}

async function testCodesverify(apiKey) {
  const balance = await codesverifyProvider.getBalance(apiKey);
  return {
    message: `连接成功 · 余额 ${balance}`,
    details: { balance: String(balance), currency: 'USD' },
    endpoint: 'GET /get_balance.php',
  };
}

async function testSmscode(apiKey) {
  const text = await getText(buildUrl('https://smscode.net/api/user/get_balance.php', {
    customer: apiKey,
  }), { timeoutMs: 15000 });
  const trimmed = String(text || '').trim();
  if (/customer not found/i.test(trimmed)) {
    throw new Error('Customer Not Found');
  }
  let balance = trimmed;
  try {
    const payload = JSON.parse(trimmed);
    balance = payload?.balance != null ? String(payload.balance) : trimmed;
  } catch {
    // plain text
  }
  return {
    message: `连接成功 · 余额 ${balance}`,
    details: { balance: balance, currency: 'USD' },
    endpoint: 'GET /api/user/get_balance.php',
  };
}

async function testSmsPool(baseUrl, apiKey) {
  const normalizedBase = normalizeSmsPoolBaseUrl(baseUrl);
  const body = new URLSearchParams({ key: apiKey });
  const response = await request(`${normalizedBase}/request/balance`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    timeoutMs: 15000,
  });

  let payload;
  try {
    payload = JSON.parse(response.text);
  } catch (error) {
    throw new Error(`SMSPool 返回非 JSON: ${response.text.slice(0, 120)}`);
  }

  if (payload?.success === 0 || payload?.error) {
    throw new Error(payload.message || payload.error || 'SMSPool Key 无效');
  }

  const balance = payload.balance ?? payload.Balance ?? '';
  return {
    message: `连接成功 · 余额 ${balance}`,
    details: { balance: String(balance), currency: 'USD' },
    endpoint: 'POST /request/balance',
  };
}

function buildConnectivityFromResult(result) {
  const details = result.details || {};
  return {
    ok: Boolean(result.ok),
    message: result.message || '',
    balance: details.balance != null && details.balance !== '' ? String(details.balance) : null,
    currency: details.currency || (details.balance != null && details.balance !== '' ? 'USD' : null),
    email: details.email || null,
    rating: details.rating != null ? String(details.rating) : null,
    countryCount: Number.isFinite(Number(details.countryCount)) ? Number(details.countryCount) : null,
    mode: details.mode || (result.ok ? 'authenticated' : null),
    endpoint: result.endpoint || '',
    latencyMs: Number(result.latencyMs || 0),
    checkedAt: new Date().toISOString(),
  };
}

async function testProviderKey(providerKey, apiKey) {
  const definition = getProviderDefinition(providerKey);
  if (!definition) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }

  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey && !definition.publicWithoutKey) {
    throw new Error('未配置 API Key');
  }

  const startedAt = Date.now();
  let result;

  switch (providerKey) {
    case 'hero-sms':
    case 'grizzlysms':
    case 'sms-rooms':
    case '365sms':
      result = await testActivateCompatible(definition.baseUrl, trimmedKey);
      break;
    case 'smsbower':
      result = await testSmsbower(definition, trimmedKey);
      break;
    case '5sim':
      result = await test5sim(definition.baseUrl, trimmedKey);
      break;
    case 'nexsms':
      result = await testNexsms(definition.baseUrl, trimmedKey);
      break;
    case 'sms-verification-number':
      result = await testSmsVerification(definition.baseUrl, trimmedKey);
      break;
    case 'smspool':
      result = await testSmsPool(definition.baseUrl, trimmedKey);
      break;
    case 'onlinesim':
      result = await testOnlinesim(trimmedKey);
      break;
    case 'smspva':
      result = await testSmspva(trimmedKey);
      break;
    case 'codesverify':
      result = await testCodesverify(trimmedKey);
      break;
    case 'smscode':
      result = await testSmscode(trimmedKey);
      break;
    case 'sms-bus':
      result = await testSmsBus(trimmedKey);
      break;
    case 'vibe-sms':
      result = await testVibeSms(trimmedKey);
      break;
    case 'cyberyozh':
      result = await testCyberYozh(trimmedKey);
      break;
    case 'vak-sms':
      result = await testVakSms(trimmedKey);
      break;
    case 'give-sms':
      result = await testGiveSms(trimmedKey);
      break;
    case 'juicy-sms':
      result = await testJuicySms(trimmedKey);
      break;
    default:
      throw new Error(`暂不支持测试: ${providerKey}`);
  }

  return {
    ok: true,
    providerKey,
    displayName: definition.displayName,
    keyEnv: definition.keyEnv,
    message: result.message,
    details: result.details || {},
    endpoint: result.endpoint || '',
    connectivity: buildConnectivityFromResult({
      ok: true,
      message: result.message,
      details: result.details,
      endpoint: result.endpoint,
      latencyMs: Date.now() - startedAt,
    }),
    latencyMs: Date.now() - startedAt,
  };
}

async function testProviderKeySafe(providerKey, apiKey) {
  const definition = getProviderDefinition(providerKey);
  const startedAt = Date.now();
  try {
    return await testProviderKey(providerKey, apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      providerKey,
      displayName: definition?.displayName || providerKey,
      keyEnv: definition?.keyEnv || '',
      message,
      details: {},
      endpoint: '',
      connectivity: buildConnectivityFromResult({
        ok: false,
        message,
        details: {},
        endpoint: '',
        latencyMs: Date.now() - startedAt,
      }),
      latencyMs: Date.now() - startedAt,
    };
  }
}

module.exports = {
  buildConnectivityFromResult,
  testProviderKey,
  testProviderKeySafe,
};
