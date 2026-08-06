#!/usr/bin/env bash
# ============================================================================
# Guide WebUI Foreground Development Server
#
# Owns one supervised runtime composition:
#   1. Headless Service API candidate (or validates an incumbent Electron owner)
#   2. MCP Standalone HTTP server on :7789 (auth proxy + tool API)
#   3. Vite dev server on :7790 (frontend + proxy to :7789)
#
# Usage:
#   bash apps/web-dashboard/start-dev.sh
#
# Background development is owned by start-dev-bg.sh and systemd. This script
# never kills a pre-existing listener (TICKET_1297).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_DIR="$ROOT/apps/desktop/src/mcp/standalone"
MCP_PORT="${STRATCRAFT_MCP_PORT:-7789}"
VITE_PORT="${STRATCRAFT_WEB_DASHBOARD_PORT:-7790}"
STARTUP_ATTEMPTS="${STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS:-30}"
STARTUP_DELAY_SECONDS="${STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS:-0.5}"
MCP_NODE_BIN="${STRATCRAFT_MCP_NODE_BIN:-node}"
VITE_BIN="${STRATCRAFT_VITE_BIN:-$SCRIPT_DIR/node_modules/.bin/vite}"
SERVICE_RUNTIME_LAUNCHER="${STRATCRAFT_SERVICE_RUNTIME_LAUNCHER:-$ROOT/scripts/serve/run-stratcraft-serve.sh}"
SERVICE_DISCOVERY_DIR="${STRATCRAFT_SERVICE_API_DISCOVERY_DIR:-$ROOT/apps/desktop/data}"
SERVICE_RUNTIME_CLAIM="$SERVICE_DISCOVERY_DIR/api-runtime.lock"
CURL_BIN="${STRATCRAFT_CURL_BIN:-curl}"
COMPOSITION_FILE="${STRATCRAFT_RUNTIME_COMPOSITION_FILE:-$SERVICE_DISCOVERY_DIR/guide-runtime-composition.json}"
COMPOSITION_DESCRIPTOR="${STRATCRAFT_RUNTIME_COMPOSITION_DESCRIPTOR:-$SCRIPT_DIR/scripts/runtime-composition.mjs}"
COMPOSITION_FINGERPRINT="${STRATCRAFT_RUNTIME_COMPOSITION_FINGERPRINT:-}"
COMPOSITION_TOOLS_JSON="${STRATCRAFT_RUNTIME_COMPOSITION_TOOLS_JSON:-[]}"
COMPOSITION_COMMERCIAL_PACKAGE_JSON="${STRATCRAFT_RUNTIME_COMMERCIAL_PACKAGE_JSON:-null}"
SERVICE_RUNTIME_PID=""
SERVICE_RUNTIME_OWNED=0
SERVICE_RUNTIME_CLAIM_PID=""
MCP_PID=""
VITE_PID=""
CLEANUP_STARTED=0

# shellcheck source=apps/web-dashboard/dev-lifecycle.sh
source "$SCRIPT_DIR/dev-lifecycle.sh"
# shellcheck source=scripts/secure-store-keyring-preflight.sh
source "$ROOT/scripts/secure-store-keyring-preflight.sh"

cleanup_owned_children() {
  local pid

  if [ "$CLEANUP_STARTED" -ne 0 ]; then
    return
  fi
  CLEANUP_STARTED=1
  trap - INT TERM EXIT

  if [ -f "$COMPOSITION_FILE" ] && grep -q "\"mainPid\":$$" "$COMPOSITION_FILE" 2>/dev/null; then
    rm -f "$COMPOSITION_FILE"
  fi

  for pid in "$SERVICE_RUNTIME_PID" "$MCP_PID" "$VITE_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[dev] Stopping owned child PID $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done

  for pid in "$SERVICE_RUNTIME_PID" "$MCP_PID" "$VITE_PID"; do
    if [ -n "$pid" ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup_owned_children EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$#" -ne 0 ]; then
  echo "[ERROR] Unsupported argument: $1" >&2
  echo "        For background development use: bash apps/web-dashboard/start-dev-bg.sh start" >&2
  exit 2
fi

webdash_validate_port "MCP" "$MCP_PORT"
webdash_validate_port "Vite" "$VITE_PORT"

MCP_ENTRY="${STRATCRAFT_MCP_ENTRY:-$MCP_DIR/dist/mcp-server.js}"
if [ ! -f "$MCP_ENTRY" ]; then
  echo "[ERROR] MCP server not compiled: $MCP_ENTRY not found"
  echo "        Run 'npm run build' from repo root first."
  exit 1
fi
if [ ! -x "$SERVICE_RUNTIME_LAUNCHER" ]; then
  echo "[ERROR] Research Runtime Service launcher is not executable: $SERVICE_RUNTIME_LAUNCHER" >&2
  exit 1
fi
if [ -z "$COMPOSITION_FINGERPRINT" ]; then
  COMPOSITION_DESCRIPTION="$(node "$COMPOSITION_DESCRIPTOR" describe)" || exit 1
  COMPOSITION_FINGERPRINT="$(printf '%s' "$COMPOSITION_DESCRIPTION" | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(v.fingerprint)")"
  COMPOSITION_TOOLS_JSON="$(printf '%s' "$COMPOSITION_DESCRIPTION" | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(v.tools))")"
  COMPOSITION_COMMERCIAL_PACKAGE_JSON="$(printf '%s' "$COMPOSITION_DESCRIPTION" | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(v.commercialPackage))")"
