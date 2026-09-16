#!/usr/bin/env bash
# Install/update SMSBazaar under /opt/smsall using Docker only (no host Node runtime).
# Run ON 187.127.218.157 as root.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/smsall}"
REPO_URL="${REPO_URL:-https://github.com/s7word/newsmapi.git}"
BRANCH="${BRANCH:-cursor/setup-newsmapi-dev-env-cd8d}"

log() { printf '[smsall-docker] %s\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Do not install a host Node environment for this app." >&2
  exit 1
fi

mkdir -p "$(dirname "${APP_DIR}")"
if [[ -d "${APP_DIR}/.git" ]]; then
  log "Updating repo in ${APP_DIR}"
  git -C "${APP_DIR}" fetch origin
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
else
  # Directory may exist empty — clone into it
  if [[ -d "${APP_DIR}" ]] && [[ -n "$(ls -A "${APP_DIR}" 2>/dev/null || true)" && ! -d "${APP_DIR}/.git" ]]; then
    log "Using existing non-git tree at ${APP_DIR} (will build from current files)"
  else
    log "Cloning ${REPO_URL} (${BRANCH}) → ${APP_DIR}"
    git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
  fi
fi

cd "${APP_DIR}"
mkdir -p data

if [[ ! -f .env ]]; then
  cp .env.example .env
  log "Created .env from example — copy real secrets before start"
fi

# Remove host systemd unit if previously installed by mistake
if systemctl list-unit-files | grep -q '^smsbazaar.service'; then
  systemctl disable --now smsbazaar.service 2>/dev/null || true
  rm -f /etc/systemd/system/smsbazaar.service
  systemctl daemon-reload || true
  log "Removed host smsbazaar.service (Docker-only)"
fi

log "docker compose build"
docker compose build

log "Done. After secrets are in place: docker compose up -d"
log "Logs: docker compose logs -f smsbazaar"
log "Health: curl -s http://127.0.0.1:8787/api/meta"
