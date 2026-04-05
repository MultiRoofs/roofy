#!/usr/bin/env bash

set -euo pipefail

PODMAN_BIN="${PODMAN_BIN:-podman}"
TARGET_NOFILE="${DEVCONTAINER_PODMAN_NOFILE:-65536}"

if ! command -v "${PODMAN_BIN}" >/dev/null 2>&1; then
  echo "Podman binary not found: ${PODMAN_BIN}" >&2
  exit 1
fi

if [[ "${TARGET_NOFILE}" =~ ^[0-9]+$ ]]; then
  ulimit -n "${TARGET_NOFILE}" 2>/dev/null || true
fi

exec "${PODMAN_BIN}" "$@"
