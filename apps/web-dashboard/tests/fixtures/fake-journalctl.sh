#!/usr/bin/env bash
set -euo pipefail

echo "$*" >> "${FAKE_JOURNALCTL_COMMAND_LOG:?}"
exit "${FAKE_JOURNALCTL_STATUS:-0}"
