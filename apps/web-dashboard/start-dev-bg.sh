#!/usr/bin/env bash
# ============================================================================
# Guide WebUI Background Development Server
#
# Owns MCP (:7789) + Vite (:7790) through one systemd user service. It never
# kills a process merely because that process owns a configured port.
#
# Usage:
#   bash apps/web-dashboard/start-dev-bg.sh start
#   bash apps/web-dashboard/start-dev-bg.sh stop
#   bash apps/web-dashboard/start-dev-bg.sh status
#   bash apps/web-dashboard/start-dev-bg.sh logs
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_PORT="${STRATCRAFT_MCP_PORT:-7789}"
VITE_PORT="${STRATCRAFT_WEB_DASHBOARD_PORT:-7790}"
STARTUP_ATTEMPTS="${STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS:-30}"
STARTUP_DELAY_SECONDS="${STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS:-0.5}"
SYSTEMCTL_BIN="${STRATCRAFT_SYSTEMCTL_BIN:-systemctl}"
SYSTEMD_RUN_BIN="${STRATCRAFT_SYSTEMD_RUN_BIN:-systemd-run}"
JOURNALCTL_BIN="${STRATCRAFT_JOURNALCTL_BIN:-journalctl}"
SERVICE_DISCOVERY_DIR="${STRATCRAFT_SERVICE_API_DISCOVERY_DIR:-$ROOT/apps/desktop/data}"
CURL_BIN="${STRATCRAFT_CURL_BIN:-curl}"
COMPOSITION_DESCRIPTOR="${STRATCRAFT_RUNTIME_COMPOSITION_DESCRIPTOR:-$SCRIPT_DIR/scripts/runtime-composition.mjs}"
COMPOSITION_FILE="${STRATCRAFT_RUNTIME_COMPOSITION_FILE:-$SERVICE_DISCOVERY_DIR/guide-runtime-composition.json}"
CATALOG_PROBE="${STRATCRAFT_MCP_CATALOG_PROBE:-$SCRIPT_DIR/scripts/verify-mcp-catalog.mjs}"

# shellcheck source=apps/web-dashboard/dev-lifecycle.sh
source "$SCRIPT_DIR/dev-lifecycle.sh"

# TICKET_1297_1: the unit name is owned by the shared lifecycle module so that
# start.sh, the background launcher, and the ownership predicate cannot drift.
UNIT_NAME="$WEBDASH_DEV_UNIT_NAME"

unit_load_state() {
  "$SYSTEMCTL_BIN" --user show "$UNIT_NAME.service" --property=LoadState --value
}

COMMAND="${1:-start}"
case "$COMMAND" in
  stop)
    echo "[webdash] Stopping owned unit $UNIT_NAME.service..."
    LOAD_STATE="$(unit_load_state)" || {
      echo "[ERROR] Cannot query $UNIT_NAME.service" >&2
      exit 1
    }
    if [ "$LOAD_STATE" = "not-found" ]; then
      echo "[webdash] Unit is not installed or loaded; nothing to stop."
    else
      "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || {
        echo "[ERROR] Failed to stop owned unit $UNIT_NAME.service" >&2
        exit 1
      }
      echo "[webdash] Owned unit stopped."
    fi
    webdash_report_occupied_ports "Stopping $UNIT_NAME.service" "$MCP_PORT" "$VITE_PORT"
    exit 0
    ;;
  status)
    "$SYSTEMCTL_BIN" --user status "$UNIT_NAME.service" --no-pager
    exit $?
    ;;
  logs)
    "$JOURNALCTL_BIN" --user -u "$UNIT_NAME.service" -f --no-hostname
    exit $?
    ;;
  start|refresh) ;;
  *)
    echo "Usage: $0 {start|refresh|stop|status|logs}" >&2
    exit 2
    ;;
esac

COMPOSITION_DESCRIPTION="$(node "$COMPOSITION_DESCRIPTOR" describe)" || exit 1
EXPECTED_FINGERPRINT="$(printf '%s' "$COMPOSITION_DESCRIPTION" | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(v.fingerprint)")"
EXPECTED_TOOLS_JSON="$(printf '%s' "$COMPOSITION_DESCRIPTION" | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(v.tools))")"
EXPECTED_COMMERCIAL_PACKAGE_JSON="$(printf '%s' "$COMPOSITION_DESCRIPTION" | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(v.commercialPackage))")"
export STRATCRAFT_RUNTIME_COMPOSITION_FINGERPRINT="$EXPECTED_FINGERPRINT"

runtime_identity_fingerprint() {
  local expected_pid="$1"
  [ -f "$COMPOSITION_FILE" ] || return 1
  node -e "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(v.mainPid!==Number(process.argv[2])||!/^([0-9a-f]{64})$/.test(v.fingerprint))process.exit(1);process.stdout.write(v.fingerprint)" "$COMPOSITION_FILE" "$expected_pid"
}

