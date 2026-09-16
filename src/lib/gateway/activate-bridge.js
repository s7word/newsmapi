'use strict';

const { getProviderDefinition } = require('../../config/providers-catalog');
const { buildUrl, getText } = require('../http');
const { isActivateAction } = require('./protocol-registry');

const PASSTHROUGH_QUERY_KEYS = new Set([
  'action',
  'service',
  'country',
  'operator',
  'id',
  'status',
  'rent',
  'activationType',
  'language',
  'maxPrice',
  'providerIds',
]);

function pickPassthroughParams(query = {}) {
  const params = { action: String(query.action || '').trim() };
  for (const [key, value] of Object.entries(query)) {
    if (!PASSTHROUGH_QUERY_KEYS.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    params[key] = value;
  }
  return params;
}

async function proxyActivateHandler({ providerKey, apiKey, query = {} }) {
  const definition = getProviderDefinition(providerKey);
  if (!definition?.baseUrl) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }

  const action = String(query.action || '').trim();
  if (!action) {
    throw new Error('BAD_ACTION');
  }
  if (!isActivateAction(action)) {
    throw new Error('BAD_ACTION');
  }
  if (!apiKey) {
    throw new Error('BAD_KEY');
  }

  const params = {
    ...pickPassthroughParams(query),
    api_key: apiKey,
  };

  const text = await getText(buildUrl(definition.baseUrl, params), { timeoutMs: 30000 });
  return {
    providerKey,
    action,
    contentType: inferContentType(text),
    body: text,
  };
}

function inferContentType(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'text/plain';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return 'application/json';
  }
  return 'text/plain';
}

module.exports = {
  proxyActivateHandler,
};
