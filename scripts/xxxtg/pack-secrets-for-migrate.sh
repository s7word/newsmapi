#!/usr/bin/env bash
# Run on the CURRENT Cloud Agent / local machine (has .env + SQLite).
# Packs secrets for private transfer to 187.127.218.157:/opt/xxxtg
# NEVER commit the generated tarball.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-/tmp/xxxtg-migrate}"
ARCHIVE="${OUT_DIR}/smsbazaar-secrets-${STAMP}.tar.gz"

mkdir -p "${OUT_DIR}"
cd "${ROOT}"

missing=0
[[ -f .env ]] || { echo "missing .env" >&2; missing=1; }
[[ -f data/app.sqlite ]] || { echo "missing data/app.sqlite" >&2; missing=1; }
[[ "${missing}" -eq 0 ]] || exit 1

# Checkpoint WAL so the copy is consistent
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 data/app.sqlite "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null || true
fi

tar -czf "${ARCHIVE}" \
  --exclude='data/app.sqlite-shm' \
  --exclude='data/app.sqlite-wal' \
  .env \
  data/app.sqlite

# Inventory without secret values
INV="${OUT_DIR}/inventory-${STAMP}.txt"
{
  echo "packed_at=${STAMP}"
  echo "archive=${ARCHIVE}"
  echo "archive_bytes=$(wc -c < "${ARCHIVE}")"
  echo "env_bytes=$(wc -c < .env)"
  echo "db_bytes=$(wc -c < data/app.sqlite)"
  echo "node=$(node -v 2>/dev/null || true)"
  echo "branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  echo "commit=$(git rev-parse --short HEAD 2>/dev/null || true)"
  echo "--- provider_api_keys (env name + length only) ---"
  sqlite3 data/app.sqlite "SELECT key_env || ' len=' || length(api_key) FROM provider_api_keys ORDER BY key_env;"
  echo "--- app_settings keys ---"
  sqlite3 data/app.sqlite "SELECT key FROM app_settings ORDER BY key;"
} > "${INV}"

cat <<EOF
Packed (private — do not commit / do not paste into chat):
  ${ARCHIVE}
  ${INV}

Upload example (after SSH works):
  scp ${ARCHIVE} root@187.127.218.157:/tmp/
  ssh root@187.127.218.157 'tar -xzf /tmp/$(basename "${ARCHIVE}") -C /opt/smsall && cd /opt/smsall && docker compose up -d --force-recreate'
EOF
