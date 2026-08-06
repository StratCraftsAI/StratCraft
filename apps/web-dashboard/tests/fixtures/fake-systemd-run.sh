#!/usr/bin/env bash
set -euo pipefail

COMMAND_LOG="${FAKE_SYSTEMD_RUN_COMMAND_LOG:?}"
MAIN_PID_FILE="${FAKE_SYSTEMD_MAIN_PID_FILE:?}"
echo "$*" >> "$COMMAND_LOG"

if [ "${FAKE_SYSTEMD_RUN_STATUS:-0}" -ne 0 ]; then
  exit "$FAKE_SYSTEMD_RUN_STATUS"
fi

COMMAND=()
FOUND_COMMAND=0
for arg in "$@"; do
  if [ "$FOUND_COMMAND" -eq 0 ]; then
    case "$arg" in
      --setenv=*)
        export "${arg#--setenv=}"
        ;;
      bash)
        FOUND_COMMAND=1
        COMMAND+=("$arg")
        ;;
    esac
  else
    COMMAND+=("$arg")
  fi
done

if [ "${#COMMAND[@]}" -eq 0 ]; then
  echo "No command supplied to fake systemd-run" >&2
  exit 64
fi

"${COMMAND[@]}" > "${FAKE_SYSTEMD_SERVICE_LOG:?}" 2>&1 &
echo "$!" > "$MAIN_PID_FILE"
