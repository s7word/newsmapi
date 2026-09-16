'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { listProviders } = require('../config/providers-catalog');

const providerSnapshotCache = new WeakMap();

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function migrateCompositeKeys(db) {
  const snapshotCols = db.prepare('PRAGMA table_info(provider_snapshots)').all().map((col) => col.name);
  if (!snapshotCols.includes('service_key')) {
    db.exec(`
      ALTER TABLE provider_snapshots RENAME TO provider_snapshots_legacy;
      CREATE TABLE provider_snapshots (
        provider_key TEXT NOT NULL,
        service_key TEXT NOT NULL DEFAULT 'openai_chatgpt',
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (provider_key, service_key)
      );
      INSERT INTO provider_snapshots (provider_key, service_key, payload_json, fetched_at)
      SELECT provider_key, 'openai_chatgpt', payload_json, fetched_at FROM provider_snapshots_legacy;
      DROP TABLE provider_snapshots_legacy;
    `);
  }

  const stateCols = db.prepare('PRAGMA table_info(provider_states)').all().map((col) => col.name);
  if (!stateCols.includes('service_key')) {
    db.exec(`
      ALTER TABLE provider_states RENAME TO provider_states_legacy;
      CREATE TABLE provider_states (
        provider_key TEXT NOT NULL,
        service_key TEXT NOT NULL DEFAULT 'openai_chatgpt',
        status TEXT NOT NULL,
        last_attempted_at TEXT NOT NULL,
        last_success_at TEXT,
        error_message TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (provider_key, service_key)
      );
      INSERT INTO provider_states (provider_key, service_key, status, last_attempted_at, last_success_at, error_message)
      SELECT provider_key, 'openai_chatgpt', status, last_attempted_at, last_success_at, error_message FROM provider_states_legacy;
      DROP TABLE provider_states_legacy;
    `);
  }
}

function createDatabase(databasePath) {
  ensureParentDir(databasePath);
  const db = databasePath === ':memory:'
    ? new Database(':memory:')
    : new Database(databasePath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS service_configs (
      service_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_snapshots (
      provider_key TEXT NOT NULL,
      service_key TEXT NOT NULL DEFAULT 'openai_chatgpt',
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (provider_key, service_key)
    );

    CREATE TABLE IF NOT EXISTS provider_states (
      provider_key TEXT NOT NULL,
      service_key TEXT NOT NULL DEFAULT 'openai_chatgpt',
      status TEXT NOT NULL,
      last_attempted_at TEXT NOT NULL,
      last_success_at TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (provider_key, service_key)
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      base_currency TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );

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

  if (databasePath !== ':memory:') {
    migrateCompositeKeys(db);
  }

  purgeUnknownProviderRecords(db);
  return db;
}

function quoteList(values) {
  return values.map(() => '?').join(', ');
}

function purgeUnknownProviderRecords(db) {
  const providers = listProviders();
  const providerKeys = providers.map((provider) => provider.providerKey).filter(Boolean);
  const keyEnvs = providers.map((provider) => provider.keyEnv).filter(Boolean);
  if (!providerKeys.length) return 0;

  const stateResult = db.prepare(`
    DELETE FROM provider_states
    WHERE provider_key NOT IN (${quoteList(providerKeys)})
  `).run(...providerKeys);
  const snapshotResult = db.prepare(`
    DELETE FROM provider_snapshots
    WHERE provider_key NOT IN (${quoteList(providerKeys)})
  `).run(...providerKeys);

  try {
    if (keyEnvs.length) {
      db.prepare(`
        DELETE FROM provider_api_keys
        WHERE key_env NOT IN (${quoteList(keyEnvs)})
      `).run(...keyEnvs);
    }
  } catch {
    // provider_api_keys may not exist in older test fixtures
  }

  if (stateResult.changes || snapshotResult.changes) {
    providerSnapshotCache.delete(db);
  }
  return Number(stateResult.changes || 0) + Number(snapshotResult.changes || 0);
}

function upsertServiceConfig(db, serviceConfig) {
  db.prepare(`
    INSERT INTO service_configs (service_key, payload_json, updated_at)
    VALUES (@service_key, @payload_json, @updated_at)
    ON CONFLICT(service_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run({
    service_key: serviceConfig.serviceKey,
    payload_json: JSON.stringify(serviceConfig),
    updated_at: new Date().toISOString(),
  });
}

function getServiceConfig(db, serviceKey) {
  const row = db.prepare('SELECT payload_json FROM service_configs WHERE service_key = ?').get(serviceKey);
  return row ? JSON.parse(row.payload_json) : null;
}

function saveProviderSnapshot(db, providerKey, payload, serviceKey = 'openai_chatgpt') {
  const fetchedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_snapshots (provider_key, service_key, payload_json, fetched_at)
    VALUES (@provider_key, @service_key, @payload_json, @fetched_at)
    ON CONFLICT(provider_key, service_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at
  `).run({
    provider_key: providerKey,
    service_key: serviceKey,
    payload_json: JSON.stringify(payload),
    fetched_at: fetchedAt,
  });
  providerSnapshotCache.delete(db);
  return fetchedAt;
}

function getProviderSnapshot(db, providerKey, serviceKey = 'openai_chatgpt') {
  const row = db.prepare(`
    SELECT payload_json, fetched_at
    FROM provider_snapshots
    WHERE provider_key = ? AND service_key = ?
  `).get(providerKey, serviceKey);
  if (!row) return null;
  return {
    payload: JSON.parse(row.payload_json),
    fetchedAt: row.fetched_at,
  };
}

function getAllProviderSnapshots(db, serviceKey = null) {
  const cacheKey = serviceKey || '__all__';
  let cache = providerSnapshotCache.get(db);
  if (!cache) {
    cache = new Map();
    providerSnapshotCache.set(db, cache);
  }
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const rows = serviceKey
    ? db.prepare(`
        SELECT provider_key, service_key, payload_json, fetched_at
        FROM provider_snapshots
        WHERE service_key = ?
      `).all(serviceKey)
    : db.prepare(`
        SELECT provider_key, service_key, payload_json, fetched_at
        FROM provider_snapshots
      `).all();

  const snapshots = rows.map((row) => ({
    providerKey: row.provider_key,
    serviceKey: row.service_key,
    payload: JSON.parse(row.payload_json),
    fetchedAt: row.fetched_at,
  }));
  cache.set(cacheKey, snapshots);
  return snapshots;
}

function saveProviderState(db, state) {
  const serviceKey = state.service_key || 'openai_chatgpt';
  db.prepare(`
    INSERT INTO provider_states (provider_key, service_key, status, last_attempted_at, last_success_at, error_message)
    VALUES (@provider_key, @service_key, @status, @last_attempted_at, @last_success_at, @error_message)
    ON CONFLICT(provider_key, service_key) DO UPDATE SET
      status = excluded.status,
      last_attempted_at = excluded.last_attempted_at,
      last_success_at = excluded.last_success_at,
      error_message = excluded.error_message
  `).run({
    ...state,
    service_key: serviceKey,
  });
}

function getAllProviderStates(db, serviceKey = null) {
  const rows = serviceKey
    ? db.prepare('SELECT * FROM provider_states WHERE service_key = ?').all(serviceKey)
    : db.prepare('SELECT * FROM provider_states').all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.provider_key, row);
  }
  return map;
}

