#!/usr/bin/env bash
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEFAULT_OUTPUT_ROOT="/tmp/quantnexus-phase0-runs"
readonly OUTPUT_ROOT="${QNX_PHASE0_OUTPUT_ROOT:-$DEFAULT_OUTPUT_ROOT}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/measure-modern-cpp-phase0.sh preflight
  QNX_PHASE0_CONFIRM_FRESH=YES QNX_PHASE0_DATASET_ID=<immutable-id> \
    bash scripts/measure-modern-cpp-phase0.sh run <MC-01..MC-21> <cold|warm|failure> -- <command> [args...]

The run command starts only the command supplied after --. It never discovers, stops,
restarts, or replaces an existing workload. Do not put credentials in command arguments.
Set QNX_PHASE0_INPUT_PATHS to a colon-separated list of input files/directories whose
metadata should be recorded. Results default to /tmp/quantnexus-phase0-runs.
EOF
}

write_if_readable() {
  local source_path="$1"
  local destination_path="$2"
  if [[ -r "$source_path" ]]; then
    cp "$source_path" "$destination_path"
  else
    printf 'unavailable\n' > "$destination_path"
  fi
}

capture_environment() {
  local destination="$1"
  local cgroup_relative
  cgroup_relative="$(awk -F: '$1 == "0" { print $3; exit }' /proc/self/cgroup 2>/dev/null)"
  local cgroup_directory="/sys/fs/cgroup${cgroup_relative:-/}"
  mkdir -p "$destination"
  {
    printf 'captured_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'source_commit=%s\n' "$(git -C "$REPO_ROOT" rev-parse HEAD)"
    printf 'branch=%s\n' "$(git -C "$REPO_ROOT" branch --show-current)"
    printf 'kernel=%s\n' "$(uname -srmo)"
    printf 'logical_cpus=%s\n' "$(nproc)"
    printf 'node=%s\n' "$(node --version 2>/dev/null || printf unavailable)"
    printf 'python=%s\n' "$(python --version 2>&1 || printf unavailable)"
    printf 'compiler=%s\n' "$(c++ --version 2>/dev/null | head -n 1 || printf unavailable)"
    printf 'cgroup=%s\n' "$cgroup_relative"
  } > "$destination/environment.txt"
  write_if_readable /proc/meminfo "$destination/proc-meminfo.txt"
  write_if_readable "$cgroup_directory/cpu.max" "$destination/cgroup-cpu.max.txt"
  write_if_readable "$cgroup_directory/cpu.stat" "$destination/cgroup-cpu.stat.txt"
  write_if_readable "$cgroup_directory/memory.max" "$destination/cgroup-memory.max.txt"
  write_if_readable "$cgroup_directory/memory.high" "$destination/cgroup-memory.high.txt"
  write_if_readable "$cgroup_directory/memory.current" "$destination/cgroup-memory.current.txt"
  write_if_readable "$cgroup_directory/memory.peak" "$destination/cgroup-memory.peak.txt"
  write_if_readable "$cgroup_directory/memory.events" "$destination/cgroup-memory.events.txt"
  write_if_readable "$cgroup_directory/cpuset.cpus.effective" "$destination/cgroup-cpuset.txt"
  write_if_readable "$cgroup_directory/io.stat" "$destination/cgroup-io.stat.txt"
  ps -eo pid,ppid,etimes,pcpu,pmem,rss,nlwp,comm,args --sort=-rss > "$destination/processes.txt"
}

capture_inputs() {
  local destination="$1"
  local raw_paths="${QNX_PHASE0_INPUT_PATHS:-}"
  : > "$destination/inputs.txt"
  if [[ -z "$raw_paths" ]]; then
    printf 'No QNX_PHASE0_INPUT_PATHS supplied.\n' >> "$destination/inputs.txt"
    return
  fi
  local old_ifs="$IFS"
  IFS=':'
  read -r -a input_paths <<< "$raw_paths"
  IFS="$old_ifs"
  local input_path
  for input_path in "${input_paths[@]}"; do
    if [[ -f "$input_path" ]]; then
      stat --printf='file=%n bytes=%s mtime=%y\n' "$input_path" >> "$destination/inputs.txt"
      sha256sum "$input_path" >> "$destination/inputs.txt"
    elif [[ -d "$input_path" ]]; then
      stat --printf='directory=%n bytes=%s mtime=%y\n' "$input_path" >> "$destination/inputs.txt"
      find "$input_path" -type f -printf '%P\t%s\t%T@\n' | LC_ALL=C sort | sha256sum >> "$destination/inputs.txt"
    else
      printf 'missing=%s\n' "$input_path" >> "$destination/inputs.txt"
    fi
  done
}

