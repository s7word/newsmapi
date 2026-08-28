#!/usr/bin/env bash
# From agent machine with SSH: sync secrets into /opt/smsall and restart Docker compose.
set -euo pipefail

HOST="${HOST:-187.127.218.157}"
USER="${SSH_USER:-root}"
APP_DIR="${APP_DIR:-/opt/smsall}"
BRANCH="${BRANCH:-cursor/setup-newsmapi-dev-env-cd8d}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_xxxtg}"

SSH=(ssh -i "${KEY}" -o StrictHostKeyChecking=accept-new "${USER}@${HOST}")
SCP=(scp -i "${KEY}" -o StrictHostKeyChecking=accept-new)

log() { printf '[smsall-push] %s\n' "$*"; }

log "Packing secrets"
bash "${ROOT}/scripts/xxxtg/pack-secrets-for-migrate.sh"
ARCHIVE="$(ls -1t /tmp/xxxtg-migrate/smsbazaar-secrets-*.tar.gz | head -1)"

log "Pulling code + rebuilding image on server"
"${SSH[@]}" "bash -s" <<REMOTE
set -euo pipefail
cd ${APP_DIR}
git fetch origin
git checkout ${BRANCH}
git pull --ff-only origin ${BRANCH}
docker compose build
REMOTE

log "Uploading secrets"
"${SCP[@]}" "${ARCHIVE}" "${USER}@${HOST}:/tmp/smsbazaar-secrets.tar.gz"

log "Extracting secrets and restarting container"
"${SSH[@]}" "bash -s" <<REMOTE
set -euo pipefail
cd ${APP_DIR}
tar -xzf /tmp/smsbazaar-secrets.tar.gz -C ${APP_DIR}
chmod 600 ${APP_DIR}/.env
docker compose up -d --force-recreate
sleep 3
docker compose ps
curl -s -o /dev/null -w "meta_http=%{http_code}\n" http://127.0.0.1:8787/api/meta || true
REMOTE

log "Done."
