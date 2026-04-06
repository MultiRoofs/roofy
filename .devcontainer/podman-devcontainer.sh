#!/usr/bin/env bash

set -euo pipefail

PODMAN_BIN="${PODMAN_BIN:-podman}"

if ! command -v "${PODMAN_BIN}" >/dev/null 2>&1; then
  echo "Podman binary not found: ${PODMAN_BIN}" >&2
  exit 1
fi

exec "${PODMAN_BIN}" "$@"
