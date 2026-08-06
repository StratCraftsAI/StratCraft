#!/bin/bash
#
# StratCraft Launch Script
#
# Usage:
#   ./start.sh          # Start app (dev mode)
#   ./start.sh stop     # Stop running StratCraft processes
#   ./start.sh install  # Install dependencies
#   ./start.sh build    # Production build (auto-stops running app first)
#   ./start.sh plugin   # Build all plugins
#   ./start.sh ql       # Sync quant-lab-nexus UI (presentation only)
#   ./start.sh quant-lab-dev-install  # Full dev package: build+sign+install
#   ./start.sh cc       # Build + sync signal-generator-nexus plugin (CCXT)
#   ./start.sh executor # Build stratforge-runner (C++ strategy executor)
#
# Environment Variables:
#   KEEP_PLUGIN_DATA=1  # Keep plugin data in dev mode (default: clean each run)
#
# Examples:
#   KEEP_PLUGIN_DATA=1 ./start.sh     # Start but keep plugin data
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# TICKET_1297_1: Guide WebUI ownership rules live in one shared module so the
# build path and the Guide launchers cannot disagree about what they own.
# shellcheck source=apps/web-dashboard/dev-lifecycle.sh
source "$ROOT_DIR/apps/web-dashboard/dev-lifecycle.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# TICKET_1371: Build fingerprint infrastructure
# Content-addressed SHA-256 fingerprints stored in .build-cache/ allow unchanged
# stages to be skipped on incremental builds. CLEAN_BUILD=1 bypasses all caching.

BUILD_CACHE_DIR="$ROOT_DIR/.build-cache"

# TICKET_1297_1: positive ownership record for the Electron development session.
#
# `start.sh build` runs in a different shell from the `./start.sh` dev session it
# may need to clean up after, so ownership cannot be read from `$$`. The session
# therefore publishes a record here at launch, and the stop path terminates only
# processes that record positively identifies.
#
# Ownership is established, not observed. An earlier revision recorded the
# session's process-group id, which is wrong: a PGID is *inherited*, not owned.
# In any shell without job control -- a script, a CI step, a non-interactive
# orchestration -- `bash apps/web-dashboard/start-dev.sh & ./start.sh` places the
# foreground Guide and the Electron session in the SAME process group. The Guide
# started that way is not in `stratcraft-webdash-dev.service`, so the cgroup
# exclusion does not cover it either, and its Vite argv matches the candidate
# pattern. A PGID-based claim would authorize killing it, breaking the
# Electron/Guide isolation contract.
#
# The session instead mints an unguessable token, exports it into the dev
# subtree's environment, and verifies candidate membership by reading
# `/proc/<pid>/environ`. A process carries the token only if it was started by
# (or descends from) the session that minted it -- a launch fact no sibling can
# inherit by accident.
#
# The record also stores the launcher's PID and its `/proc/<pid>/stat` start
# time. Start time makes the identity immune to PID reuse: a recycled PID cannot
# masquerade as the original launcher.
#
# This is the Electron-side counterpart to `webdash_pid_is_guide_owned`: both
# answer "did a session I know about start this?" from a launch fact, rather
# than inferring authority from an argv shape, an inherited group, or from a
# process merely not belonging to some other surface.
ELECTRON_DEV_OWNER_FILE="$BUILD_CACHE_DIR/electron-dev-owner.json"
ELECTRON_DEV_TOKEN_VAR="STRATCRAFT_ELECTRON_DEV_SESSION_TOKEN"

ensure_build_cache_dir() {
    mkdir -p "$BUILD_CACHE_DIR"
}

compute_fingerprint() {
    local env_inputs=""
    local paths=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --env)
                shift
                env_inputs="${env_inputs}${1}"$'\n'
                shift
                ;;
            *)
                paths+=("$1")
                shift
                ;;
        esac
    done
    local file_hash=""
    if [ ${#paths[@]} -gt 0 ]; then
        file_hash=$(find "${paths[@]}" -type f \
            -not -path "*/node_modules/*" \
            -not -path "*/.git/*" \
            -not -path "*/build/*" \
            -not -path "*/dist/*" \
            2>/dev/null \
            | LC_ALL=C sort \
            | xargs sha256sum 2>/dev/null \
            | sha256sum \
            | awk '{print $1}')
    fi
    printf '%s%s' "$file_hash" "$env_inputs" | sha256sum | awk '{print $1}'
}

stage_is_current() {
    local stage="$1"
    local fingerprint="$2"
    local cache_file="$BUILD_CACHE_DIR/${stage}.sha256"
    [ -f "$cache_file" ] || return 1
    local stored
    stored=$(cat "$cache_file" 2>/dev/null) || return 1
    [ "$stored" = "$fingerprint" ]
}

save_fingerprint() {
    local stage="$1"
    local fingerprint="$2"
    ensure_build_cache_dir
    printf '%s' "$fingerprint" > "$BUILD_CACHE_DIR/${stage}.sha256"
}

invalidate_fingerprint() {
    local stage="$1"
    rm -f "$BUILD_CACHE_DIR/${stage}.sha256"
}

clean_build_cache() {
    if [ -d "$BUILD_CACHE_DIR" ]; then
        rm -rf "$BUILD_CACHE_DIR"
        log_info "Build cache cleared"
    fi
}

# Build report accumulator (TICKET_1371 D1)
BUILD_REPORT_STAGES=""
BUILD_REPORT_START=""

build_report_init() {
    BUILD_REPORT_START=$(date +%s%N)
    BUILD_REPORT_STAGES=""
}

build_report_stage() {
    local name="$1" wall_ns="$2" cache="$3" fingerprint="$4"
    local wall_ms=$(( wall_ns / 1000000 ))
    if [ -n "$BUILD_REPORT_STAGES" ]; then
        BUILD_REPORT_STAGES="${BUILD_REPORT_STAGES},"
    fi
    BUILD_REPORT_STAGES="${BUILD_REPORT_STAGES}{\"name\":\"${name}\",\"wallMs\":${wall_ms},\"cache\":\"${cache}\",\"fingerprint\":\"${fingerprint:0:16}\"}"
}

build_report_write() {
    ensure_build_cache_dir
    local total_ns=$(( $(date +%s%N) - BUILD_REPORT_START ))
    local total_ms=$(( total_ns / 1000000 ))
    local revision
    revision=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local platform_arch
    platform_arch="$(uname -s)-$(uname -m)"
    local mode="incremental"
    [ "${CLEAN_BUILD:-0}" = "1" ] && mode="clean"
    cat > "$BUILD_CACHE_DIR/build-report.json" <<REPORT_EOF
{"mode":"${mode}","revision":"${revision}","platform":"${platform_arch}","stages":[${BUILD_REPORT_STAGES}],"totalWallMs":${total_ms}}
REPORT_EOF
    log_info "Build report: ${total_ms}ms total (${mode}, ${revision}) -> .build-cache/build-report.json"
}

# Detect package manager
detect_pm() {
    if command -v pnpm &> /dev/null; then
        echo "pnpm"
    elif command -v npm &> /dev/null; then
        echo "npm"
    else
        log_error "npm or pnpm is not installed"
        exit 1
    fi
}

PM=$(detect_pm)
log_info "Using package manager: $PM"

# Find running StratCraft process PIDs from this project (exclude zombies).
#
# The pattern MUST cover the whole `turbo dev` process tree, not just Electron.
# `turbo dev` fans out one `tsup --watch` (and tsc -w) per workspace package
# plus one `vite build --watch` per plugin UI -- ~40 long-lived Node watchers.
# Matching only electron-vite/electron left those orphaned on every run; each
# holds 1-2 inotify instances, so successive runs accumulated them until
# fs.inotify.max_user_instances (128) was exhausted and Vite died with
# `EMFILE: too many open files, watch .../src/renderer`.
# Matching is anchored to $ROOT_DIR so other repos' watchers are never touched.
#
# TICKET_1297_1: the argv pattern selects *candidates*; it never decides
# ownership. Termination requires a positive launch fact -- carrying the
# session token recorded by the Electron dev session in
# `$ELECTRON_DEV_OWNER_FILE`. Two exclusions follow from that rule:
#
#   * Guide WebUI processes (MCP :7789, Vite :7790) belong to
#     `stratcraft-webdash-dev.service`, never to the Electron dev session.
#   * The Turbo daemon is a user-scoped, session-shared cache daemon started on
#     demand by any Turbo invocation. Stopping it was never this script's
#     authority. The token test alone does NOT protect it: the daemon is
#     spawned on demand by the first `turbo dev` of this very session, so it
#     inherits the exported token and would otherwise satisfy every ownership
#     test. It is therefore removed from the candidate set by argv, before
#     ownership is consulted -- it is a shared cache daemon, not a watcher this
#     session must stop to release inotify instances or free a port.
#
# The earlier argv-only form killed :7790 the moment an install regenerated
# `apps/web-dashboard/node_modules/.bin/vite` into an absolute path, because
# that made the Guide Vite match `$ROOT_DIR` for the first time. Ownership is a
# launch fact, not a string shape.
# Field 22 of /proc/<pid>/stat is the process start time in clock ticks since
# boot. Combined with the PID it forms an identity that PID reuse cannot forge.
process_start_time() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    awk '{print $22}' "/proc/$pid/stat" 2>/dev/null | tr -d '[:space:]'
}

# Emits the owning session's token when a live, non-stale claim exists.
electron_dev_owner_token() {
    local token owner_pid owner_start current_start
    [ -f "$ELECTRON_DEV_OWNER_FILE" ] || return 1

    token="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ELECTRON_DEV_OWNER_FILE" 2>/dev/null)"
    owner_pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$ELECTRON_DEV_OWNER_FILE" 2>/dev/null)"
    owner_start="$(sed -n 's/.*"start_time"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ELECTRON_DEV_OWNER_FILE" 2>/dev/null)"

    [[ "$token" =~ ^[A-Za-z0-9_-]{16,}$ ]] || return 1
    [[ "$owner_pid" =~ ^[0-9]+$ ]] && [ "$owner_pid" -gt 1 ] || return 1
    [ -n "$owner_start" ] || return 1

    # The launcher must still be alive AND be the same process that wrote the
    # claim. A recycled PID has a different start time and is rejected.
    current_start="$(process_start_time "$owner_pid")" || return 1
    [ "$current_start" = "$owner_start" ] || return 1

    echo "$token"
}

# True when the process's environment carries the owning session's token, i.e.
# it was started by that session or descends from it.
electron_dev_pid_carries_token() {
    local pid="$1" token="$2"
    [[ "$pid" =~ ^[0-9]+$ ]] && [ -n "$token" ] || return 1
    # -F and -x: match the whole NUL-delimited entry, never a substring of some
    # unrelated variable that happens to contain the token text.
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null \
        | grep -qxF "$ELECTRON_DEV_TOKEN_VAR=$token"
}