fi
if [[ ! "$COMPOSITION_FINGERPRINT" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[ERROR] Guide runtime composition fingerprint is missing or invalid." >&2
  exit 1
fi
export STRATCRAFT_RUNTIME_COMPOSITION_FINGERPRINT

# Check both ports before spawning either child. A conflict is reported and
# preserved; listener ownership is never inferred from PPID or port number.
webdash_assert_ports_available "Guide WebUI foreground development" "$MCP_PORT" "$VITE_PORT"
secure_store_keyring_preflight

# TICKET_1367: resolve development trust through the shared Electron/Guide
# owner. A missing identity preserves production trust resolution; a corrupt
# or partial identity fails before runtime activation.
if [ -z "${STRATCRAFT_WORKER_TRUST_STORE:-}" ]; then
  stratcraft_resolve_development_worker_trust "$ROOT" node || exit 1
  if [ -n "${STRATCRAFT_WORKER_TRUST_STORE:-}" ]; then
    echo "[dev] Quant Lab trust: isolated development identity"
  fi
fi

# The Service API role must be healthy before MCP exposes tools backed by it.
# The TICKET_1334 O_EXCL claim makes this safe when Electron already owns the
# role: the candidate exits 3 and the incumbent's /health response is verified.
echo "[dev] Establishing Research Runtime Service ownership..."
"$SERVICE_RUNTIME_LAUNCHER" &
SERVICE_RUNTIME_PID=$!
echo "[dev] Service API candidate PID: $SERVICE_RUNTIME_PID"
if ! webdash_wait_for_service_api \
  "$SERVICE_DISCOVERY_DIR" \
  "$SERVICE_RUNTIME_PID" \
  "$STARTUP_ATTEMPTS" \
  "$STARTUP_DELAY_SECONDS" \
  "$CURL_BIN"
then
  exit 1
fi
if [ -f "$SERVICE_RUNTIME_CLAIM" ]; then
  SERVICE_RUNTIME_CLAIM_PID="$(
    sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$SERVICE_RUNTIME_CLAIM" \
      | head -n 1
  )"
fi
if kill -0 "$SERVICE_RUNTIME_PID" 2>/dev/null &&
   webdash_pid_descends_from "$SERVICE_RUNTIME_CLAIM_PID" "$SERVICE_RUNTIME_PID"
then
  SERVICE_RUNTIME_OWNED=1
  echo "[dev] Guide owns the headless Service API runtime candidate."
else
  echo "[dev] A pre-existing Service API runtime owner is healthy."
fi

if [ -n "${NONA_SERVER_URL:-}" ]; then
  echo "[dev] nona_server target: $NONA_SERVER_URL (from NONA_SERVER_URL env)"
elif [ -n "${DESKTOP_API_URL:-}" ]; then
  echo "[dev] nona_server target: $DESKTOP_API_URL (from DESKTOP_API_URL env)"
else
  echo "[dev] nona_server target: built-in default (set NONA_SERVER_URL or DESKTOP_API_URL to override)"
fi

echo "[dev] Starting MCP server on :$MCP_PORT..."
(cd "$MCP_DIR" && exec "$MCP_NODE_BIN" "$MCP_ENTRY" --http "$MCP_PORT") &
MCP_PID=$!
echo "[dev] MCP owner PID: $MCP_PID"

if ! webdash_wait_for_port "MCP server" "$MCP_PORT" "$MCP_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS"; then
  exit 1
fi

mkdir -p "$(dirname "$COMPOSITION_FILE")"
COMPOSITION_TEMP="$COMPOSITION_FILE.$$"
printf '{"schemaVersion":1,"mainPid":%s,"fingerprint":"%s","tools":%s,"commercialPackage":%s}\n' \
  "$$" "$COMPOSITION_FINGERPRINT" "$COMPOSITION_TOOLS_JSON" \
  "$COMPOSITION_COMMERCIAL_PACKAGE_JSON" > "$COMPOSITION_TEMP"
mv "$COMPOSITION_TEMP" "$COMPOSITION_FILE"

echo "[dev] Starting Vite on :$VITE_PORT..."
(cd "$SCRIPT_DIR" && exec "$VITE_BIN" --host 0.0.0.0 --port "$VITE_PORT") &
VITE_PID=$!
echo "[dev] Vite owner PID: $VITE_PID"

if ! webdash_wait_for_port "Vite" "$VITE_PORT" "$VITE_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS"; then
  exit 1
fi

echo ""
echo "============================================"
echo "  Web Dashboard:  http://localhost:$VITE_PORT"
echo "  MCP Server:     http://localhost:$MCP_PORT/mcp"
echo "  Auth proxy:     http://localhost:$MCP_PORT/api/auth/*"
echo "============================================"
echo "  Press Ctrl+C to stop this owned runtime composition."
echo ""

EXITED_PID=""
WAIT_PIDS=("$MCP_PID" "$VITE_PID")
if [ "$SERVICE_RUNTIME_OWNED" -eq 1 ]; then
  WAIT_PIDS+=("$SERVICE_RUNTIME_PID")
fi
set +e
wait -n -p EXITED_PID "${WAIT_PIDS[@]}"
CHILD_STATUS=$?
set -e

if [ "$EXITED_PID" = "$SERVICE_RUNTIME_PID" ]; then
  EXITED_LABEL="Research Runtime Service"
elif [ "$EXITED_PID" = "$MCP_PID" ]; then
  EXITED_LABEL="MCP server"
else
  EXITED_LABEL="Vite"
fi

echo "[ERROR] $EXITED_LABEL (PID $EXITED_PID) exited with status $CHILD_STATUS; stopping its owned sibling." >&2
if [ "$CHILD_STATUS" -eq 0 ]; then
  exit 1
fi
exit "$CHILD_STATUS"
