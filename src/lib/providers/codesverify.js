'use strict';

const { buildUrl, createProviderError } = require('./helpers');
const { getText } = require('../http');

async function fetchProviderOffers({ mapping, displayName, providerKey }) {
  const name = displayName || mapping?.displayName || 'CodesVerify';
  const key = providerKey || mapping?.providerKey || 'codesverify';
  return createProviderError(
    key,
    name,
    new Error('CodesVerify API 暂不支持批量报价查询（仅 get_number / get_balance）'),
  );
}

async function getBalance(apiKey) {
  const text = await getText(buildUrl('https://api.codesverify.com/get_balance.php', {
    customer: apiKey,
  }), { timeoutMs: 15000 });
  const trimmed = String(text || '').trim();
  if (/customer not found/i.test(trimmed)) {
    throw new Error('Customer Not Found');
  }
  try {
    const payload = JSON.parse(trimmed);
    if (payload?.balance != null) return String(payload.balance);
  } catch {
    // plain text fallback
  }
  return trimmed;
}

module.exports = {
  fetchProviderOffers,
  getBalance,
};
