#!/usr/bin/env bash
# Shared non-mutating Linux session/keyring preflight for Electron and Guide.
# Source this file, then call secure_store_keyring_preflight.

secure_store_keyring_preflight() {
  STRATCRAFT_KEYRING_DBUS_STATE="not_applicable"
  STRATCRAFT_KEYRING_SERVICE_STATE="not_applicable"

  if [ "$(uname -s 2>/dev/null || true)" != "Linux" ]; then
    export STRATCRAFT_KEYRING_DBUS_STATE STRATCRAFT_KEYRING_SERVICE_STATE
    return 0
  fi

  local current_uid runtime_dir session_bus
  current_uid="$(id -u)"
  runtime_dir="${XDG_RUNTIME_DIR:-}"
  if [ -z "$runtime_dir" ]; then
    runtime_dir="/run/user/$current_uid"
    if [ -d "$runtime_dir" ] && [ "$(stat -c '%u' "$runtime_dir" 2>/dev/null || true)" = "$current_uid" ]; then
      export XDG_RUNTIME_DIR="$runtime_dir"
    else
      runtime_dir=""
    fi
  fi

  session_bus="$runtime_dir/bus"
  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -n "$runtime_dir" ] \
    && [ -S "$session_bus" ] \
    && [ "$(stat -c '%u' "$session_bus" 2>/dev/null || true)" = "$current_uid" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$session_bus"
  fi

  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    STRATCRAFT_KEYRING_DBUS_STATE="unavailable"
    STRATCRAFT_KEYRING_SERVICE_STATE="unknown"
  elif command -v busctl >/dev/null 2>&1 \
    && busctl --user --no-pager --no-legend list >/dev/null 2>&1; then
    STRATCRAFT_KEYRING_DBUS_STATE="reachable"
    if busctl --user --no-pager --no-legend list 2>/dev/null \
      | awk '{print $1}' | grep -Fxq 'org.freedesktop.secrets'; then
      STRATCRAFT_KEYRING_SERVICE_STATE="reachable"
    else
      STRATCRAFT_KEYRING_SERVICE_STATE="unavailable"
    fi
  else
    STRATCRAFT_KEYRING_DBUS_STATE="unavailable"
    STRATCRAFT_KEYRING_SERVICE_STATE="unknown"
  fi

  export STRATCRAFT_KEYRING_DBUS_STATE STRATCRAFT_KEYRING_SERVICE_STATE
  printf '%s\n' \
    "[SecureStore preflight] dbus=$STRATCRAFT_KEYRING_DBUS_STATE secret_service=$STRATCRAFT_KEYRING_SERVICE_STATE" >&2
}
