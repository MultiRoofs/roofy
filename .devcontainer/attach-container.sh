#!/usr/bin/env bash

set -euo pipefail

RUNTIME="${1:-docker}"
shift || true

WORKSPACE_FOLDER="$(pwd -P)"
CONFIG_FILE="${WORKSPACE_FOLDER}/.devcontainer/devcontainer.json"
REMOTE_USER="$(node -p "const fs=require('node:fs'); JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).remoteUser || ''" "${CONFIG_FILE}")"
CONTAINER_WORKSPACE="/workspaces/$(basename "${WORKSPACE_FOLDER}")"

if ! command -v "${RUNTIME}" >/dev/null 2>&1; then
  echo "Container runtime not found: ${RUNTIME}" >&2
  exit 1
fi

CONTAINER_ID="$("${RUNTIME}" ps -q \
  --filter "label=devcontainer.local_folder=${WORKSPACE_FOLDER}" \
  --filter "label=devcontainer.config_file=${CONFIG_FILE}" | head -n 1)"

if [ -z "${CONTAINER_ID}" ]; then
  echo "No running devcontainer found for ${WORKSPACE_FOLDER}." >&2
  echo "Start it first with 'npm run devcontainer:up' or 'npm run devcontainer:up:podman'." >&2
  exit 1
fi

if [ -n "${REMOTE_USER}" ] && [ "${REMOTE_USER}" != "root" ]; then
  exec "${RUNTIME}" exec -it "${CONTAINER_ID}" bash -lc \
    "cd '${CONTAINER_WORKSPACE}' && exec su '${REMOTE_USER}' -s /bin/bash -c 'cd \"${CONTAINER_WORKSPACE}\" && exec bash -i'"
fi

exec "${RUNTIME}" exec -it "${CONTAINER_ID}" bash "$@"
