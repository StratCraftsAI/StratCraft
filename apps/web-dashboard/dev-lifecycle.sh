#!/usr/bin/env bash
# Shared Guide WebUI development lifecycle helpers.
#
# Ports identify resources, not process ownership. These helpers inspect and
# report listeners but never terminate them (TICKET_1297).

# Canonical name of the supervised Guide WebUI development unit. Every surface
# that needs to reason about Guide ownership resolves it from here rather than
# re-deriving it from a port, an argv shape, or a process ancestor.
WEBDASH_DEV_UNIT_NAME="${WEBDASH_DEV_UNIT_NAME:-stratcraft-webdash-dev}"

# TICKET_1297_1: pure cgroup-text predicate.
#
# Split out from the /proc reader so the positive branch is deterministically
# testable on any host, including CI containers and `.scope` shells where no
# real `stratcraft-webdash-dev.service` cgroup exists to observe.
#
# Accepts the raw contents of a /proc/<pid>/cgroup file (cgroup v2 emits one
# `0::<path>` line; v1 emits several `<id>:<controllers>:<path>` lines) and
# reports whether any line's path names the given unit.
#
# The unit segment is matched between path separators so that a neighbouring
# unit whose name merely ends with the target -- for example
# `not-stratcraft-webdash-dev.service` -- is not mistaken for it.
webdash_cgroup_text_names_unit() {
  local cgroup_text="$1"
  local unit="$2"
  local line path

  [ -n "$cgroup_text" ] && [ -n "$unit" ] || return 1

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    # Keep everything after the last ':' -- the hierarchy path in both v1 and v2.
    path="${line##*:}"
    [ -n "$path" ] || continue
    case "$path/" in
      */"$unit.service"/*) return 0 ;;
    esac
  done <<< "$cgroup_text"

  return 1
}

# TICKET_1297_1: positive ownership predicate.
#
# Returns success when the given PID belongs to the supervised Guide WebUI
# development cgroup. Ownership is read from the kernel's cgroup membership,
# which is assigned at launch and cannot drift when a package manager rewrites
# a bin shim or a launcher switches between npx and a direct binary path.
#
# Any stop path that consults this helper is asking "did I start this?" rather
# than "does this look like something I start?" -- the distinction TICKET_1297
# identified as the root cause of cross-surface kills.
webdash_pid_is_guide_owned() {
  local pid="$1"
  local cgroup

  [[ "$pid" =~ ^[0-9]+$ ]] || return 1

  cgroup="$(cat "/proc/$pid/cgroup" 2>/dev/null)" || return 1

  webdash_cgroup_text_names_unit "$cgroup" "$WEBDASH_DEV_UNIT_NAME"
}

webdash_validate_port() {
  local label="$1"
  local port="$2"

  if [[ ! "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "[ERROR] Invalid $label port: $port" >&2
    return 1
  fi
}

webdash_listener_pids() {
  local port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    echo "[ERROR] lsof is required to verify ownership of port :$port" >&2
    return 2
  fi

  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

webdash_assert_ports_available() {
  local mode="$1"
  shift
  local port
  local pids
  local pid
  local command_line
  local conflict=0

  for port in "$@"; do
    pids="$(webdash_listener_pids "$port")" || return $?
    if [ -z "$pids" ]; then
      continue
    fi

    conflict=1
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      command_line="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      [ -n "$command_line" ] || command_line="<unavailable>"
      echo "[ERROR] $mode cannot start: port :$port is owned by PID $pid" >&2
      echo "        Command: $command_line" >&2
    done <<< "$pids"
  done

  if [ "$conflict" -ne 0 ]; then
    echo "        Stop the owning session explicitly; no process was terminated." >&2
    return 1
  fi
}

webdash_report_occupied_ports() {
  local context="$1"
  shift
  local port
  local pids

  for port in "$@"; do
    pids="$(webdash_listener_pids "$port")" || return $?
    if [ -n "$pids" ]; then
      echo "[webdash] $context left foreign listener(s) on :$port (PID(s): $(echo "$pids" | tr '\n' ' '))" >&2
    fi
  done
}

webdash_pid_descends_from() {
  local candidate="$1"
  local ancestor="$2"
  local parent
  local depth=0

  if [[ ! "$candidate" =~ ^[0-9]+$ ]] || [[ ! "$ancestor" =~ ^[0-9]+$ ]] ||
     [ "$candidate" -le 1 ] || [ "$ancestor" -le 1 ]; then
    return 1
  fi

  while [ "$candidate" -gt 1 ] && [ "$depth" -lt 64 ]; do
    if [ "$candidate" -eq "$ancestor" ]; then
      return 0
    fi
    parent="$(ps -p "$candidate" -o ppid= 2>/dev/null | tr -d '[:space:]')"
    if [[ ! "$parent" =~ ^[0-9]+$ ]] || [ "$parent" -eq "$candidate" ]; then
      return 1
    fi
    candidate="$parent"
    depth=$((depth + 1))
  done
  return 1
}

webdash_wait_for_port() {
  local label="$1"
  local port="$2"
  local child_pid="$3"
  local attempts="${4:-30}"
  local delay_seconds="${5:-0.5}"
  local owner_type="${6:-child}"
  local attempt
  local child_status
  local candidate_state

  if [[ ! "$child_pid" =~ ^[0-9]+$ ]] || [ "$child_pid" -le 1 ]; then
    echo "[ERROR] Cannot wait for $label: invalid owner PID '$child_pid'" >&2
    return 1
  fi
  if [ "$owner_type" != "child" ] && [ "$owner_type" != "supervised" ]; then
    echo "[ERROR] Cannot wait for $label: invalid owner type '$owner_type'" >&2
    return 1
  fi

  echo -n "[dev] Waiting for $label on :$port..."
  for attempt in $(seq 1 "$attempts"); do
    if (echo > /dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
      echo " ready"
      return 0
    fi

    if ! kill -0 "$child_pid" 2>/dev/null; then
      if [ "$owner_type" = "child" ]; then
        set +e
        wait "$child_pid"
        child_status=$?
        set -e
        echo " FAILED (PID $child_pid exited with status $child_status)"
      else
        echo " FAILED (supervised owner PID $child_pid exited; inspect supervisor logs for status)"
      fi
      return 1
    fi

    echo -n "."
    sleep "$delay_seconds"
  done

  echo " TIMEOUT"
  return 1
}

# TICKET_1373 R4: the fourth readiness dimension -- browser application
# readiness.
#
# `webdash_wait_for_port` above proves a TCP peer accepted a connection. It
# cannot prove the browser entry graph evaluates. In the TICKET_1373 incident
# Vite served HTTP 200 for `/` and `/src/main.tsx` while the page threw before
# `createRoot(...).render(...)`, so the user saw a white screen and every
# readiness check still reported success. Guide readiness is therefore
# dependency readiness AND browser application readiness.
#
# Ownership (TICKET_1297): this probe is strictly read-only. It navigates a URL
# and reports; it never stops, restarts, replaces, or infers ownership of an
# incumbent Guide process. Callers decide what to do with a failure.
#
# Returns 0 when the application renders, 1 when it does not. When the probe
# itself cannot run (Playwright/Chromium unavailable, e.g. a minimal CI image)
# it reports that explicitly and returns 0: an unavailable probe is missing
# evidence, not evidence of failure, and must not fail an otherwise healthy
# developer environment.
webdash_wait_for_browser_application() {
  local port="${1:-7790}"
  local script_dir="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  local node_bin="${3:-node}"
  # Overridable so the lifecycle suite can exercise the readiness contract
  # without launching a real Chromium against a fake HTTP fixture, mirroring
  # the STRATCRAFT_*_BIN seams already used for MCP and Vite.
  local probe="${STRATCRAFT_BROWSER_READINESS_PROBE:-$script_dir/scripts/verify-browser-readiness.mjs}"
  local status

  if [ ! -f "$probe" ]; then
    echo "[ERROR] Guide browser readiness probe is missing: $probe" >&2
    return 1
  fi

  echo "[dev] Verifying Guide browser application on :$port..."
  set +e
  "$node_bin" "$probe" "http://127.0.0.1:$port/"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if [ "$status" -eq 2 ]; then
    echo "[webdash] Browser readiness could not be verified on :$port (probe unavailable); dependency readiness stands." >&2
    return 0
  fi
  return 1
}

# TICKET_1335 AC19: wait for the shared Service API role, not merely for a
# process. Either the child started by Guide or an already-running Electron
# owner may publish the evidence. Readiness requires a valid discovery pair and
# the owner's own /health response.
webdash_wait_for_service_api() {
  local discovery_dir="$1"
  local candidate_pid="$2"
  local attempts="${3:-30}"
  local delay_seconds="${4:-0.5}"
  local curl_bin="${5:-curl}"
  local owner_type="${6:-child}"
  local port_file="$discovery_dir/api-port"
  local token_file="$discovery_dir/api-token"
  local attempt
  local port
  local token
  local health
  local child_status
  local candidate_exited=0

  if [[ ! "$candidate_pid" =~ ^[0-9]+$ ]] || [ "$candidate_pid" -le 1 ]; then
    echo "[ERROR] Cannot wait for Research Runtime Service: invalid candidate PID '$candidate_pid'" >&2
    return 1
  fi
  if [ "$owner_type" != "child" ] && [ "$owner_type" != "supervised" ]; then
    echo "[ERROR] Cannot wait for Research Runtime Service: invalid owner type '$owner_type'" >&2
    return 1
  fi
  if ! command -v "$curl_bin" >/dev/null 2>&1; then
    echo "[ERROR] $curl_bin is required to verify the Research Runtime Service health endpoint" >&2
    return 1
  fi

  echo -n "[dev] Waiting for Research Runtime Service..."
  for attempt in $(seq 1 "$attempts"); do
    if [ -f "$port_file" ] && [ -f "$token_file" ]; then
      port="$(tr -d '[:space:]' < "$port_file" 2>/dev/null || true)"
      token="$(tr -d '[:space:]' < "$token_file" 2>/dev/null || true)"
      if [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] && [ -n "$token" ]; then
        health="$($curl_bin --fail --silent --show-error --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
        if [[ "$health" == *'"status":"ok"'* ]]; then
          echo " ready on :$port"
          return 0
        fi
      fi
    fi

    candidate_state="$(ps -p "$candidate_pid" -o stat= 2>/dev/null || true)"
    if [ "$candidate_exited" -eq 0 ] && { [ -z "$candidate_state" ] || [[ "$candidate_state" == Z* ]]; }; then
      if [ "$owner_type" = "supervised" ]; then
        echo " FAILED (supervised owner PID $candidate_pid exited; inspect supervisor logs for status)"
        return 1
      fi
      set +e
      wait "$candidate_pid"
      child_status=$?
      set -e
      candidate_exited=1
      if [ "$child_status" -ne 3 ]; then
        echo " FAILED (candidate PID $candidate_pid exited with status $child_status)"
        return 1
      fi
      # Exit 3 is the TICKET_1334 role-claim result: another live host won.
      # Continue only long enough to validate that incumbent's discovery and
      # health evidence; an exit code alone is never readiness.
    fi

    echo -n "."
    sleep "$delay_seconds"
  done

  echo " TIMEOUT"
  if [ -e "$port_file" ] || [ -e "$token_file" ]; then
    echo "[ERROR] Research Runtime Service discovery evidence is malformed, stale, or unreachable in $discovery_dir" >&2
  else
    echo "[ERROR] No Service API runtime owner published discovery evidence in $discovery_dir" >&2
  fi
  return 1
}
