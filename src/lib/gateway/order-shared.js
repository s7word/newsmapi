'use strict';

const { buildServiceConfig } = require('../../config/services-catalog');
const { getProviderProtocol } = require('./protocol-registry');

const SCHEMA = 'smsbazaar.gateway.v1';

function errorPayload(providerKey, code, message, extra = {}) {
  return {
    schema: SCHEMA,
    status: 'error',
    provider: providerKey,
    protocol: getProviderProtocol(providerKey),
    code,
    message,
    ...extra,
  };
}

function okPayload(providerKey, fields = {}) {
  return {
    schema: SCHEMA,
    status: 'ok',
    provider: providerKey,
    protocol: getProviderProtocol(providerKey),
    ...fields,
  };
}

function resolveServiceContext(providerKey, serviceKey) {
  const key = String(serviceKey || 'openai_chatgpt').trim();
  const config = buildServiceConfig(key);
  const service = config.serviceKey === key ? key : 'openai_chatgpt';
  const mapping = config.providerMappings.find((row) => row.providerKey === providerKey);
  if (!mapping) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }
  return { service, mapping, config };
}

function parseMaybeJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function extractCodeFromSms(text) {
  const sms = String(text || '').trim();
  if (!sms) return '';
  const patterns = [
    /\b(\d{4,8})\b/,
    /G-(\d{6})/i,
    /code[:\s]+([A-Z0-9-]{4,12})/i,
  ];
  for (const pattern of patterns) {
    const match = sms.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function normalizeCountryToken(value) {
  return String(value || '').trim();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatE164(phone, defaultPlus = true) {
  const digits = digitsOnly(phone);
  if (!digits) return '';
  return defaultPlus ? `+${digits}` : digits;
}

module.exports = {
  SCHEMA,
  errorPayload,
  okPayload,
  resolveServiceContext,
  parseMaybeJson,
  extractCodeFromSms,
  normalizeCountryToken,
  digitsOnly,
  formatE164,
};