claim_electron_dev_ownership() {
    ensure_build_cache_dir

    # Unguessable so no unrelated process can assert membership by accident or
    # by copying a predictable value.
    ELECTRON_DEV_SESSION_TOKEN="$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')"
    [ -n "$ELECTRON_DEV_SESSION_TOKEN" ] || {
        log_error "Could not mint an Electron dev session token"
        return 1
    }

    # Exported so every process the session starts -- and everything they start
    # in turn -- inherits it. This is what makes membership a launch fact.
    export "$ELECTRON_DEV_TOKEN_VAR=$ELECTRON_DEV_SESSION_TOKEN"

    local start_time
    start_time="$(process_start_time $$)"
    printf '{"token":"%s","pid":%s,"start_time":"%s"}\n' \
        "$ELECTRON_DEV_SESSION_TOKEN" "$$" "$start_time" > "$ELECTRON_DEV_OWNER_FILE"
}

release_electron_dev_ownership() {
    rm -f "$ELECTRON_DEV_OWNER_FILE" 2>/dev/null || true
}

find_running_pids() {
    local pid owner_token
    # Fail closed: with no live claim, this session may terminate nothing.
    owner_token="$(electron_dev_owner_token)" || return 0

    ps -eo pid,stat,args 2>/dev/null \
        | grep -E "[e]lectron-vite.js dev|[e]lectron/dist/electron \.|[t]urbo(-[a-z0-9-]+)?/bin/turbo|[t]sup/dist/cli-default.js|[t]ypescript/(bin|lib)/tsc|[v]ite/bin/vite.js (build --watch|dev|--host)" \
        | grep -F "$ROOT_DIR" \
        | grep -Ev '/turbo[^[:space:]]*[[:space:]]([^[:space:]]+[[:space:]])*daemon([[:space:]]|$)' \
        | awk '$2 !~ /^Z/ {print $1}' \
        | while read -r pid; do
            # Defence in depth: a supervised Guide process is never terminable
            # by this path, whatever else it may carry.
            webdash_pid_is_guide_owned "$pid" && continue
            # The decisive test: the process must carry this session's token.
            electron_dev_pid_carries_token "$pid" "$owner_token" || continue
            echo "$pid"
        done || true
}

# Stop running StratCraft processes gracefully (SIGTERM -> wait -> SIGKILL)
stop_running_processes() {
    local pids
    pids=$(find_running_pids)
    if [ -z "$pids" ]; then
        log_info "No running StratCraft processes found"
        return 0
    fi

    log_info "Stopping StratCraft processes (PIDs: $(echo $pids | tr '\n' ' '))..."
    kill -TERM $pids 2>/dev/null || true

    local waited=0
    while [ $waited -lt 10 ]; do
        pids=$(find_running_pids)
        [ -z "$pids" ] && break
        sleep 1
        waited=$((waited + 1))
    done

    pids=$(find_running_pids)
    if [ -n "$pids" ]; then
        log_warn "Processes did not exit after 10s, sending SIGKILL..."
        kill -9 $pids 2>/dev/null || true
        sleep 1
    fi

    pids=$(find_running_pids)
    if [ -n "$pids" ]; then
        log_error "Failed to stop processes: $(echo $pids | tr '\n' ' ')"
        return 1
    fi

    log_info "StratCraft processes stopped"
}

# Stop running processes before build/dev to prevent conflicts
check_running_processes() {
    local mode="$1"  # "dev" or "build"
    local pids
    pids=$(find_running_pids)

    if [ -n "$pids" ]; then
        log_warn "StratCraft is running (PIDs: $(echo $pids | tr '\n' ' ')), stopping before $mode..."
        stop_running_processes || { log_error "Cannot stop running processes, aborting $mode"; exit 1; }
    fi
}

# TICKET_560: Prevent turbo dev hang from large dirty state or exhausted inotify
# budget. TICKET_1297_1 removed the zombie-daemon and stale-socket steps: both
# reached into user-scoped state shared with every other repo on the machine.
turbo_preflight() {
    if [ "${SKIP_TURBO_PREFLIGHT:-0}" = "1" ]; then
        log_warn "Turbo preflight checks skipped (SKIP_TURBO_PREFLIGHT=1)"
        return 0
    fi

    # TICKET_1297_1: this preflight touches NO Turbo daemon state. The daemon is
    # user-scoped and shared across every repo and session on this machine, and
    # `./start.sh` owns only the Electron dev session it launched.
    #
    # Two removed steps, and why neither has a conditional form worth keeping:
    #
    #   * `pgrep -f "turbo.*daemon"` + `kill -9`, run on every `start_dev()`.
    #     It asserted no ownership fact whatsoever -- not zombie state, not
    #     repo, not session -- and SIGKILLed the daemon serving every other
    #     checkout on the machine.
    #   * `rm -rf /tmp/turbod`. That directory holds one subdirectory per repo
    #     hash, all repos side by side, so wiping it broke live daemons
    #     elsewhere.
    #
    # `turbo daemon clean` is NOT the safe replacement and was rejected in
    # review. Its own CLI description (verified against the installed Turbo
    # 2.7.2) is "Stops the turbo daemon if it is already running, and removes
    # any stale daemon state" -- it stops a *running, healthy* daemon
    # unconditionally and never tests staleness first. Routing the same
    # unconditional stop through a CLI instead of a signal changes the
    # mechanism, not the contract violation.
    #
    # Nothing needs to replace them. Turbo owns its daemon's lifecycle: it
    # detects a dead, unreachable, or version-mismatched daemon and respawns it
    # on the next invocation. Genuinely stale state is a diagnosed incident --
    # run `turbo daemon clean` by hand once there is evidence for it -- not a
    # cost every launch pays on the chance something might be wrong.
    #
    # The repo-level `.turbo` content-hash cache is likewise preserved: it is
    # what makes incremental workspace builds fast (TICKET_1371 R7).

    # Step 1: Check git dirty state -- block if turbo hang is likely
    # Only count source files turbo builds care about (exclude vendored toolchain headers,
    # docs, and other non-build artifacts that inflate the count without affecting turbo)
    local dirty_count=$(git diff --name-only HEAD 2>/dev/null \
        | grep -v '^apps/desktop/resources/toolchain/' \
        | grep -v '^docs/' \
        | grep -v '^README' \
        | wc -l)
    if [ "$dirty_count" -gt 100 ]; then
        log_error "Large git dirty state detected ($dirty_count source files). Turbo will likely hang."
        log_error "Commit or stash changes first:"
        log_error "  git stash          # stash all changes"
        log_error "  git add -A && git commit -m 'wip'   # commit changes"
        log_error ""
        log_error "To skip this check: SKIP_TURBO_PREFLIGHT=1 ./start.sh"
        exit 1
    fi

    # Step 2: Check inotify watch limit (files only, full depth, exclude node_modules/.git)
    local inotify_limit=$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo 0)
    local file_count=$(find . -not -path "*/node_modules/*" -not -path "*/.git/*" -type f 2>/dev/null | wc -l)
    if [ "$inotify_limit" -gt 0 ] && [ "$file_count" -gt "$inotify_limit" ]; then
        log_warn "Repo file count ($file_count) exceeds inotify limit ($inotify_limit)"
        log_warn "Turbo file watcher may fail. Increase limit:"
        log_warn "  echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p"
    fi

    # Step 3: Check inotify INSTANCE headroom.
    #
    # Step 2 guards max_user_watches (how many paths one instance may watch).
    # The failure that actually kills dev mode is a different knob:
    # max_user_instances -- how many inotify FDs one uid may hold at once. Vite
    # and every tsup/tsc watcher call inotify_init per watch root, so a full
    # `turbo dev` fan-out costs ~60-70 instances against a default ceiling of
    # 128. Exhausting it surfaces as `EMFILE ... watch`, which reads like an
    # fd-limit problem but is NOT fixed by ulimit -n.
    local inst_limit=$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || echo 0)
    if [ "$inst_limit" -gt 0 ]; then
        local inst_used=0 p n
        for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
            [ "$(stat -c %U /proc/$p 2>/dev/null)" = "$(id -un)" ] || continue
            n=$(ls -l /proc/$p/fd 2>/dev/null | grep -c 'anon_inode:inotify') || true
            inst_used=$((inst_used + ${n:-0}))
        done
        local inst_free=$((inst_limit - inst_used))
        log_info "inotify instances: ${inst_used}/${inst_limit} used by $(id -un) (${inst_free} free)"
        # A cold `turbo dev` fan-out needs ~70; refuse to start into a ceiling
        # that will only fail later, deep inside the Vite build (TICKET_856:
        # fail loudly and actionably rather than silently degrading).
        if [ "$inst_free" -lt 70 ]; then
            log_error "Not enough inotify instances free (${inst_free}); dev watchers need ~70."
            log_error "Stale watchers from a previous run are the usual cause:"
            log_error "  ./start.sh stop     # reap this repo's watcher fleet"
            log_error "If none are stale, raise the ceiling permanently:"
            log_error "  echo fs.inotify.max_user_instances=1024 | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system"
            exit 1
        fi
    fi
}

# TICKET_1289 P4.5 (F4): materialise the declarative research Python env from
# pixi.toml/pixi.lock. Idempotent: `pixi install` is a no-op when the env is
# already in sync with the lock. When pixi is absent we do NOT hard-fail the
# whole bootstrap (pnpm/plugin/executor build must still work for app dev);
# instead we emit a LOUD, actionable warning (TICKET_856) and continue.
pixi_install() {
    if [ ! -f "$ROOT_DIR/pixi.toml" ]; then
        log_warn "pixi.toml not found at repo root -- skipping research env install."
        return 0
    fi
    if ! command -v pixi &> /dev/null; then
        log_warn "==================================================================="
        log_warn "pixi is NOT installed -- the declarative research Python env"
        log_warn "(gplearn/gpquant/pysr/catboost/lightgbm/xgboost/torch/onnx/pyarrow/"
        log_warn "duckdb/... -- see pixi.toml) will NOT be materialised."
        log_warn "Sweeps/factor-mining/LSTM training depend on this env."
        log_warn "Install pixi, then re-run './start.sh install':"
        log_warn "  curl -fsSL https://pixi.sh/install.sh | bash"
        log_warn "(TICKET_1289 F4 / TICKET_856 loud fallback -- app dev continues.)"
        log_warn "==================================================================="
        return 0
    fi
    if [ ! -f "$ROOT_DIR/pixi.lock" ]; then
        log_error "pixi.lock is missing -- the research env cannot be materialised"
        log_error "reproducibly. Regenerate it with a real solve and commit it:"
        log_error "  pixi install --manifest-path '$ROOT_DIR/pixi.toml'"
        log_error "(TICKET_1335 D0: the lock is never hand-authored.)"
        return 1
    fi
    # TICKET_1335 D3: --locked is MANDATORY. Bare `pixi install` silently
    # re-solves and REWRITES pixi.lock when the manifest has drifted, which
    # turns a bootstrap into an unreviewed dependency change. --locked instead
    # fails fast on drift so the lock is updated through normal dependency
    # review. start.sh and the in-app installer must not diverge here.
    log_info "Installing research Python env via pixi --locked (idempotent -- no-op when in sync)..."
    if ! (cd "$ROOT_DIR" && pixi install --locked); then
        log_error "pixi install --locked failed -- research env is not reproducible."
        log_error "If this is manifest/lock drift, re-solve and COMMIT the new lock:"
        log_error "  pixi install --manifest-path '$ROOT_DIR/pixi.toml'"
        log_error "Otherwise fix the cause (network / pixi.toml constraints) and re-run."
        return 1
    fi
    log_info "Research Python env is in sync with pixi.lock."
}