verify_composition_proof() {
  local main_pid="$1" actual
  actual="$(runtime_identity_fingerprint "$main_pid")" || {
    echo "[ERROR] Guide readiness is incomplete: runtime fingerprint evidence is missing or not owned by PID $main_pid." >&2
    return 1
  }
  [ "$actual" = "$EXPECTED_FINGERPRINT" ] || {
    echo "[ERROR] Guide runtime fingerprint mismatch: expected=$EXPECTED_FINGERPRINT actual=$actual owner=$UNIT_NAME.service." >&2
    return 1
  }
  node "$CATALOG_PROBE" "http://127.0.0.1:$MCP_PORT/mcp" "$EXPECTED_TOOLS_JSON"
}

webdash_validate_port "MCP" "$MCP_PORT"
webdash_validate_port "Vite" "$VITE_PORT"

MCP_ENTRY="${STRATCRAFT_MCP_ENTRY:-$ROOT/apps/desktop/src/mcp/standalone/dist/mcp-server.js}"
if [ ! -f "$MCP_ENTRY" ]; then
  echo "[ERROR] MCP server not compiled: $MCP_ENTRY not found"
  echo "        Run 'npm run build' from repo root first."
  exit 1
fi

if "$SYSTEMCTL_BIN" --user is-active --quiet "$UNIT_NAME.service"; then
  MAIN_PID="$("$SYSTEMCTL_BIN" --user show "$UNIT_NAME.service" --property=MainPID --value)"
  ACTUAL_FINGERPRINT="$(runtime_identity_fingerprint "$MAIN_PID" 2>/dev/null || true)"
  if [ "$ACTUAL_FINGERPRINT" != "$EXPECTED_FINGERPRINT" ]; then
    if [ "$COMMAND" != "refresh" ]; then
      echo "[ERROR] $UNIT_NAME.service has a stale Guide composition; no process was restarted." >&2
      echo "        expected=$EXPECTED_FINGERPRINT actual=${ACTUAL_FINGERPRINT:-missing} owner=systemd:$UNIT_NAME.service" >&2
      echo "        Owner action: bash apps/web-dashboard/start-dev-bg.sh refresh" >&2
      exit 1
    fi
    echo "[webdash] Refreshing positively owned stale unit $UNIT_NAME.service (${ACTUAL_FINGERPRINT:-missing} -> $EXPECTED_FINGERPRINT)..."
    "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || {
      echo "[ERROR] Failed to stop stale owned unit $UNIT_NAME.service." >&2
      exit 1
    }
  else
  if ! webdash_wait_for_service_api "$SERVICE_DISCOVERY_DIR" "$MAIN_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS" "$CURL_BIN" supervised ||
     ! webdash_wait_for_port "MCP server" "$MCP_PORT" "$MAIN_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS" supervised ||
     ! webdash_wait_for_port "Vite" "$VITE_PORT" "$MAIN_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS" supervised; then
    echo "[ERROR] $UNIT_NAME.service is active but Guide WebUI is not ready; no process was restarted." >&2
    echo "        Inspect: $0 logs" >&2
    exit 1
  fi
  # TICKET_1373 R4: an incumbent Guide serving a broken bundle is not ready.
  # Reported as a failure without restarting it -- TICKET_1297 keeps process
  # ownership with whoever established it.
  if ! webdash_wait_for_browser_application "$VITE_PORT" "$SCRIPT_DIR"; then
    echo "[ERROR] $UNIT_NAME.service is active but the Guide application does not render; no process was restarted." >&2
    echo "        Inspect: $0 logs" >&2
    exit 1
  fi
  verify_composition_proof "$MAIN_PID" || exit 1
  echo "[webdash] $UNIT_NAME.service is already active and ready; no process was restarted."
  exit 0
  fi
fi

if ! webdash_assert_ports_available "Guide WebUI background development" "$MCP_PORT" "$VITE_PORT"; then
  echo "[ERROR] Cannot activate build composition: expected=$EXPECTED_FINGERPRINT actual=missing owner=foreign-or-foreground." >&2
  echo "        Owner action: stop the foreground owner, then run 'bash apps/web-dashboard/start-dev-bg.sh refresh'." >&2
  exit 1
fi

# Stop and clear any leftover unit state (failed, auto-restart, etc.)
# so the transient name can be reused by systemd-run.
"$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" 2>/dev/null || true
"$SYSTEMCTL_BIN" --user reset-failed "$UNIT_NAME.service" 2>/dev/null || true

SYSTEMD_ENV=(
  "--setenv=PATH=$PATH"
  "--setenv=HOME=$HOME"
  "--setenv=NODE_ENV=${NODE_ENV:-development}"
  "--setenv=STRATCRAFT_MCP_PORT=$MCP_PORT"
  "--setenv=STRATCRAFT_WEB_DASHBOARD_PORT=$VITE_PORT"
  "--setenv=STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=$STARTUP_ATTEMPTS"
  "--setenv=STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS=$STARTUP_DELAY_SECONDS"
  "--setenv=STRATCRAFT_RUNTIME_COMPOSITION_FINGERPRINT=$EXPECTED_FINGERPRINT"
  "--setenv=STRATCRAFT_RUNTIME_COMPOSITION_TOOLS_JSON=$EXPECTED_TOOLS_JSON"
  "--setenv=STRATCRAFT_RUNTIME_COMMERCIAL_PACKAGE_JSON=$EXPECTED_COMMERCIAL_PACKAGE_JSON"
  "--setenv=STRATCRAFT_RUNTIME_COMPOSITION_FILE=$COMPOSITION_FILE"
)
if [ -n "${NONA_SERVER_URL:-}" ]; then
  SYSTEMD_ENV+=("--setenv=NONA_SERVER_URL=$NONA_SERVER_URL")
