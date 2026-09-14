#!/usr/bin/env bash

set -uo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${GREEN}$1${NC}"
}

warn() {
  echo -e "${YELLOW}$1${NC}"
}

FAILED_STEPS=()

record_failure() {
  FAILED_STEPS+=("$1")
  warn "$1 failed; continuing."
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

export CARGO_HOME="${CARGO_HOME:-/usr/local/cargo}"
export PATH="${HOME}/.cargo/bin:${HOME}/.local/bin:${CARGO_HOME}/bin:${PATH}"

log "Bootstrapping Roofy devcontainer..."

if command -v apt-get >/dev/null 2>&1; then
  warn "Installing system packages for native Node and Rust tooling..."
  run_as_root apt-get update || record_failure "apt-get update"
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    cmake \
    ninja-build \
    libssl-dev \
    pkg-config || record_failure "apt-get install"
else
  warn "apt-get is unavailable; skipping system package install."
fi

if ! command -v uv >/dev/null 2>&1; then
  warn "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh || record_failure "uv installation"
fi

if ! command -v claude >/dev/null 2>&1; then
  warn "Installing Claude Code CLI..."
  curl -fsSL https://claude.ai/install.sh | bash || record_failure "Claude Code CLI installation"
fi

if ! command -v npm >/dev/null 2>&1; then
  warn "npm is unavailable; skipping project dependency install."
else
  mkdir -p "${HOME}/.npm" "${HOME}/.npm-global"
  npm config set cache "${HOME}/.npm" || record_failure "npm cache configuration"
  npm config set prefix "${HOME}/.npm-global" || record_failure "npm prefix configuration"

  if [ -f "${HOME}/.bashrc" ] && ! grep -Fq '.npm-global/bin' "${HOME}/.bashrc"; then
    printf '\nexport PATH="$HOME/.npm-global/bin:$PATH"\n' >> "${HOME}/.bashrc"
  fi

  if [ -f "${HOME}/.zshrc" ] && ! grep -Fq '.npm-global/bin' "${HOME}/.zshrc"; then
    printf '\nexport PATH="$HOME/.npm-global/bin:$PATH"\n' >> "${HOME}/.zshrc"
  fi

  if [ -d node_modules ] && [ -f node_modules/react/package.json ]; then
    warn "Existing node_modules detected; skipping npm install."
  elif [ -f package-lock.json ]; then
    warn "Installing project dependencies with npm ci..."
    npm ci || record_failure "npm ci"
  else
    warn "Installing project dependencies with npm install..."
    npm install || record_failure "npm install"
  fi
fi

if command -v cargo >/dev/null 2>&1; then
  if ! command -v just >/dev/null 2>&1; then
    warn "Installing just..."
    cargo install just --locked || record_failure "just installation"
  fi

  if command -v rustup >/dev/null 2>&1; then
    warn "Adding wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown || record_failure "rustup target add wasm32-unknown-unknown"
  fi

  if ! command -v wasm-pack >/dev/null 2>&1; then
    warn "Installing wasm-pack..."
    cargo install wasm-pack --locked || record_failure "wasm-pack installation"
  fi
fi

if command -v claude >/dev/null 2>&1; then
  warn "Installing Claude Code plugins..."
  "${SCRIPT_DIR}/install-claude-plugins.sh" \
    --marketplace https://github.com/HideBa/cityjson-plugin \
    cityjson \
    clangd-lsp \
    claude-code-setup \
    code-review \
    code-simplifier \
    commit-commands \
    context7 \
    explanatory-output-style \
    feature-dev \
    frontend-design \
    github \
    greptile \
    hookify \
    learning-output-style \
    playwright \
    pr-review-toolkit \
    pyright-lsp \
    ralph-loop \
    rust-analyzer-lsp \
    serena \
    typescript-lsp || record_failure "Claude Code plugin bootstrap"
else
  warn "Skipping Claude Code plugin bootstrap because the CLI is unavailable."
fi

if [ "${#FAILED_STEPS[@]}" -gt 0 ]; then
  warn "Devcontainer setup completed with warnings:"
  for step in "${FAILED_STEPS[@]}"; do
    warn "  - ${step}"
  done
else
  log "Devcontainer setup complete."
fi