# Install dependencies
install_deps() {
    log_info "Installing project dependencies..."
    $PM install

    log_info "Installing public research contracts..."
    python -m pip install -e "$ROOT_DIR/packages/research-contracts"

    log_info "Building plugins..."
    build_plugins

    # TICKET_1289 F4: materialise the research Python env (idempotent).
    pixi_install
}

# TICKET_821_1 S2: Dump Python `_param_schema.py` defaults to a JSON
# manifest the TS fan-out drift test reads. Build-time only -- the
# desktop main process never imports this file at runtime; it exists
# solely so CI fails when the TS `FANOUT_TEMPLATES[].defaultParams`
# table drifts from the Python schemas. Cheap (~50ms), idempotent.
dump_param_schema_manifest() {
    log_info "Dumping signal-source param schema manifest..."
    local pkg_dir="$ROOT_DIR/packages/nona-algorithm"
    if [ ! -d "$pkg_dir/nona_algorithm/signal_sources" ]; then
        log_warn "nona-algorithm not present, skipping manifest dump"
        return 0
    fi
    if ! (cd "$pkg_dir" && python -m nona_algorithm.signal_sources._dump_param_schema 2>&1); then
        log_error "Param schema manifest dump failed -- TICKET_821_1 drift test will not be reliable"
        return 1
    fi
}

