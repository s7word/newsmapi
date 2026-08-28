#!/usr/bin/env bash
# From a machine that already has SSH to 187.127.218.157:
# 1) packs local secrets  2) rsyncs code (optional)  3) uploads secrets  4) restarts service
set -euo pipefail

HOST="${HOST:-187.127.218.157}"
USER="${SSH_USER:-root}"
APP_DIR="${APP_DIR:-/opt/xxxtg}"
BRANCH="${BRANCH:-cursor/setup-newsmapi-dev-env-cd8d}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

SSH=(ssh -o StrictHostKeyChecking=accept-new "${USER}@${HOST}")
SCP=(scp -o StrictHostKeyChecking=accept-new)

log() { printf '[xxxtg-push] %s\n' "$*"; }

log "Packing secrets locally"
bash "${ROOT}/scripts/xxxtg/pack-secrets-for-migrate.sh"
ARCHIVE="$(ls -1t /tmp/xxxtg-migrate/smsbazaar-secrets-*.tar.gz | head -1)"

log "Ensuring remote install script is present (git pull)"
"${SSH[@]}" "bash -s" <<REMOTE
set -euo pipefail
if [[ ! -d ${APP_DIR}/.git ]]; then
  echo "Repo not installed yet. Run scripts/xxxtg/install-on-server.sh on the server first." >&2
  exit 1
fi
cd ${APP_DIR}
git fetch origin
git checkout ${BRANCH}
git pull --ff-only origin ${BRANCH}
npm ci
npm run build
REMOTE

log "Uploading secrets archive"
"${SCP[@]}" "${ARCHIVE}" "${USER}@${HOST}:/tmp/smsbazaar-secrets.tar.gz"

log "Extracting secrets and restarting service"
"${SSH[@]}" "bash -s" <<REMOTE
set -euo pipefail
cd ${APP_DIR}
tar -xzf /tmp/smsbazaar-secrets.tar.gz -C ${APP_DIR}
chmod 600 ${APP_DIR}/.env
chown root:root ${APP_DIR}/.env ${APP_DIR}/data/app.sqlite || true
systemctl restart smsbazaar
sleep 2
systemctl --no-pager --full status smsbazaar | head -20
curl -s -o /dev/null -w "meta_http=%{http_code}\n" http://127.0.0.1:8787/api/meta || true
REMOTE

log "Done."
