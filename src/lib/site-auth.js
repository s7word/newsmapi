'use strict';

const crypto = require('node:crypto');

const FALLBACK_USER = 's7word';
const FALLBACK_PASSWORD = 'darking';

function isSiteAuthDisabled() {
  const value = String(
    process.env.SMSALL_AUTH_DISABLED
    || process.env.SMSBAZAAR_AUTH_DISABLED
    || '',
  ).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function getSiteAuthUser() {
  return String(
    process.env.SMSALL_AUTH_USER
    || process.env.AUTH_USER
    || FALLBACK_USER,
  ).trim() || FALLBACK_USER;
}

function getSiteAuthPassword() {
  return String(
    process.env.SMSALL_AUTH_PASSWORD
    || process.env.AUTH_PASSWORD
    || FALLBACK_PASSWORD,
  );
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    // Spend comparable work when lengths differ.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function verifySiteCredentials(username, password) {
  const userOk = safeEqualText(String(username || '').trim(), getSiteAuthUser());
  const passOk = safeEqualText(String(password || ''), getSiteAuthPassword());
  return userOk && passOk;
}

function isPublicApiPath(pathname) {
  const path = String(pathname || '');
  return path === '/api/auth/login'
    || path === '/api/auth/me'
    || path === '/api/auth/logout'
    || path.startsWith('/api/gateway/');
}

module.exports = {
  FALLBACK_PASSWORD,
  FALLBACK_USER,
  getSiteAuthPassword,
  getSiteAuthUser,
  isPublicApiPath,
  isSiteAuthDisabled,
  safeEqualText,
  verifySiteCredentials,
};
