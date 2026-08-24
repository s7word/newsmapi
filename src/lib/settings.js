'use strict';

const crypto = require('node:crypto');
const { listProviders } = require('../config/providers-catalog');

const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const sessions = new Map();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

function ensureSettingsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_api_keys (
      key_env TEXT PRIMARY KEY,
      api_key TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (@key, @value_json, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run({
    key,
    value_json: JSON.stringify(value),
    updated_at: new Date().toISOString(),
  });
}

function bootstrapAdminPassword(db) {
  ensureSettingsSchema(db);
  const existing = getSetting(db, 'admin_password');
  if (existing?.hash && existing?.salt) return existing;

  const envPassword = String(process.env.ADMIN_PASSWORD || process.env.ADMIN_REFRESH_TOKEN || '').trim();
  if (!envPassword) return null;

  const hashed = hashPassword(envPassword);
  setSetting(db, 'admin_password', hashed);
  return hashed;
}

function getAdminPasswordRecord(db) {
  ensureSettingsSchema(db);
  return getSetting(db, 'admin_password') || bootstrapAdminPassword(db);
}

function setAdminPassword(db, password) {
  ensureSettingsSchema(db);
  const hashed = hashPassword(password);
  setSetting(db, 'admin_password', hashed);
  return true;
}

function createSession(username = 'admin') {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    username,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function extractBearerToken(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  const cookie = String(req.get('cookie') || '');
  const cookieMatch = cookie.match(/(?:^|;\s*)smsbazaar_session=([^;]+)/);
  return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
}

function requireAdmin(db) {
  return (req, res, next) => {
    const token = extractBearerToken(req);
    const session = getSession(token);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.adminSession = session;
    req.adminToken = token;
    next();
  };
}

function maskKey(value) {
  const key = String(value || '');
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 3)}${'*'.repeat(Math.max(4, key.length - 7))}${key.slice(-4)}`;
}

function getStoredProviderKey(db, keyEnv) {
  ensureSettingsSchema(db);
  const row = db.prepare('SELECT api_key FROM provider_api_keys WHERE key_env = ?').get(keyEnv);
  return row?.api_key || '';
}

function upsertProviderKey(db, keyEnv, apiKey) {
  ensureSettingsSchema(db);
  db.prepare(`
    INSERT INTO provider_api_keys (key_env, api_key, updated_at)
    VALUES (@key_env, @api_key, @updated_at)
    ON CONFLICT(key_env) DO UPDATE SET
      api_key = excluded.api_key,
      updated_at = excluded.updated_at
  `).run({
    key_env: keyEnv,
    api_key: String(apiKey || ''),
    updated_at: new Date().toISOString(),
  });
}

function resolveProviderApiKey(db, keyEnv) {
  const stored = getStoredProviderKey(db, keyEnv);
  if (stored) return stored;
  return String(process.env[keyEnv] || '').trim();
}

function listProviderKeySettings(db) {
  ensureSettingsSchema(db);
  return listProviders().map((provider) => {
    const stored = getStoredProviderKey(db, provider.keyEnv);
    const fromEnv = String(process.env[provider.keyEnv] || '').trim();
    const effective = stored || fromEnv;
    return {
      providerKey: provider.providerKey,
      displayName: provider.displayName,
      keyEnv: provider.keyEnv,
      publicWithoutKey: Boolean(provider.publicWithoutKey),
      configured: Boolean(effective) || Boolean(provider.publicWithoutKey),
      source: stored ? 'database' : (fromEnv ? 'env' : (provider.publicWithoutKey ? 'public' : 'none')),
      maskedKey: maskKey(effective),
      hasKey: Boolean(effective),
      settingsHint: provider.settingsHint || '',
      keyPlaceholder: provider.keyPlaceholder || '',
    };
  });
}

function login(db, password) {
  const record = getAdminPasswordRecord(db);
  if (!record?.hash || !record?.salt) {
    return { ok: false, reason: 'admin_password_not_configured' };
  }
  if (!verifyPassword(password, record.salt, record.hash)) {
    return { ok: false, reason: 'invalid_credentials' };
  }
  const token = createSession('admin');
  return { ok: true, token, expiresInMs: SESSION_TTL_MS };
}

const PROVIDER_CONNECTIVITY_KEY = 'provider_connectivity_tests';

function getProviderConnectivityMap(db) {
  ensureSettingsSchema(db);
  const stored = getSetting(db, PROVIDER_CONNECTIVITY_KEY, {});
  return stored && typeof stored === 'object' ? stored : {};
}

function saveProviderConnectivity(db, providerKey, connectivity) {
  if (!providerKey || !connectivity) return null;
  ensureSettingsSchema(db);
  const map = getProviderConnectivityMap(db);
  map[providerKey] = connectivity;
  setSetting(db, PROVIDER_CONNECTIVITY_KEY, map);
  return connectivity;
}

function saveProviderConnectivityFromTest(db, testResult) {
  if (!testResult?.providerKey || !testResult.connectivity) return null;
  return saveProviderConnectivity(db, testResult.providerKey, testResult.connectivity);
}

module.exports = {
  bootstrapAdminPassword,
  destroySession,
  extractBearerToken,
  getAdminPasswordRecord,
  getProviderConnectivityMap,
  getSession,
  getSetting,
  listProviderKeySettings,
  login,
  requireAdmin,
  resolveProviderApiKey,
  saveProviderConnectivity,
  saveProviderConnectivityFromTest,
  setAdminPassword,
  setSetting,
  upsertProviderKey,
};