function saveExchangeRates(db, baseCurrency, payload) {
  const fetchedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO exchange_rates (base_currency, payload_json, fetched_at)
    VALUES (@base_currency, @payload_json, @fetched_at)
    ON CONFLICT(base_currency) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at
  `).run({
    base_currency: baseCurrency,
    payload_json: JSON.stringify(payload),
    fetched_at: fetchedAt,
  });
  return fetchedAt;
}

function getExchangeRates(db, baseCurrency) {
  const row = db.prepare('SELECT payload_json, fetched_at FROM exchange_rates WHERE base_currency = ?').get(baseCurrency);
  if (!row) return null;
  return {
    payload: JSON.parse(row.payload_json),
    fetchedAt: row.fetched_at,
  };
}

function insertRefreshEvent(db, startedAt) {
  const info = db.prepare(`
    INSERT INTO refresh_events (started_at, status, details_json)
    VALUES (?, 'running', '{}')
  `).run(startedAt);
  return info.lastInsertRowid;
}

function completeRefreshEvent(db, id, status, details) {
  db.prepare(`
    UPDATE refresh_events
    SET completed_at = ?, status = ?, details_json = ?
    WHERE id = ?
  `).run(new Date().toISOString(), status, JSON.stringify(details || {}), id);
}

function getLatestRefreshEvent(db) {
  const row = db.prepare(`
    SELECT *
    FROM refresh_events
    ORDER BY id DESC
    LIMIT 1
  `).get();
  return row || null;
}

module.exports = {
  completeRefreshEvent,
  createDatabase,
  getAllProviderSnapshots,
  getAllProviderStates,
  getExchangeRates,
  getLatestRefreshEvent,
  getProviderSnapshot,
  getServiceConfig,
  insertRefreshEvent,
  purgeUnknownProviderRecords,
  saveExchangeRates,
  saveProviderSnapshot,
  saveProviderState,
  upsertServiceConfig,
};