preflight() {
  local destination="$OUTPUT_ROOT/preflight-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$destination"
  capture_environment "$destination"
  {
    printf 'Known production-like processes are listed for review only.\n'
    pgrep -af 'stratforge|nona_algorithm|sweep_runner|fit_one|fit_universe|Electron' || true
  } > "$destination/known-workloads.txt"
  printf 'Preflight captured at %s\n' "$destination"
  printf 'Review known-workloads.txt before authorizing any fresh run.\n'
}

run_measurement() {
  if [[ "$#" -lt 4 ]]; then
    usage
    return 2
  fi
  local candidate="$1"
  local run_kind="$2"
  shift 2
  if [[ ! "$candidate" =~ ^MC-(0[1-9]|1[0-9]|2[01])$ ]]; then
    printf 'Invalid candidate: %s\n' "$candidate" >&2
    return 2
  fi
  if [[ ! "$run_kind" =~ ^(cold|warm|failure)$ ]]; then
    printf 'Run kind must be cold, warm, or failure.\n' >&2
    return 2
  fi
  if [[ "${1:-}" != '--' ]]; then
    printf 'Expected -- before the measured command.\n' >&2
    return 2
  fi
  shift
  if [[ "$#" -eq 0 ]]; then
    printf 'Measured command is missing.\n' >&2
    return 2
  fi
  if [[ "${QNX_PHASE0_CONFIRM_FRESH:-}" != 'YES' ]]; then
    printf 'Refusing to start a workload without QNX_PHASE0_CONFIRM_FRESH=YES.\n' >&2
    return 2
  fi
  if [[ -z "${QNX_PHASE0_DATASET_ID:-}" ]]; then
    printf 'QNX_PHASE0_DATASET_ID is required.\n' >&2
    return 2
  fi

  local run_id
  run_id="$(date -u +%Y%m%dT%H%M%SZ)-${candidate}-${run_kind}"
  local destination="$OUTPUT_ROOT/$run_id"
  mkdir -p "$destination"
  capture_environment "$destination/before"
  capture_inputs "$destination"
  printf '%s\n' "$QNX_PHASE0_DATASET_ID" > "$destination/dataset-id.txt"
  printf '%q ' "$@" > "$destination/command.txt"
  printf '\n' >> "$destination/command.txt"

  local cgroup_relative
  cgroup_relative="$(awk -F: '$1 == "0" { print $3; exit }' /proc/self/cgroup 2>/dev/null)"
  local cgroup_directory="/sys/fs/cgroup${cgroup_relative:-/}"
  local io_before io_after
  io_before="$(cat "$cgroup_directory/io.stat" 2>/dev/null || printf unavailable)"
  set +e
  /usr/bin/time -v -o "$destination/time.txt" -- "$@" \
    > "$destination/stdout.log" 2> "$destination/stderr.log" &
  local measured_pid=$!
  set -e
  printf '%s\n' "$measured_pid" > "$destination/wrapper-pid.txt"

  while kill -0 "$measured_pid" 2>/dev/null; do
    {
      date -u +%Y-%m-%dT%H:%M:%SZ
      ps -o pid,ppid,etimes,pcpu,pmem,rss,nlwp,stat,comm,args \
        -p "$measured_pid" --ppid "$measured_pid"
    } >> "$destination/process-samples.txt" 2>&1 || true
    sleep 1
  done

  set +e
  wait "$measured_pid"
  local exit_code=$?
  set -e
  io_after="$(cat "$cgroup_directory/io.stat" 2>/dev/null || printf unavailable)"
  printf '%s\n' "$exit_code" > "$destination/exit-code.txt"
  printf '%s\n' "$io_before" > "$destination/cgroup-io-before.txt"
  printf '%s\n' "$io_after" > "$destination/cgroup-io-after.txt"
  capture_environment "$destination/after"
  printf 'Measurement captured at %s with exit code %s\n' "$destination" "$exit_code"
  return "$exit_code"
}

case "${1:-}" in
  preflight)
    preflight
    ;;
  run)
    shift
    run_measurement "$@"
    ;;
  *)
    usage
    exit 2
    ;;
esac
