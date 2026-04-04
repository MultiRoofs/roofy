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

export CARGO_HOME="${CARGO_HOME:-/usr/local/cargo}"
export PATH="${HOME}/.cargo/bin:${HOME}/.local/bin:${CARGO_HOME}/bin:${PATH}"

log "Bootstrapping MultiRoof Viewer devcontainer..."

warn "Installing system packages for native Node and Rust tooling..."
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  cmake \
  ninja-build \
  libssl-dev \
  pkg-config

if ! command -v uv >/dev/null 2>&1; then
  warn "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh || warn "uv installation failed; continuing."
fi

if ! command -v claude >/dev/null 2>&1; then
  warn "Installing Claude Code CLI..."
  curl -fsSL https://claude.ai/install.sh | bash || warn "Claude Code CLI installation failed; continuing."
fi

if [ -f package-lock.json ]; then
  warn "Installing project dependencies with npm ci..."
  npm ci
else
  warn "Installing project dependencies with npm install..."
  npm install
fi

if command -v cargo >/dev/null 2>&1; then
  if ! command -v just >/dev/null 2>&1; then
    warn "Installing just..."
    cargo install just --locked || warn "just installation failed; continuing."
  fi

  if command -v rustup >/dev/null 2>&1; then
    warn "Adding wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown || warn "Unable to add wasm32 target; continuing."
  fi

  if ! command -v wasm-pack >/dev/null 2>&1; then
    warn "Installing wasm-pack..."
    cargo install wasm-pack --locked || warn "wasm-pack installation failed; continuing."
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
    typescript-lsp
else
  warn "Skipping Claude Code plugin bootstrap because the CLI is unavailable."
fi

log "Devcontainer setup complete."
