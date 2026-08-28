#!/usr/bin/env bash
# Run ON the target server (187.127.218.157) as root (or with sudo).
# Installs Node 22 if missing, clones/pulls repo into /opt/xxxtg, installs deps,
# builds frontend, and installs systemd unit.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/smsall}"
REPO_URL="${REPO_URL:-https://github.com/s7word/newsmapi.git}"
BRANCH="${BRANCH:-cursor/setup-newsmapi-dev-env-cd8d}"
NODE_MAJOR="${NODE_MAJOR:-22}"
SERVICE_NAME="${SERVICE_NAME:-smsbazaar}"

log() { printf '[xxxtg-install] %s\n' "$*"; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Please run as root (sudo)." >&2
    exit 1
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "${major}" -ge 20 ]]; then
      log "Node $(node -v) already installed"
      return
    fi
  fi

  log "Installing Node.js ${NODE_MAJOR}.x via NodeSource"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git build-essential python3
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  log "Node $(node -v) / npm $(npm -v)"
}

sync_repo() {
  mkdir -p "$(dirname "${APP_DIR}")"
  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Updating existing repo at ${APP_DIR}"
    git -C "${APP_DIR}" fetch origin
    git -C "${APP_DIR}" checkout "${BRANCH}"
    git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
  else
    log "Cloning ${REPO_URL} (${BRANCH}) → ${APP_DIR}"
    git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
  fi
}

install_app() {
  cd "${APP_DIR}"
  log "npm ci"
  npm ci
  log "npm run build"
  npm run build
  mkdir -p "${APP_DIR}/data"
  if [[ ! -f "${APP_DIR}/.env" ]]; then
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
    log "Created ${APP_DIR}/.env from example — fill secrets before start"
  else
    log ".env already present — leaving untouched"
  fi
}

install_systemd() {
  local unit_src="${APP_DIR}/scripts/xxxtg/smsbazaar.service"
  local unit_dst="/etc/systemd/system/${SERVICE_NAME}.service"
  if [[ ! -f "${unit_src}" ]]; then
    log "Unit file missing: ${unit_src}"
    exit 1
  fi
  cp "${unit_src}" "${unit_dst}"
  # Ensure WorkingDirectory matches APP_DIR
  sed -i "s|WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" "${unit_dst}"
  sed -i "s|ExecStart=.*|ExecStart=$(command -v node) ${APP_DIR}/src/server.js|" "${unit_dst}"
  sed -i "s|EnvironmentFile=.*|EnvironmentFile=-${APP_DIR}/.env|" "${unit_dst}"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service"
  log "systemd unit installed: ${SERVICE_NAME}.service (not started yet)"
  log "After copying .env + SQLite, run: systemctl start ${SERVICE_NAME}"
}

health_hint() {
  cat <<EOF

Next steps:
  1. Copy secrets: scp .env and data/app.sqlite → ${APP_DIR}/
  2. systemctl start ${SERVICE_NAME}
  3. curl -s http://127.0.0.1:8787/api/meta | head
  4. Open firewall for 8787 (and 5173 only if you run Vite dev)

EOF
}

require_root
install_node
sync_repo
install_app
install_systemd
health_hint
log "Done."