# Build TypeScript plugins
compute_plugin_fingerprint() {
    local plugin_dir="$1"
    local lock_hash="$2"
    local paths=()
    [ -d "$plugin_dir/src" ] && paths+=("$plugin_dir/src")
    [ -f "$plugin_dir/package.json" ] && paths+=("$plugin_dir/package.json")
    [ -f "$plugin_dir/tsconfig.json" ] && paths+=("$plugin_dir/tsconfig.json")
    for vc in "$plugin_dir"/vite.config.*; do
        [ -f "$vc" ] && paths+=("$vc")
    done
    for ui_sub in "$plugin_dir"/ui/*/; do
        [ -d "$ui_sub/src" ] && paths+=("$ui_sub/src")
        [ -f "$ui_sub/package.json" ] && paths+=("$ui_sub/package.json")
        [ -f "$ui_sub/tsconfig.json" ] && paths+=("$ui_sub/tsconfig.json")
        for vc in "$ui_sub"/vite.config.*; do
            [ -f "$vc" ] && paths+=("$vc")
        done
    done
    if [ ${#paths[@]} -eq 0 ]; then
        echo "empty"
        return
    fi
    compute_fingerprint "${paths[@]}" --env "$lock_hash"
}

build_plugins() {
    log_info "Searching and building TypeScript plugins..."
    local failed=0
    local pkg_path plugin_dir plugin_name
    # TICKET_1371 R1: compute lockfile hash once for all plugin fingerprints.
    local lock_hash
    lock_hash=$(sha256sum "$ROOT_DIR/pnpm-lock.yaml" 2>/dev/null | awk '{print $1}')
    # TICKET_1228: iterate in the main shell -- the previous find|while pipeline
    # ran the loop in a subshell, so a plugin build failure could never reach
    # build_prod and the production build continued on broken output.
    for pkg_path in $(find plugins -name "package.json" -not -path "*/node_modules/*"); do
        plugin_dir=$(dirname "$pkg_path")
        plugin_name=$(basename "$plugin_dir")
        # Skip metadata-only packages (e.g. back-test-nexus root: manifest +
        # deps, real build lives in ui/package.json) -- same contract as
        # build_plugins_incremental: no "build" script means not buildable.
        if ! grep -q '"build"' "$pkg_path" 2>/dev/null; then
            log_info "Plugin $plugin_name: no build script, skipping"
            continue
        fi
        # TICKET_1371 R1+R4: per-plugin fingerprinting. Skip if content
        # unchanged and dist exists.
        local plugin_fp plugin_start plugin_cache
        plugin_fp=$(compute_plugin_fingerprint "$plugin_dir" "$lock_hash")
        plugin_start=$(date +%s%N)
        if stage_is_current "plugin-$plugin_name" "$plugin_fp" && [ -d "$plugin_dir/dist" ]; then
            log_info "Plugin $plugin_name: up-to-date [fp:${plugin_fp:0:8}] (skipping)"
            build_report_stage "plugin-$plugin_name" "$(( $(date +%s%N) - plugin_start ))" "hit" "$plugin_fp"
            continue
        fi
        log_info "Building plugin: $plugin_name (in $plugin_dir)"
        # TICKET_588: Remove stale tsc artifacts from src/ to prevent Vite .js > .tsx shadowing
        clean_plugin_src_artifacts "$plugin_dir"
        # TICKET_1371 R1: workspace lockfile handles deps for workspace plugins.
        # Only external (symlinked) plugins need per-plugin install.
        plugin_build_ok=0
        if [ -L "$plugin_dir" ]; then
            (cd "$plugin_dir" && $PM install && $PM run build) || plugin_build_ok=$?
        else
            (cd "$plugin_dir" && $PM run build) || plugin_build_ok=$?
        fi
        if [ "$plugin_build_ok" -ne 0 ]; then
            log_error "Plugin $plugin_name build failed -- removing stale dist/ to prevent loading outdated code"
            rm -rf "$plugin_dir/dist"
            invalidate_fingerprint "plugin-$plugin_name"
            failed=1
            plugin_cache="fail"
        else
            save_fingerprint "plugin-$plugin_name" "$plugin_fp"
            plugin_cache="miss"
        fi
        build_report_stage "plugin-$plugin_name" "$(( $(date +%s%N) - plugin_start ))" "$plugin_cache" "$plugin_fp"
    done
    return $failed
}

# TICKET_588: Remove stale tsc compilation artifacts (.js, .d.ts, .js.map) from plugin src/.
# These shadow .ts/.tsx source files because Vite resolves .js before .tsx.
clean_plugin_src_artifacts() {
    local plugin_dir="$1"
    local src_dir="$plugin_dir/src"
    [ -d "$src_dir" ] || return 0
    local count=$(find "$src_dir" \( -name "*.js" -o -name "*.js.map" -o -name "*.d.ts.map" \) 2>/dev/null | wc -l)
    local dts_count=$(find "$src_dir" -name "*.d.ts" ! -name "global.d.ts" 2>/dev/null | wc -l)
    local total=$((count + dts_count))
    if [ "$total" -gt 0 ]; then
        find "$src_dir" \( -name "*.js" -o -name "*.js.map" -o -name "*.d.ts.map" \) -delete
        find "$src_dir" -name "*.d.ts" ! -name "global.d.ts" -delete
        log_info "Cleaned $total stale tsc artifact(s) from $src_dir"
    fi
}

# Build plugins incrementally (dev mode: only rebuild if source changed)
build_plugins_incremental() {
    log_info "Checking plugins for changes..."
    find plugins -name "package.json" -not -path "*/node_modules/*" | while read -r pkg_path; do
        plugin_dir=$(dirname "$pkg_path")
        plugin_name=$(basename "$plugin_dir")
        dist_dir="$plugin_dir/dist"

        # Skip if no build script
        if ! grep -q '"build"' "$pkg_path" 2>/dev/null; then
            continue
        fi

        # TICKET_588: Remove stale tsc artifacts from src/ to prevent Vite .js > .tsx shadowing
        clean_plugin_src_artifacts "$plugin_dir"

        # Check if dist exists
        if [ ! -d "$dist_dir" ]; then
            log_info "Plugin $plugin_name: dist not found, building..."
            if ! (cd "$plugin_dir" && $PM install --silent && $PM run build); then
                log_error "Plugin $plugin_name build failed -- no dist/ available"
            fi
            continue
        fi

        # Check if any src file is newer than dist
        local src_newer=$(find "$plugin_dir/src" -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs -r stat --format='%Y' 2>/dev/null | sort -rn | head -1)
        local dist_newest=$(find "$dist_dir" -name "*.js" 2>/dev/null | xargs -r stat --format='%Y' 2>/dev/null | sort -rn | head -1)

        if [ -n "$src_newer" ] && [ -n "$dist_newest" ] && [ "$src_newer" -gt "$dist_newest" ]; then
            log_info "Plugin $plugin_name: source changed, rebuilding..."
            if ! (cd "$plugin_dir" && $PM run build); then
                log_error "Plugin $plugin_name build failed -- removing stale dist/ to prevent loading outdated code"
                rm -rf "$plugin_dir/dist"
            fi
        else
            log_info "Plugin $plugin_name: up-to-date"
        fi
    done
}

# Sync a single bundled marketplace plugin into the user plugin dir for dev.
#
# Dev-mode bundled-vs-user paradox:
#   - plugin:scanAll skips bundled plugins whose manifest.distribution == "marketplace"
#     unless they appear in ~/.config/@StratCraft/desktop/plugins/.installed.json.
#   - The user dir is scanned without that check, so whatever is on disk there
#     is what actually loads -- often a stale snapshot from a previous install.
# Result: editing plugins/<id>/src + rebuilding plugins/<id>/dist has no effect,
# because Electron is loading ~/.config/.../plugins/<id>/ instead.
#
# This helper rebuilds the plugin's dist (incremental) and mirrors the runtime
# subset (manifest + ui/<name>/dist + ui/<name>/locales + scripts + plugin-level
# locales) into the user dir, then registers the id in .installed.json. It does
# NOT copy node_modules / src / out / config files -- the user dir is a runtime
# image, not a workspace.
sync_marketplace_plugin_dev() {
    local plugin_id="$1"
    local plugin_dir_name="$2"  # directory name under plugins/

    local src_root="$ROOT_DIR/plugins/$plugin_dir_name"
    local user_root="$HOME/.config/@StratCraft/desktop/plugins"
    local dest_root="$user_root/$plugin_id"
    local installed_marker="$user_root/.installed.json"

    if [ ! -d "$src_root" ]; then
        log_error "Plugin source not found: $src_root"
        return 1
    fi
    if [ ! -f "$src_root/manifest.json" ]; then
        log_error "manifest.json missing in $src_root"
        return 1
    fi

    # Guard: refuse to run while Electron is up -- the bundle is loaded into
    # memory at startup and stays mmaped; replacing it under a live process is
    # the failure mode that motivated TICKET_763's "stale process" incident.
    check_running_processes "ql"

    # TICKET_1371 R2: if the plugin was already built by build_plugins() in this
    # session (fingerprint saved), skip the redundant rebuild and go straight to
    # the file-copy step. The copy always runs because the user dir may be stale.
    local lock_hash sync_plugin_fp
    lock_hash=$(sha256sum "$ROOT_DIR/pnpm-lock.yaml" 2>/dev/null | awk '{print $1}')
    sync_plugin_fp=$(compute_plugin_fingerprint "$src_root" "$lock_hash")
    if stage_is_current "plugin-$plugin_dir_name" "$sync_plugin_fp" && [ -d "$src_root/dist" -o -d "$src_root/ui" ]; then
        log_info "[ql] Plugin $plugin_dir_name: using existing build [fp:${sync_plugin_fp:0:8}] (skip rebuild)"
    else
        log_info "[ql] Building plugin: $plugin_dir_name"
        clean_plugin_src_artifacts "$src_root"
        if [ -f "$src_root/package.json" ]; then
            (cd "$src_root" && $PM run build) || {
                log_error "[ql] Top-level build failed for $plugin_dir_name"
                return 1
            }
        fi
        local ui_subproject
        for ui_subproject in "$src_root"/ui/*/; do
            [ -d "$ui_subproject" ] || continue
            [ -f "$ui_subproject/package.json" ] || continue
            log_info "[ql] Building UI subproject: $ui_subproject"
            clean_plugin_src_artifacts "$ui_subproject"
            (cd "$ui_subproject" && $PM run build) || {
                log_error "[ql] UI subproject build failed: $ui_subproject"
                return 1
            }
        done
        save_fingerprint "plugin-$plugin_dir_name" "$sync_plugin_fp"
    fi

    # Verify the manifest's main bundle actually exists post-build.
    local main_rel
    main_rel=$(grep -oE '"main"[[:space:]]*:[[:space:]]*"[^"]+"' "$src_root/manifest.json" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    if [ -n "$main_rel" ] && [ ! -f "$src_root/$main_rel" ]; then
        log_error "[ql] manifest main not found after build: $src_root/$main_rel"
        return 1
    fi

    # Mirror runtime subset into user dir. Wipe first so deleted files do not
    # linger (cp -r merges, it does not prune).
    mkdir -p "$user_root"
    if [ -d "$dest_root" ]; then
        log_info "[ql] Removing stale user-dir plugin: $dest_root"
        rm -rf "$dest_root"
    fi
    mkdir -p "$dest_root"

    log_info "[ql] Mirroring runtime files to: $dest_root"
    # manifest is required
    cp "$src_root/manifest.json" "$dest_root/manifest.json"

    # Optional plugin-level dirs that ship with the runtime image.
    local d
    # Host packages may contain build-time node_modules/source/tests. Mirror
    # only the three package-owned runtime bundles; signed release assembly
    # applies the same exact dependency closure.
    if [ "$plugin_dir_name" = "quant-lab-nexus" ] && [ -d "$src_root/host" ]; then
        mkdir -p "$dest_root/host"
        local host_runtime_file
        for host_runtime_file in register.cjs commercial-operation.cjs commercial-stores.cjs; do
            if [ -f "$src_root/host/$host_runtime_file" ]; then
                cp "$src_root/host/$host_runtime_file" "$dest_root/host/$host_runtime_file"
            fi
        done
    elif [ -d "$src_root/host" ]; then
        cp -r "$src_root/host" "$dest_root/host"
    fi
    for d in locales scripts assets schemas; do
        if [ -d "$src_root/$d" ]; then
            cp -r "$src_root/$d" "$dest_root/$d"
        fi
    done

    # Mirror each ui/<name>/ subproject's runtime assets (dist + locales),
    # preserving the relative path so the manifest's main: "./ui/.../dist/..."
    # still resolves.
    if [ -d "$src_root/ui" ]; then
        for ui_subproject in "$src_root"/ui/*/; do
            [ -d "$ui_subproject" ] || continue
            local rel="${ui_subproject#$src_root/}"
            rel="${rel%/}"
            mkdir -p "$dest_root/$rel"
            if [ -d "$ui_subproject/dist" ]; then
                cp -r "$ui_subproject/dist" "$dest_root/$rel/dist"
            fi
            if [ -d "$ui_subproject/locales" ]; then
                cp -r "$ui_subproject/locales" "$dest_root/$rel/locales"
            fi
        done
    fi

    # Register in .installed.json so the bundled-path scanner would also accept
    # the plugin (defense in depth -- the user-dir copy is what actually loads,
    # but a future change to the scanner should not silently re-skip this).
    # .installed.json is consumed by two main-process modules:
    #   - PluginMarketService.loadInstalledPlugins() expects InstalledPlugin[]
    #     (apps/desktop/src/shared/types/marketplace.ts)
    #   - plugin-install-checker.isMarketplacePluginInstalled() reads
    #     InstalledPluginRecord[] (same shape)
    # Both want full objects, not bare strings. Writing a string array makes
    # PluginMarketService treat every entry as {id: undefined, path: undefined}
    # and then TICKET_444 stale-cleanup wipes the file -- which is exactly the
    # failure mode we hit on the first run of `./start.sh ql`.
    if [ ! -f "$installed_marker" ]; then
        echo "[]" > "$installed_marker"
    fi
    if command -v node &> /dev/null; then
        node -e "
          const fs = require('fs');
          const path = require('path');
          const markerPath = '$installed_marker';
          const pluginId = '$plugin_id';
          const pluginDir = '$dest_root';
          const manifestPath = path.join(pluginDir, 'manifest.json');
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const version = manifest.version || '0.0.0';
          let entries;
          try {
            entries = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
            if (!Array.isArray(entries)) entries = [];
          } catch {
            entries = [];
          }
          // Drop any prior entry for this id (handles legacy string-array
          // shape and stale objects pointing at old paths).
          entries = entries.filter(e => typeof e === 'object' && e !== null && e.id !== pluginId);
          entries.push({
            id: pluginId,
            version,
            installedAt: new Date().toISOString(),
            source: 'marketplace',
            path: pluginDir,
          });
          fs.writeFileSync(markerPath, JSON.stringify(entries, null, 2));
        "
        log_info "[ql] Registered $plugin_id in $installed_marker (object form)"
    else
        log_error "[ql] node not found; cannot safely write .installed.json"
        return 1
    fi

    log_info "[ql] Sync complete. Start the app with: ./start.sh"
}

# TICKET_1371 R4: content fingerprints for C++ build stages.
compute_executor_fingerprint() {
    local NONABT_DIR="$ROOT_DIR/../nonabackTrader"
    local EXECUTOR_DIR="$ROOT_DIR/packages/executor"
    local paths=()
    if [ -d "$NONABT_DIR" ]; then
        for d in runner/src include core generated; do
            [ -d "$NONABT_DIR/$d" ] && paths+=("$NONABT_DIR/$d")
        done
        [ -f "$NONABT_DIR/CMakeLists.txt" ] && paths+=("$NONABT_DIR/CMakeLists.txt")
    fi
    for d in src include tests; do
        [ -d "$EXECUTOR_DIR/$d" ] && paths+=("$EXECUTOR_DIR/$d")
    done
    [ -f "$EXECUTOR_DIR/CMakeLists.txt" ] && paths+=("$EXECUTOR_DIR/CMakeLists.txt")
    [ -f "$EXECUTOR_DIR/build.sh" ] && paths+=("$EXECUTOR_DIR/build.sh")
    [ -f "$EXECUTOR_DIR/vcpkg.json" ] && paths+=("$EXECUTOR_DIR/vcpkg.json")
    compute_fingerprint "${paths[@]}" \
        --env "$(cmake --version 2>/dev/null | head -1)" \
        --env "$(cc --version 2>/dev/null | head -1)" \
        --env "${BUILD_TYPE:-Release}"
}

compute_research_worker_fingerprint() {
    local RK_DIR="$ROOT_DIR/packages/research-kernels"
    [ -d "$RK_DIR" ] || { echo "none"; return 0; }
    local paths=("$RK_DIR/src" "$RK_DIR/include")
    [ -f "$RK_DIR/CMakeLists.txt" ] && paths+=("$RK_DIR/CMakeLists.txt")
    [ -f "$RK_DIR/build.sh" ] && paths+=("$RK_DIR/build.sh")
    [ -f "$RK_DIR/vcpkg.json" ] && paths+=("$RK_DIR/vcpkg.json")
    compute_fingerprint "${paths[@]}" \
        --env "$(cmake --version 2>/dev/null | head -1)" \
        --env "$(cc --version 2>/dev/null | head -1)" \
        --env "${BUILD_TYPE:-Release}"
}

executor_outputs_exist() {
    local NONABT_DIR="$ROOT_DIR/../nonabackTrader"
    if [ -f "$NONABT_DIR/CMakeLists.txt" ]; then
        [ -f "$NONABT_DIR/build-parquet/runner/stratforge-runner" ] || return 1
    fi
    [ -d "$ROOT_DIR/packages/executor/build" ] || return 1
}

research_worker_output_exists() {
    local RK_DIR="$ROOT_DIR/packages/research-kernels"
    [ -f "$RK_DIR/build/stratcraft-research-worker" ] || return 1
}

# Build stratforge-runner (TICKET_681 Phase 3: single binary executor)
# TICKET_133: V3 Architecture, TICKET_681: pybind11 removed
build_research_worker_if_present() {
    local RESEARCH_KERNELS_DIR="$ROOT_DIR/packages/research-kernels"
    if [ ! -x "$RESEARCH_KERNELS_DIR/build.sh" ]; then
        return 0
    fi

    log_info "Building commercial research worker..."
    "$RESEARCH_KERNELS_DIR/build.sh" || {
        log_error "Commercial research worker build failed"
        return 1
    }
    log_info "Commercial research worker build complete"
}

# TICKET_1304_17: the sole release build owner for the signed Quant Lab
# package. Release workflows select this command; they do not carry CMake,
# TypeScript, or bundler recipes of their own.
build_quant_lab_release_inputs() {
    local RESEARCH_KERNELS_DIR="$ROOT_DIR/packages/research-kernels"
    local HOST_DIR="$ROOT_DIR/plugins/quant-lab-nexus/host"
    local UI_DIR="$ROOT_DIR/plugins/quant-lab-nexus/ui/quant-lab-nexus"

    if [ ! -x "$RESEARCH_KERNELS_DIR/build.sh" ]; then
        log_error "Commercial research worker build owner is missing"
        return 1
    fi

    log_info "Building Quant Lab release contracts..."
    $PM --filter @StratCraft/types run build || return 1
    $PM --filter @StratCraft/roster-store run build || return 1
    $PM --filter @StratCraft/alpha-factory-store run build || return 1

    log_info "Building Quant Lab commercial host bundle..."
    (cd "$HOST_DIR" && $PM run build) || return 1

    log_info "Building Quant Lab UI bundle..."
    clean_plugin_src_artifacts "$UI_DIR"
    (cd "$UI_DIR" && $PM run build) || return 1

    build_research_worker_if_present || return 1
    log_info "Quant Lab release inputs complete"
}

get_node_platform_id() {
    local platform arch
    case "$(uname -s)" in
        Linux*)             platform="linux" ;;
        Darwin*)            platform="darwin" ;;
        MINGW*|MSYS*|CYGWIN*) platform="win32" ;;
        *)
            log_error "Unsupported platform: $(uname -s)"
            return 1
            ;;
    esac
    case "$(uname -m)" in
        arm64|aarch64) arch="arm64" ;;
        x86_64|amd64)  arch="x64" ;;
        *)
            log_error "Unsupported architecture: $(uname -m)"
            return 1
            ;;
    esac
    printf '%s-%s\n' "$platform" "$arch"
}

find_electron_binary() {
    local candidate
    for candidate in \
      "$ROOT_DIR/apps/desktop/node_modules/.bin/electron" \
      "$ROOT_DIR/node_modules/.bin/electron"
    do
        if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    log_error "Electron binary not found. Run './start.sh install' first."
    return 1
}

run_lifecycle_script() {
    local script_path="$1"
    shift
    local electron_bin
    electron_bin="$(find_electron_binary)" || return 1
    ELECTRON_RUN_AS_NODE=1 \
    TS_NODE_TRANSPILE_ONLY=true \
    TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","target":"ES2022","esModuleInterop":true,"skipLibCheck":true,"isolatedModules":false}' \
    TS_NODE_PROJECT="$ROOT_DIR/apps/desktop/tsconfig.main.json" \
    STRATCRAFT_APP_PATH="$ROOT_DIR/apps/desktop" \
    STRATCRAFT_HEADLESS_LOG_LEVEL=error \
      "$electron_bin" -r ts-node/register "$script_path" "$@"
}

quant_lab_dev_install() {
    local PLUGIN_ROOT="$ROOT_DIR/plugins/quant-lab-nexus"
    local SCRIPTS_DIR="$PLUGIN_ROOT/scripts"
    local HOST_DIR="$PLUGIN_ROOT/host"
    local RESEARCH_KERNELS_DIR="$ROOT_DIR/packages/research-kernels"

    log_info "=== Quant Lab development package install ==="

    # Step 1: Build public contracts
    log_info "[1/8] Building public contracts..."
    $PM --filter @StratCraft/types run build || { log_error "types build failed"; return 1; }
    $PM --filter @StratCraft/roster-store run build || { log_error "roster-store build failed"; return 1; }
    $PM --filter @StratCraft/alpha-factory-store run build || { log_error "alpha-factory-store build failed"; return 1; }

    # Step 2: Build commercial host bundle
    log_info "[2/8] Building commercial host bundle..."
    (cd "$HOST_DIR" && $PM run build) || { log_error "Host bundle build failed"; return 1; }

    # Step 3: Build Quant Lab UI bundle
    log_info "[3/8] Building Quant Lab UI bundle..."
    local UI_DIR="$PLUGIN_ROOT/ui/quant-lab-nexus"
    clean_plugin_src_artifacts "$UI_DIR"
    (cd "$UI_DIR" && $PM install --silent && $PM run build) || { log_error "UI bundle build failed"; return 1; }

    # Step 4: Build commercial research worker
    log_info "[4/8] Building commercial research worker..."
    build_research_worker_if_present || { log_error "Research worker build failed"; return 1; }

    # Step 5: Ensure dev signing identity
    log_info "[5/8] Ensuring development signing identity..."
    local identity_json
    identity_json=$(node "$SCRIPTS_DIR/ensure-dev-signing-identity.mjs") || { log_error "Dev signing identity failed"; return 1; }
    local signing_key trust_store key_id
    signing_key=$(echo "$identity_json" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).privateKeyPath)")
    trust_store=$(echo "$identity_json" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).trustStorePath)")
    key_id=$(echo "$identity_json" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).keyId)")

    # Step 6: Assemble immutable package with dev identity
    log_info "[6/8] Assembling signed package..."
    local node_platform
    node_platform="$(get_node_platform_id)" || return 1
    local version
    version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLUGIN_ROOT/manifest.json','utf-8')).version)")

    local worker_bin="$RESEARCH_KERNELS_DIR/build/stratcraft-research-worker"
    if [ "$node_platform" = "win32-x64" ] || [ "$node_platform" = "win32-arm64" ]; then
        worker_bin="$RESEARCH_KERNELS_DIR/build/stratcraft-research-worker.exe"
    fi
    if [ ! -f "$worker_bin" ]; then
        log_error "Research worker binary not found: $worker_bin"
        log_error "Ensure packages/research-kernels builds successfully."
        return 1
    fi

    local staging_dir="$PLUGIN_ROOT/out/dev-staging"
    rm -rf "$staging_dir"
    mkdir -p "$staging_dir"

    local native_runtime_dir="$staging_dir/native-runtime"
    mkdir -p "$native_runtime_dir/lib" "$native_runtime_dir/licenses" "$native_runtime_dir/bin"
    local xsimd_license="$RESEARCH_KERNELS_DIR/build/_deps/xsimd-src/LICENSE"
    if [ -f "$xsimd_license" ]; then
        cp "$xsimd_license" "$native_runtime_dir/licenses/XSIMD-LICENSE"
    else
        echo "BSD-3-Clause" > "$native_runtime_dir/licenses/XSIMD-LICENSE"
    fi
    echo "statically-linked" > "$native_runtime_dir/lib/placeholder.txt"

    local package_output="$staging_dir/research-worker-package"
    node "$SCRIPTS_DIR/assemble-research-worker-package.mjs" \
        --output "$package_output" \
        --worker "$worker_bin" \
        --native-runtime-dir "$native_runtime_dir" \
        --host-module "$HOST_DIR/register.cjs" \
        --platform "$node_platform" \
        --version "$version" \
        --key-id "$key_id" \
        --signing-key "$signing_key" \
    || { log_error "Package assembly failed"; return 1; }

    # Step 7: Lifecycle install through the production code path
    log_info "[7/8] Installing through ResearchWorkerPackageLifecycle..."
    local install_result
    install_result=$(run_lifecycle_script \
        "$SCRIPTS_DIR/lifecycle-install-dev-package.cjs" \
        --package-root "$package_output" \
        --trust-store "$trust_store" \
        --skip-health \
        2>/dev/null \
    ) || { log_error "Lifecycle install failed"; return 1; }

    # Step 8: Report
    log_info "[8/8] Verifying installed package..."
    local status_result
    status_result=$(run_lifecycle_script \
        "$SCRIPTS_DIR/lifecycle-dev-package-status.cjs" \
        --trust-store "$trust_store" \
        2>/dev/null \
    ) || { log_warn "Post-install status check failed (non-fatal)"; status_result='{"state":"unknown"}'; }

    rm -rf "$staging_dir"

    echo ""
    log_info "=== Quant Lab development package installed ==="
    local manifest_sha256
    manifest_sha256=$(echo "$install_result" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).manifestSha256)")
    local install_root
    install_root=$(echo "$install_result" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).installationRoot)")
    local state
    state=$(echo "$status_result" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).state)")
    echo "    Version:          $version"
    echo "    Platform:         $node_platform"
    echo "    Key ID:           $key_id"
    echo "    Manifest SHA-256: $manifest_sha256"
    echo "    Install root:     $install_root"
    echo "    Verified state:   $state"
    echo "    Host roles:       electron, service-api"
    echo ""
    log_warn "Restart Electron and/or the Service API for the new package to activate."
    echo ""
}

quant_lab_dev_status() {
    local SCRIPTS_DIR="$ROOT_DIR/plugins/quant-lab-nexus/scripts"

    log_info "Checking development signing identity..."
    local identity_json
    identity_json=$(node "$SCRIPTS_DIR/ensure-dev-signing-identity.mjs" 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$identity_json" ]; then
        log_error "No development signing identity found."
        log_error "Run './start.sh quant-lab-dev-install' first."
        return 1
    fi
    local trust_store
    trust_store=$(echo "$identity_json" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).trustStorePath)")
    local key_id
    key_id=$(echo "$identity_json" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).keyId)")

    log_info "Querying package verifier..."
    local status_result
    status_result=$(run_lifecycle_script \
        "$SCRIPTS_DIR/lifecycle-dev-package-status.cjs" \
        --trust-store "$trust_store" \
        2>/dev/null \
    ) || { log_error "Status query failed"; return 1; }

    echo ""
    log_info "=== Quant Lab development package status ==="
    local state pkg_version manifest_sha256
    state=$(echo "$status_result" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(r.state)")
    pkg_version=$(echo "$status_result" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(r.packageVersion||'(none)')")
    manifest_sha256=$(echo "$status_result" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(r.packageManifestSha256||'(none)')")
    echo "    State:            $state"
    echo "    Version:          $pkg_version"
    echo "    Manifest SHA-256: $manifest_sha256"
    echo "    Key ID:           $key_id"
    echo "    Trust store:      $trust_store"
    if [ "$state" = "error" ]; then
        local error_msg remediation
        error_msg=$(echo "$status_result" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(r.message||'')")
        remediation=$(echo "$status_result" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(r.remediation||'')")
        [ -n "$error_msg" ] && echo "    Error:            $error_msg"
        [ -n "$remediation" ] && echo "    Remediation:      $remediation"
    fi
    echo ""
}

quant_lab_dev_uninstall() {
    local SCRIPTS_DIR="$ROOT_DIR/plugins/quant-lab-nexus/scripts"

    log_info "Checking development signing identity..."
    local identity_json
    identity_json=$(node "$SCRIPTS_DIR/ensure-dev-signing-identity.mjs" 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$identity_json" ]; then
        log_error "No development signing identity found."
        return 1
    fi
    local trust_store
    trust_store=$(echo "$identity_json" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).trustStorePath)")

    log_info "Uninstalling development package through lifecycle..."
    run_lifecycle_script \
        "$SCRIPTS_DIR/lifecycle-dev-package-uninstall.cjs" \
        --trust-store "$trust_store" \
        >/dev/null 2>&1 \
    || { log_error "Lifecycle uninstall failed"; return 1; }

    echo ""
    log_info "=== Quant Lab development package uninstalled ==="
    log_warn "Restart Electron and/or the Service API for the change to take effect."
    echo ""
}

build_executor() {
    local NONABT_DIR="$ROOT_DIR/../nonabackTrader"
    local EXECUTOR_DIR="$ROOT_DIR/packages/executor"

    if [ ! -f "$NONABT_DIR/CMakeLists.txt" ]; then
        log_info "Adjacent nonabackTrader checkout is absent; using the pinned public StratForge source."
        (cd "$EXECUTOR_DIR" && ./build.sh --package) || {
            log_error "Packaged executor build failed"
            return 1
        }
        build_research_worker_if_present || return 1
        return 0
    fi

    log_info "Building stratforge-runner (C++ strategy executor)..."

    local BUILD_DIR="$NONABT_DIR/build-parquet"
    mkdir -p "$BUILD_DIR"

    # Build stratforge-runner with Parquet support
    if [ -f "$EXECUTOR_DIR/build.sh" ]; then
        (cd "$EXECUTOR_DIR" && ./build.sh) || {
            log_error "Executor build failed"
            return 1
        }
    else
        # Direct cmake build of stratforge-runner
        (cd "$BUILD_DIR" && cmake "$NONABT_DIR" \
            -DCMAKE_BUILD_TYPE=Release \
            -DSF_BUILD_RUNNER=ON \
            -DSF_ENABLE_PARQUET=ON \
            && cmake --build . --parallel $(nproc)) || {
            log_error "stratforge-runner build failed"
            return 1
        }
    fi

    log_info "stratforge-runner build complete"
    log_info "Binary: $BUILD_DIR/runner/stratforge-runner"

    build_research_worker_if_present
}

get_build_platform_id() {
    local platform arch
    case "$(uname -s)" in
        Linux*) platform="linux" ;;
        Darwin*) platform="macos" ;;
        MINGW*|MSYS*|CYGWIN*) platform="windows" ;;
        *)
            log_error "Unsupported build platform: $(uname -s)"
            return 1
            ;;
    esac
    case "$(uname -m)" in
        arm64|aarch64) arch="arm64" ;;
        x86_64|amd64) arch="x64" ;;
        *)
            log_error "Unsupported build architecture: $(uname -m)"
            return 1
            ;;
    esac
    printf '%s-%s\n' "$platform" "$arch"
}

# TICKET_1228: Incremental runner build for dev mode. `./start.sh` previously
# never compiled the runner at all, so C++ changes (e.g. TICKET_1225 P5)
# silently launched the app against a stale build-parquet binary. Only
# triggers the (cmake-incremental) build when C++ source is newer than the
# binary, so an unchanged tree adds seconds, not minutes.
build_executor_incremental() {
    local NONABT_DIR="$ROOT_DIR/../nonabackTrader"
    local RUNNER_BIN="$NONABT_DIR/build-parquet/runner/stratforge-runner"

    if [ ! -f "$RUNNER_BIN" ]; then
        log_info "stratforge-runner: binary not found, building..."
        build_executor
        return $?
    fi

    local src_newer
    src_newer=$(find "$NONABT_DIR/runner/src" "$NONABT_DIR/runner/CMakeLists.txt" \
        "$NONABT_DIR/include" "$NONABT_DIR/core" "$NONABT_DIR/generated" \
        "$ROOT_DIR/packages/executor/include" "$ROOT_DIR/packages/executor/src" \
        "$ROOT_DIR/packages/executor/tests" "$ROOT_DIR/packages/executor/CMakeLists.txt" \
        \( -name '*.cpp' -o -name '*.hpp' -o -name '*.h' -o -name 'CMakeLists.txt' \) \
        -newer "$RUNNER_BIN" 2>/dev/null | head -1)
    if [ -n "$src_newer" ]; then
        log_info "stratforge-runner: C++ source changed ($src_newer), rebuilding..."
        build_executor
        return $?
    fi
    log_info "stratforge-runner: up-to-date"
}

# TICKET_751_3: build_alpha_factory() removed -- alpha-factory package
# deleted (pybind11 cleanup); see TICKET_751_3 P2/P3.
#
# TICKET_736 (dev-plugins.json mechanism from alignmap) intentionally NOT
# brought to main: main's `ql` subcommand (TICKET_d8119952, see start.sh
# ql below) is the equivalent mechanism for syncing quant-lab-nexus into
# the user plugin dir. Bringing both would create two competing local-
# plugin install paths.

# TICKET_1304_11: commercial workspace packages extend the MCP build through
# generic lifecycle phases that disappear with the package itself. Base owns
# the phase contract; extension packages own every implementation detail.
run_mcp_extension_phase() {
    local phase="$1"

    $PM --recursive --if-present run "$phase" || {
        log_error "MCP workspace extension phase failed: $phase"
        return 1
    }
}

# Build MCP Server (TICKET_153: all compilation steps in start.sh)
build_mcp_server() {
    local MCP_DIR="$ROOT_DIR/apps/desktop/src/mcp/standalone"

    if [ ! -f "$MCP_DIR/package.json" ]; then
        log_warn "MCP Server directory not found, skipping"
        return 0
    fi

    run_mcp_extension_phase "qnx:mcp:prepare" || return 1

    # TICKET_1304_11: Desktop's workspace dependency graph is the authoritative
    # set shared by Electron Main and the standalone MCP. The dependency-only
    # selector preserves topological order and automatically follows the
    # public candidate's stripped manifest instead of maintaining a second
    # hand-authored build list in this script.
    # TICKET_1371 R3: route through Turbo for content-hash caching.
    # Unchanged packages show cache hits; only modified packages rebuild.
    $PM exec turbo run build --filter='@StratCraft/desktop^...' || {
        log_error "MCP shared workspace dependency build failed"
        return 1
    }

    # TICKET_1371: content-hash fingerprint replaces the timestamp-based
    # freshness check. Covers MCP source + workspace package sources so a
    # shared-contract change correctly invalidates the MCP build.
    local DIST_FILE="$MCP_DIR/dist/mcp-server.js"
    local mcp_fp mcp_start mcp_cache
    mcp_fp=$(compute_fingerprint \
        "$MCP_DIR/src" "$MCP_DIR/scripts" "$MCP_DIR/package.json" \
        "$ROOT_DIR/packages" \
        --env "$(node --version 2>/dev/null)")
    mcp_start=$(date +%s%N)
    if stage_is_current "mcp-standalone" "$mcp_fp" && [ -f "$DIST_FILE" ]; then
        log_info "MCP Server dist is up-to-date [fp:${mcp_fp:0:8}] (skipping)"
        build_report_stage "mcp-standalone" "$(( $(date +%s%N) - mcp_start ))" "hit" "$mcp_fp"
        return 0
    fi

    log_info "Building MCP Server..."
    # TICKET_1317: an MCP build failure is never "non-critical" -- the MCP owns
    # :7789 and the Guide WebUI only starts Vite (:7790) once MCP is listening.
    # Swallowing this as success ships a dist that crash-loops at runtime while
    # the build reports OK (TICKET_858: no silent failures).
    (cd "$MCP_DIR" && $PM run build) || {
        invalidate_fingerprint "mcp-standalone"
        log_error "MCP Server build failed"
        return 1
    }
    run_mcp_extension_phase "qnx:mcp:finalize" || return 1
    save_fingerprint "mcp-standalone" "$mcp_fp"
    build_report_stage "mcp-standalone" "$(( $(date +%s%N) - mcp_start ))" "miss" "$mcp_fp"
    log_info "MCP Server build complete"
}

build_web_dashboard() {
    build_mcp_server || {
        log_error "Web Dashboard MCP build failed"
        return 1
    }
    $PM --filter @stratcraft/web-dashboard run build || {
        log_error "Web Dashboard build failed"
        return 1
    }
}

# Start development mode
start_dev() {
    check_running_processes "dev"
    turbo_preflight
    log_info "Starting StratCraft (dev mode)..."

    # Check dependencies
    if [ ! -d "node_modules" ]; then
        log_warn "node_modules not found, installing dependencies..."
        install_deps
    fi

    # TICKET_821_1 S2: refresh Python schema manifest for drift test
    dump_param_schema_manifest

    # Build MCP Server and its shared runtime packages (if MCP source changed)
    build_mcp_server

    # Build plugins (incremental: only if source newer than dist)
    build_plugins_incremental

    # TICKET_1228: Build stratforge-runner if C++ source changed. Dev mode
    # previously skipped the runner entirely (TICKET_153 gap).
    build_executor_incremental || {
        log_error "stratforge-runner build failed. Fix the C++ error and retry."
        exit 1
    }

    # Verify plugin init scripts
    log_info "Verifying plugin init scripts..."
    if [ -f "$ROOT_DIR/scripts/verify-plugin-init.sh" ]; then
        "$ROOT_DIR/scripts/verify-plugin-init.sh" || {
            log_error "Plugin verification failed. Please fix the issues above and retry."
            exit 1
        }
    else
        log_warn "Verification script not found, skipping plugin verification"
    fi

    # Clean plugin data (dev mode: trigger onInstall each run)
    # Set KEEP_PLUGIN_DATA=1 to skip cleaning
    if [ "${KEEP_PLUGIN_DATA:-0}" = "0" ]; then
        local PLUGIN_DATA_DIR="$HOME/.config/@StratCraft/desktop/plugin-data"
        if [ -d "$PLUGIN_DATA_DIR" ]; then
            log_info "Cleaning plugin data directory (triggering onInstall flow)..."
            log_info "Path: $PLUGIN_DATA_DIR"
            rm -rf "$PLUGIN_DATA_DIR"
            log_info "Hint: use KEEP_PLUGIN_DATA=1 ./start.sh to keep data"
        fi
    else
        log_info "Keeping plugin data (skipping onInstall flow)"
    fi

    # TICKET_587: Auto-detect DISPLAY and DBUS for headless/SSH environments
    if [ -z "$DISPLAY" ]; then
        # Strategy 1: Find Xorg/Xwayland process display argument (most reliable)
        XORG_DISPLAY=$(ps aux 2>/dev/null | grep -oP '(?<=Xorg |Xwayland ):[0-9]+' | head -1)
        if [ -n "$XORG_DISPLAY" ]; then
            export DISPLAY="$XORG_DISPLAY"
            log_info "Auto-detected DISPLAY=$DISPLAY (Xorg process)"
        fi

        # Strategy 2: Use loginctl to find active graphical session
        if [ -z "$DISPLAY" ] && command -v loginctl &>/dev/null; then
            GRAPHICAL_DISPLAY=$(loginctl show-session $(loginctl list-sessions --no-legend 2>/dev/null | awk 'NR==1{print $1}') -p Display --value 2>/dev/null)
            if [ -n "$GRAPHICAL_DISPLAY" ]; then
                export DISPLAY="$GRAPHICAL_DISPLAY"
                log_info "Auto-detected DISPLAY=$DISPLAY (loginctl)"
            fi
        fi

        # Strategy 3: Find X11 display socket (validate with xdpyinfo before accepting)
        if [ -z "$DISPLAY" ]; then
            for xsock in $(ls /tmp/.X11-unix/ 2>/dev/null | sort -V); do
                CANDIDATE_DISPLAY=":$(echo "$xsock" | sed 's/X//')"
                if command -v xdpyinfo &>/dev/null && xdpyinfo -display "$CANDIDATE_DISPLAY" &>/dev/null; then
                    export DISPLAY="$CANDIDATE_DISPLAY"
                    log_info "Auto-detected DISPLAY=$DISPLAY (X11 socket, validated)"
                    break
                fi
            done
            # Fallback: use first socket without validation if xdpyinfo unavailable
            if [ -z "$DISPLAY" ] && ! command -v xdpyinfo &>/dev/null; then
                USER_DISPLAY=$(ls /tmp/.X11-unix/ 2>/dev/null | head -1 | sed 's/X/:/')
                if [ -n "$USER_DISPLAY" ]; then
                    export DISPLAY="$USER_DISPLAY"
                    log_info "Auto-detected DISPLAY=$DISPLAY (X11 socket, unvalidated)"
                fi
            fi
        fi

        if [ -z "$DISPLAY" ]; then
            log_warn "No DISPLAY detected. OS keychain (gnome-keyring) may be unavailable."
            log_warn "OAuth tokens will not persist across restarts. Set DISPLAY=:0 if a display server is running."
        fi
    fi

    # TICKET_1314: all launch modes use the same non-mutating current-user
    # D-Bus/Secret Service preflight. It never starts a substitute keyring.
    # shellcheck source=scripts/secure-store-keyring-preflight.sh
    source "$ROOT_DIR/scripts/secure-store-keyring-preflight.sh"
    secure_store_keyring_preflight

    # Start the Electron development session with process-group cleanup on exit.
    # TICKET_1297: the root dev script excludes @stratcraft/web-dashboard, so
    # this process group never owns MCP :7789 or Guide Vite :7790.
    # TICKET_1297_1: mint and record this session's ownership token so a later
    # `./start.sh build` can identify what it is authorized to stop -- the
    # token is exported, so only processes this session started carry it. The
    # claim is released on exit so a finished session never authorizes a
    # future kill.
    claim_electron_dev_ownership

    # Reset trap first to prevent recursive re-entry (kill -TERM -$$ delivers SIGTERM back to this shell)
    trap 'trap - INT TERM EXIT; log_info "Shutting down..."; release_electron_dev_ownership; kill -TERM -$$ 2>/dev/null; wait 2>/dev/null' INT TERM EXIT

    # TICKET_958_5 follow-up: STRATCRAFT_RESEARCH_MODE=1 unlocks the
    # Databento local-parquet research provider + databento_us50_1m
    # universe in the dev UI. Off by default to mirror packaged-release
    # behaviour; opt in with `STRATCRAFT_RESEARCH_MODE=1 ./start.sh`.
    if [ "${STRATCRAFT_RESEARCH_MODE:-0}" = "1" ]; then
        log_info "STRATCRAFT_RESEARCH_MODE=1 -- Databento research provider enabled"
        STRATCRAFT_RESEARCH_MODE=1 $PM run dev
    else
        $PM run dev
    fi
    trap - INT TERM EXIT
    release_electron_dev_ownership
}

compute_electron_rebuild_fingerprint() {
    local electron_ver node_abi lock_hash platform_arch
    electron_ver=$(node -e "console.log(require('$ROOT_DIR/apps/desktop/node_modules/electron/package.json').version)" 2>/dev/null || echo "unknown")
    node_abi=$(node -e "console.log(process.versions.modules)" 2>/dev/null || echo "unknown")
    lock_hash=$(sha256sum "$ROOT_DIR/pnpm-lock.yaml" 2>/dev/null | awk '{print $1}')
    platform_arch="$(uname -s)-$(uname -m)"
    printf '%s\n%s\n%s\n%s' "$electron_ver" "$node_abi" "$lock_hash" "$platform_arch" \
        | sha256sum | awk '{print $1}'
}

prepare_desktop_native_modules() {
    # TICKET_1371 R6: skip electron-rebuild when all inputs are unchanged.
    local rebuild_fp rebuild_start rebuild_cache
    rebuild_fp=$(compute_electron_rebuild_fingerprint)
    rebuild_start=$(date +%s%N)
    local sentinel="$ROOT_DIR/apps/desktop/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
    if stage_is_current "electron-rebuild" "$rebuild_fp" && [ -f "$sentinel" ]; then
        log_info "Desktop native modules: up-to-date [fp:${rebuild_fp:0:8}] (skipping)"
        build_report_stage "electron-rebuild" "$(( $(date +%s%N) - rebuild_start ))" "hit" "$rebuild_fp"
        return 0
    fi
    log_info "Rebuilding Desktop native modules for Electron..."
    (cd "$ROOT_DIR/apps/desktop" && $PM exec electron-rebuild -m .) || {
        invalidate_fingerprint "electron-rebuild"
        log_error "Desktop native module rebuild failed"
        return 1
    }
    save_fingerprint "electron-rebuild" "$rebuild_fp"
    build_report_stage "electron-rebuild" "$(( $(date +%s%N) - rebuild_start ))" "miss" "$rebuild_fp"
}

# Production build
build_prod() {
    if [ "${CI:-false}" != "true" ]; then
        check_running_processes "build"
    fi
    log_info "Building production version..."
    build_report_init

    # TICKET_1371: CLEAN_BUILD=1 forces a full rebuild by wiping all caches.
    # CI/release workflows should set this. Incremental builds skip unchanged
    # stages via content-addressed fingerprints.
    if [ "${CLEAN_BUILD:-0}" = "1" ]; then
        log_info "CLEAN_BUILD=1 -- wiping all build caches for reproducible build"
        clean_build_cache
        rm -rf "$ROOT_DIR/.turbo"
    fi

    # 0. Clean Desktop dist directory only on clean builds or when it exists
    # and a clean build was requested. Incremental builds preserve dist so
    # Turbo's content-hash cache can reuse it.
    if [ "${CLEAN_BUILD:-0}" = "1" ] && [ -d "$ROOT_DIR/apps/desktop/dist" ]; then
        log_info "Cleaning Desktop dist directory..."
        rm -rf "$ROOT_DIR/apps/desktop/dist" 2>/dev/null || \
        sudo rm -rf "$ROOT_DIR/apps/desktop/dist" 2>/dev/null || \
        log_warn "Cannot clean dist directory, continuing build..."
        log_info "dist directory cleaned"
    fi

    # TICKET_821_1 S2: refresh Python schema manifest for drift test
    dump_param_schema_manifest

    # 1. Build V3 Executor (primary)
    # TICKET_1228: fail fast on every step. A swallowed failure here ships a
    # mixed-version app (fresh TS layers over a stale runner binary) -- the
    # exact incident behind the TICKET_1225 feed-count-mismatch exit 11.
    # TICKET_1371 R4: fingerprinted skip for unchanged C++ sources.
    local executor_fp executor_start executor_cache
    executor_fp=$(compute_executor_fingerprint)
    executor_start=$(date +%s%N)
    if stage_is_current "executor" "$executor_fp" && executor_outputs_exist; then
        log_info "Executor: up-to-date [fp:${executor_fp:0:8}] (skipping)"
        executor_cache="hit"
    else
        build_executor || { invalidate_fingerprint "executor"; log_error "Executor build failed"; return 1; }
        save_fingerprint "executor" "$executor_fp"
        executor_cache="miss"
    fi
    build_report_stage "executor" "$(( $(date +%s%N) - executor_start ))" "$executor_cache" "$executor_fp"

    # 2. Build MCP Server (fingerprinted internally)
    local mcp_outer_start
    mcp_outer_start=$(date +%s%N)
    build_mcp_server || { log_error "MCP Server build failed"; return 1; }

    # 6. Build TypeScript plugins (fingerprinted per-plugin)
    local plugins_start
    plugins_start=$(date +%s%N)
    build_plugins || { log_error "Plugin build failed"; return 1; }
    build_report_stage "plugins-total" "$(( $(date +%s%N) - plugins_start ))" "-" ""

    # Marketplace installation is a developer-state mutation, not a clean
    # build input. CI builds the plugin sources above and leaves user state
    # untouched.
    if [ "${CI:-false}" != "true" ]; then
        log_info "Syncing marketplace plugins..."
        sync_marketplace_plugin_dev "com.stratcraft.quant-lab-nexus" "quant-lab-nexus" || { log_error "quant-lab-nexus sync failed"; return 1; }
        sync_marketplace_plugin_dev "com.stratcraft.signal-generator-nexus" "signal-generator-nexus" || { log_error "signal-generator-nexus sync failed"; return 1; }
    fi

    # 7. Build remaining workspace packages (types and the shared LSTM report
    # reader were built before MCP in build_mcp_server).
    log_info "Building workspace packages..."
    # TICKET_1371 R3: Turbo-cached workspace builds.
    $PM exec turbo run build --filter=@StratCraft/sdk-core --filter=@StratCraft/plugin-verifier || {
        log_error "Workspace package build failed"; return 1
    }

    # 8. Prepare native dependencies for the Electron ABI before any built
    # Desktop runtime can be launched. Node-hosted tests use the independent
    # standalone MCP binding and do not mutate this Electron-owned binary.
    prepare_desktop_native_modules || return 1

    # 9. Build Electron app (main + preload + renderer)
    log_info "Building Electron app..."
    local desktop_start
    desktop_start=$(date +%s%N)
    # TICKET_1371 R3: Turbo-cached desktop build.
    $PM exec turbo run build --filter=@StratCraft/desktop || { log_error "Desktop build failed"; return 1; }
    build_report_stage "desktop" "$(( $(date +%s%N) - desktop_start ))" "turbo" ""

    # 10. Verify plugin init scripts
    log_info "Verifying plugin init scripts..."
    if [ -f "$ROOT_DIR/scripts/verify-plugin-init.sh" ]; then
        "$ROOT_DIR/scripts/verify-plugin-init.sh" || {
            log_error "Plugin verification failed. Build complete but plugins may not work correctly."
            log_error "Please fix the issues above before packaging or deploying."
            exit 1
        }
    else
        log_warn "Verification script not found, skipping plugin verification"
    fi

    # TICKET_1297: local builds may hand startup to the independent service
    # owner. A clean CI build never starts or mutates a live workload.
    if [ "${CI:-false}" != "true" ]; then
        log_info "Ensuring Guide WebUI background service is running..."
        bash "$ROOT_DIR/apps/web-dashboard/start-dev-bg.sh" start || {
            log_error "Guide WebUI background service failed to start"
            return 1
        }
    fi

    build_report_write
    log_info "Production build complete!"
}

package_current_platform() {
    local target="${1:-}"
    local platform_id executor_name
    platform_id="$(get_build_platform_id)" || return 1

    case "$target" in
        linux)
            [ "${platform_id%%-*}" = "linux" ] || {
                log_error "Linux package requested on $platform_id"
                return 1
            }
            ;;
        mac)
            [ "${platform_id%%-*}" = "macos" ] || {
                log_error "macOS package requested on $platform_id"
                return 1
            }
            ;;
        win)
            [ "${platform_id%%-*}" = "windows" ] || {
                log_error "Windows package requested on $platform_id"
                return 1
            }
            ;;
        *)
            log_error "Unknown package target: $target (expected linux, mac, or win)"
            return 1
            ;;
    esac

    executor_name="StratCraft-executor"
    if [ "$target" = "win" ]; then
        executor_name="${executor_name}.exe"
    fi
    if [ ! -f "$ROOT_DIR/packages/executor/build/$executor_name" ]; then
        log_error "Package input is missing: packages/executor/build/$executor_name"
        return 1
    fi
    prepare_desktop_native_modules || return 1
    log_info "Packaging StratCraft for $platform_id..."
    CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}" \
        $PM --filter @StratCraft/desktop run "package:$target" || return 1
    node "$ROOT_DIR/apps/desktop/scripts/verify-packaged-agent-runtime.mjs" \
        "$ROOT_DIR/apps/desktop/release" || {
        log_error "Packaged Agent runtime verification failed"
        return 1
    }
}

verify_ci_build() {
    local executor_build="$ROOT_DIR/packages/executor/build"
    [ -d "$executor_build" ] || {
        log_error "Executor build directory is missing; run start.sh build first"
        return 1
    }
    log_info "Running C++ executor tests..."
    (cd "$executor_build" && ctest --output-on-failure) || return 1
    log_info "Running TypeScript type checking..."
    $PM typecheck || return 1
    $PM --filter @StratCraft/desktop run typecheck || return 1
    log_info "Running TypeScript tests..."
    $PM test || return 1
}

smoke_packaged_runtime() {
    local evidence_path="${2:-$ROOT_DIR/artifacts/evidence/runtime-smoke.json}"
    node "$ROOT_DIR/apps/desktop/scripts/generated-public-runtime-smoke.mjs" \
        "$ROOT_DIR/apps/desktop/release" \
        "$evidence_path"
}

run_generated_public_e2e() {
    local acceptance_status=0
    local evidence_status=0
    local evidence_dir=""
    local desktop_log_dir="$ROOT_DIR/apps/desktop/logs"

    case "${1:-}" in
        ac6)
            STRATCRAFT_P8_REAL_E2E=1 \
                $PM --filter @StratCraft/desktop test:e2e:p8:ac6 \
                || acceptance_status=$?
            ;;
        *)
            log_error "Unknown generated-public E2E criterion: ${1:-} (expected ac6)"
            return 1
            ;;
    esac

    if [ -n "${STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH:-}" ]; then
        evidence_dir="$(dirname "$STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH")"
        mkdir -p "$evidence_dir"
        for log_name in main error; do
            if [ -f "$desktop_log_dir/$log_name.log" ]; then
                cp "$desktop_log_dir/$log_name.log" \
                    "$evidence_dir/electron-$log_name.log" || evidence_status=$?
            elif [ "$log_name" = "error" ]; then
                if [ "$acceptance_status" -eq 0 ]; then
                    # An empty error log is positive evidence that electron-log
                    # emitted no error-level entries during a successful startup.
                    : > "$evidence_dir/electron-error.log" || evidence_status=$?
                else
                    printf '%s\n' \
                        'Electron error log was not created before the acceptance failure.' \
                        > "$evidence_dir/electron-error.log" || evidence_status=$?
                fi
            else
                log_error "Electron $log_name log is missing after generated-public E2E"
                evidence_status=1
            fi
        done
    fi

    if [ "$acceptance_status" -ne 0 ]; then
        return "$acceptance_status"
    fi
    return "$evidence_status"
}

# Main entry point
case "${1:-dev}" in
    install|i)
        install_deps
        ;;
    plugin|plugins|p)
        build_plugins
        ;;
    ql|quant-lab)
        # Presentation-only: syncs the UI plugin into the user plugin dir.
        # This does NOT create a signed, lifecycle-installed package.
        # Use quant-lab-dev-install for a complete development installation
        # that exercises the production assembler, signer, and lifecycle.
        sync_marketplace_plugin_dev "com.stratcraft.quant-lab-nexus" "quant-lab-nexus"
        log_warn "UI-only sync complete. Commercial operations require: ./start.sh quant-lab-dev-install"
        ;;
    quant-lab-dev-install)
        quant_lab_dev_install
        ;;
    quant-lab-dev-status)
        quant_lab_dev_status
        ;;
    quant-lab-dev-uninstall)
        quant_lab_dev_uninstall
        ;;
    cc|ccxt|signal-gen)
        # Build + sync signal-generator-nexus into the user plugin dir.
        # Build + sync signal-generator-nexus into the user plugin dir.
        sync_marketplace_plugin_dev "com.stratcraft.signal-generator-nexus" "signal-generator-nexus"
        ;;
    executor|exec|e)
        build_executor
        ;;
    quant-lab-release-build)
        build_quant_lab_release_inputs
        ;;
    mcp)
        build_mcp_server
        ;;
    webdash-build)
        build_web_dashboard
        ;;
    webdash)
        # TICKET_1289_1 F3: build + run the standalone web dashboard (MCP server
        # serving the built SPA on :7789, no Electron, no Vite, no Docker).
        # TICKET_153 build-consistency: this verb ONLY delegates to the
        # cross-platform npm scripts -- no second build recipe lives here.
        # `webdash` (default) builds then starts; `webdash build` builds only.
        case "${2:-run}" in
            build)
                build_web_dashboard
                ;;
            *)
                build_web_dashboard && (cd "$ROOT_DIR" && $PM run webdash:start)
                ;;
        esac
        ;;
    bench|benchmark)
        # TICKET_471_4: Run Executor benchmarks
        log_info "Running Executor benchmarks..."
        EXECUTOR_BUILD="$ROOT_DIR/packages/executor/build"
        if [ -x "$EXECUTOR_BUILD/bin/benchmark/qnx-executor-bench" ]; then
            "$EXECUTOR_BUILD/bin/benchmark/qnx-executor-bench" "${2:-10000}"
        else
            log_warn "Benchmark binary not found. Building Executor first..."
            EXECUTOR_BUILD_BENCHMARKS=ON build_executor
            if [ -x "$EXECUTOR_BUILD/bin/benchmark/qnx-executor-bench" ]; then
                "$EXECUTOR_BUILD/bin/benchmark/qnx-executor-bench" "${2:-10000}"
            else
                log_error "Benchmark binary still not found after build."
                exit 1
            fi
        fi
        ;;
    perf-check|perfcheck)
        # TICKET_471_4: Run performance regression gate
        log_info "Running performance regression check..."
        "$ROOT_DIR/scripts/check_perf_regression.sh" "${2:-10000}"
        ;;
    regression|regtest)
        # TICKET_471_4: Run regression test subset
        log_info "Running regression tests..."
        EXECUTOR_BUILD="$ROOT_DIR/packages/executor/build"
        FAILURES=0
        for test_bin in test_executor_core test_data_source; do
            for path in "$EXECUTOR_BUILD/$test_bin" "$EXECUTOR_BUILD/bin/$test_bin"; do
                if [ -x "$path" ]; then
                    log_info "Running $test_bin..."
                    "$path" "[regression]" || FAILURES=$((FAILURES + 1))
                    break
                fi
            done
        done
        if [ $FAILURES -gt 0 ]; then
            log_error "$FAILURES regression test(s) failed"
            exit 1
        fi
        log_info "All regression tests passed"
        ;;
    test|tests|t)
        # TICKET_471_4: Run all tests
        log_info "Running all tests..."
        EXECUTOR_BUILD="$ROOT_DIR/packages/executor/build"
        # Executor C++ tests
        if [ -d "$EXECUTOR_BUILD" ]; then
            log_info "Running Executor C++ tests..."
            (cd "$EXECUTOR_BUILD" && ctest --output-on-failure) || log_warn "Some Executor tests failed"
        else
            log_warn "Executor not built, skipping C++ tests"
        fi
        # TypeScript tests (if configured)
        if [ -f "$ROOT_DIR/package.json" ]; then
            log_info "Running TypeScript tests..."
            $PM test 2>/dev/null || log_warn "TypeScript tests not configured or failed"
        fi
        ;;
    compliance|comply)
        # TICKET_471_4: Run public content compliance check
        log_info "Running public content compliance check..."
        "$ROOT_DIR/scripts/check_public_content.sh"
        ;;
    hooks)
        # TICKET_471_4: Install git hooks
        log_info "Installing git hooks..."
        "$ROOT_DIR/scripts/install_hooks.sh"
        ;;
    stop)
        stop_running_processes
        ;;
    build|b)
        build_prod
        ;;
    package-ci)
        package_current_platform "${2:-}"
        ;;
    verify-ci)
        verify_ci_build
        ;;
    smoke-ci)
        smoke_packaged_runtime "${2:-}" "${3:-}"
        ;;
    e2e-ci)
        run_generated_public_e2e "${2:-}"
        ;;
    dev|start|"")
        start_dev
        ;;
    *)
        echo "Usage: $0 <command>"
        echo ""
        echo "Build Commands:"
        echo "  install    - Install all dependencies"
        echo "  plugin     - Build TypeScript plugins"
        echo "  ql         - Sync quant-lab-nexus UI into user plugin dir (presentation only)"
        echo "  quant-lab-dev-install   - Build, sign, lifecycle-install Quant Lab dev package"
        echo "  quant-lab-dev-status    - Report installed dev package state"
        echo "  quant-lab-dev-uninstall - Uninstall dev package through lifecycle"
        echo "  quant-lab-release-build - Build signed Quant Lab release inputs"
        echo "  cc         - Build + sync signal-generator-nexus (CCXT) into user plugin dir (dev)"
        echo "  executor   - Build stratforge-runner (C++ strategy executor)"
        echo "  mcp        - Build MCP Server"
        echo "  build      - Production build (Executor + MCP + Plugins + Electron)"
        echo "  package-ci - Package current CI platform (linux, mac, or win)"
        echo "  verify-ci  - Run strict C++ and TypeScript CI verification"
        echo "  smoke-ci   - Launch and verify the packaged application"
        echo "  e2e-ci     - Run generated-public end-to-end acceptance"
        echo ""
        echo "Run Commands:"
        echo "  stop       - Stop running StratCraft processes"
        echo "  dev        - Start development mode (default)"
        echo "  webdash    - Build + run standalone web dashboard (MCP+SPA on :7789, no Electron)"
        echo "  webdash build - Build the standalone web dashboard only (no run)"
        echo ""
        echo "Test & Quality Commands:"
        echo "  test       - Run all tests (Executor C++ + TypeScript)"
        echo "  regression - Run regression test subset"
        echo "  bench [N]  - Run Executor benchmarks (N iterations, default 10000)"
        echo "  perf-check - Run performance regression gate (vs baselines.json)"
        echo "  compliance - Run public content compliance check"
        echo "  hooks      - Install git hooks (pre-push regression check)"
        echo ""
        echo "Environment:"
        echo "  KEEP_PLUGIN_DATA=1  - Keep plugin data in dev mode (skip onInstall)"
        echo ""
        echo "Examples:"
        echo "  KEEP_PLUGIN_DATA=1 $0        # Start but keep plugin data"
        echo "  $0 executor                  # Build V3 Executor"
        echo "  $0 bench 50000               # Run benchmarks with 50K iterations"
        echo "  $0 perf-check                # Check for performance regressions"
        echo "  $0 compliance                # Verify open-source compliance"
        exit 1
        ;;
esac