fi
if [ -n "${DESKTOP_API_URL:-}" ]; then
  SYSTEMD_ENV+=("--setenv=DESKTOP_API_URL=$DESKTOP_API_URL")
fi
if [ -n "${STRATCRAFT_MCP_NODE_BIN:-}" ]; then
  SYSTEMD_ENV+=("--setenv=STRATCRAFT_MCP_NODE_BIN=$STRATCRAFT_MCP_NODE_BIN")
fi
if [ -n "${STRATCRAFT_VITE_BIN:-}" ]; then
  SYSTEMD_ENV+=("--setenv=STRATCRAFT_VITE_BIN=$STRATCRAFT_VITE_BIN")
fi
if [ -n "${STRATCRAFT_MCP_ENTRY:-}" ]; then
  SYSTEMD_ENV+=("--setenv=STRATCRAFT_MCP_ENTRY=$STRATCRAFT_MCP_ENTRY")
fi
if [ -n "${STRATCRAFT_SERVICE_RUNTIME_LAUNCHER:-}" ]; then
  SYSTEMD_ENV+=("--setenv=STRATCRAFT_SERVICE_RUNTIME_LAUNCHER=$STRATCRAFT_SERVICE_RUNTIME_LAUNCHER")
fi
if [ -n "${STRATCRAFT_SERVICE_API_DISCOVERY_DIR:-}" ]; then
  SYSTEMD_ENV+=("--setenv=STRATCRAFT_SERVICE_API_DISCOVERY_DIR=$STRATCRAFT_SERVICE_API_DISCOVERY_DIR")
fi
if [ -n "${STRATCRAFT_CURL_BIN:-}" ]; then
  SYSTEMD_ENV+=("--setenv=STRATCRAFT_CURL_BIN=$STRATCRAFT_CURL_BIN")
fi

"$SYSTEMD_RUN_BIN" --user --unit="$UNIT_NAME" --collect \
  --description="StratCraft Guide WebUI Development (MCP+Vite)" \
  --property=Restart=on-failure \
  --property=RestartSec=2 \
  --working-directory="$ROOT" \
  "${SYSTEMD_ENV[@]}" \
  bash "$SCRIPT_DIR/start-dev.sh"

MAIN_PID="$("$SYSTEMCTL_BIN" --user show "$UNIT_NAME.service" --property=MainPID --value)"
if ! webdash_wait_for_service_api "$SERVICE_DISCOVERY_DIR" "$MAIN_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS" "$CURL_BIN" supervised; then
  "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || true
  echo "[ERROR] Background Guide WebUI failed to establish the Research Runtime Service; inspect: $0 logs" >&2
  exit 1
fi

if ! webdash_wait_for_port "MCP server" "$MCP_PORT" "$MAIN_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS" supervised; then
  "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || true
  echo "[ERROR] Background Guide WebUI failed to start MCP; inspect: $0 logs" >&2
  exit 1
fi

if ! webdash_wait_for_port "Vite" "$VITE_PORT" "$MAIN_PID" "$STARTUP_ATTEMPTS" "$STARTUP_DELAY_SECONDS" supervised; then
  "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || true
  echo "[ERROR] Background Guide WebUI failed to start Vite; inspect: $0 logs" >&2
  exit 1
fi

# TICKET_1373 R4: a Vite listener is not a rendering application. This unit was
# started by this invocation, so stopping it on failure is this script's own
# cleanup of its own process -- consistent with the Service API and MCP paths
# above and with TICKET_1297, which governs incumbent processes.
if ! webdash_wait_for_browser_application "$VITE_PORT" "$SCRIPT_DIR"; then
  "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || true
  echo "[ERROR] Background Guide WebUI started but the application does not render; inspect: $0 logs" >&2
  exit 1
fi

if ! verify_composition_proof "$MAIN_PID"; then
  "$SYSTEMCTL_BIN" --user stop "$UNIT_NAME.service" || true
  echo "[ERROR] Background Guide WebUI failed post-start composition proof; inspect: $0 logs" >&2
  exit 1
fi

echo ""
echo "============================================"
echo "  Guide WebUI background development ready"
echo "  MCP  :$MCP_PORT"
echo "  Vite :$VITE_PORT"
echo "============================================"
echo "  Logs:   bash apps/web-dashboard/start-dev-bg.sh logs"
echo "  Stop:   bash apps/web-dashboard/start-dev-bg.sh stop"
echo "  Status: bash apps/web-dashboard/start-dev-bg.sh status"
echo ""
