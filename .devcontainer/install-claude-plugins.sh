#!/usr/bin/env bash

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${GREEN}$1${NC}"
}

warn() {
  echo -e "${YELLOW}$1${NC}"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

if ! command -v claude >/dev/null 2>&1; then
  warn "Claude Code CLI is not installed; skipping plugin setup."
  exit 0
fi

MARKETPLACES=()
PLUGINS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --marketplace)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Error: --marketplace requires a value" >&2
        exit 1
      fi
      MARKETPLACES+=("$1")
      ;;
    *)
      PLUGINS+=("$1")
      ;;
  esac
  shift
done

log "Setting up Claude Code plugins in the devcontainer..."

if ! claude plugin marketplace list 2>/dev/null | grep -q "claude-plugins-official"; then
  warn "Adding official Claude marketplace..."
  claude plugin marketplace add anthropics/claude-plugins-official || warn "Unable to add official marketplace."
fi

for marketplace in "${MARKETPLACES[@]}"; do
  warn "Adding marketplace: ${marketplace}"
  claude plugin marketplace add "${marketplace}" || warn "Unable to add marketplace ${marketplace}."
done

warn "Updating plugin marketplaces..."
claude plugin marketplace update 2>/dev/null || warn "Marketplace update failed; continuing."

for plugin in "${PLUGINS[@]}"; do
  plugin_name="$(echo "${plugin}" | cut -d'@' -f1)"
  if claude plugin list 2>/dev/null | grep -q "${plugin_name}"; then
    log "Already installed: ${plugin_name}"
    continue
  fi

  warn "Installing plugin: ${plugin}"
  claude plugin install "${plugin}" || warn "Unable to install ${plugin}."
done

log "Claude Code plugin setup complete."
