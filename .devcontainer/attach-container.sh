#!/usr/bin/env bash

set -euo pipefail

RUNTIME="${1:-docker}"
shift || true

WORKSPACE_FOLDER="$(pwd -P)"
CONFIG_FILE="${WORKSPACE_FOLDER}/.devcontainer/devcontainer.json"
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

exec "${RUNTIME}" exec -it -u vscode -w "${CONTAINER_WORKSPACE}" "${CONTAINER_ID}" zsh -li
