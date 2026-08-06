#!/usr/bin/env bash
set -euo pipefail

COMMAND_LOG="${FAKE_SYSTEMCTL_COMMAND_LOG:?}"
MAIN_PID_FILE="${FAKE_SYSTEMD_MAIN_PID_FILE:?}"
echo "$*" >> "$COMMAND_LOG"

if [[ "$*" == *" is-active "* ]]; then
  if [ "${FAKE_SYSTEMCTL_ACTIVE:-auto}" = "1" ]; then
    exit 0
  fi
  if [ "${FAKE_SYSTEMCTL_ACTIVE:-auto}" = "0" ]; then
    exit 3
  fi
  if [ -f "$MAIN_PID_FILE" ]; then
    MAIN_PID="$(cat "$MAIN_PID_FILE")"
    if kill -0 "$MAIN_PID" 2>/dev/null; then
      exit 0
    fi
  fi
  exit 3
fi

if [[ "$*" == *"--property=LoadState"* ]]; then
  echo "${FAKE_SYSTEMCTL_LOAD_STATE:-not-found}"
  exit "${FAKE_SYSTEMCTL_SHOW_STATUS:-0}"
fi

if [[ "$*" == *"--property=MainPID"* ]]; then
  for _ in $(seq 1 100); do
    if [ -f "$MAIN_PID_FILE" ]; then
      cat "$MAIN_PID_FILE"
      exit 0
    fi
    sleep 0.01
  done
  echo "0"
  exit 0
fi

if [[ "$*" == *" stop "* ]]; then
  if [ "${FAKE_SYSTEMCTL_STOP_STATUS:-0}" -ne 0 ]; then
    exit "$FAKE_SYSTEMCTL_STOP_STATUS"
  fi
  if [ -f "$MAIN_PID_FILE" ]; then
    MAIN_PID="$(cat "$MAIN_PID_FILE")"
    if [[ "$MAIN_PID" =~ ^[0-9]+$ ]] && [ "$MAIN_PID" -gt 1 ]; then
      kill "$MAIN_PID" 2>/dev/null || true
    fi
    rm -f "$MAIN_PID_FILE"
  fi
  exit 0
fi

if [[ "$*" == *" status "* ]]; then
  exit "${FAKE_SYSTEMCTL_STATUS_STATUS:-0}"
fi

if [[ "$*" == *" reset-failed "* ]]; then
  exit 0
fi

echo "Unexpected fake systemctl invocation: $*" >&2
exit 65
