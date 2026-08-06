#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/secure-store-keyring-preflight.sh
source "$ROOT/scripts/secure-store-keyring-preflight.sh"
secure_store_keyring_preflight

exec node "$ROOT/apps/desktop/src/mcp/standalone/dist/mcp-server.js" --http "$@"
