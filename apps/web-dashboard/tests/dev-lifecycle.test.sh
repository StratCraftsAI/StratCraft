#!/usr/bin/env bash
# TICKET_1297 controlled lifecycle integration tests.
#
# All listener tests use OS-assigned fixture ports. The suite records every
# spawned PID and never targets the live 7789/7790 services.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
START_DEV="$ROOT/apps/web-dashboard/start-dev.sh"
START_BG="$ROOT/apps/web-dashboard/start-dev-bg.sh"
HELPERS="$ROOT/apps/web-dashboard/dev-lifecycle.sh"
FAKE_HTTP="$SCRIPT_DIR/fixtures/fake-http-server.mjs"
FAKE_SERVICE_API="$SCRIPT_DIR/fixtures/fake-service-api-runtime.mjs"
FAKE_SYSTEMCTL="$SCRIPT_DIR/fixtures/fake-systemctl.sh"
FAKE_SYSTEMD_RUN="$SCRIPT_DIR/fixtures/fake-systemd-run.sh"
FAKE_JOURNALCTL="$SCRIPT_DIR/fixtures/fake-journalctl.sh"
# TICKET_1373 R4: the browser readiness verdict is a fixture here. The suite's
# fake HTTP servers serve no application, so a real Chromium probe could only
# ever report failure; what these tests own is the readiness contract around
# the verdict, not the browser itself.
FAKE_BROWSER_READINESS="$SCRIPT_DIR/fixtures/fake-browser-readiness.mjs"
DEV_IDENTITY_SCRIPT="$ROOT/plugins/quant-lab-nexus/scripts/ensure-dev-signing-identity.mjs"
TEST_TMP="$(mktemp -d)"
OWNED_PIDS=()
PASS_COUNT=0

cleanup() {
  local pid
  trap - EXIT
  for pid in "${OWNED_PIDS[@]}"; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${OWNED_PIDS[@]}"; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TEST_TMP"
}
trap cleanup EXIT

export STRATCRAFT_SERVICE_RUNTIME_LAUNCHER="$FAKE_SERVICE_API"
export STRATCRAFT_SERVICE_API_DISCOVERY_DIR="$TEST_TMP/service-api-discovery"

# shellcheck source=apps/web-dashboard/dev-lifecycle.sh
source "$HELPERS"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "PASS: $1"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  rg -F -- "$expected" "$file" >/dev/null || {
    sed -n '1,220p' "$file" >&2
    fail "Expected '$expected' in $file"
  }
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if rg -F -- "$unexpected" "$file" >/dev/null; then
    sed -n '1,220p' "$file" >&2
    fail "Did not expect '$unexpected' in $file"
  fi
}

assert_status() {
  local expected="$1"
  local actual="$2"
  local context="$3"
  [ "$actual" -eq "$expected" ] || fail "$context: expected status $expected, got $actual"
}

allocate_ports() {
  node - <<'NODE'
const net = require('node:net');
const servers = [];
const ports = [];
function allocate() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    servers.push(server);
    ports.push(server.address().port);
    if (ports.length === 2) {
      process.stdout.write(`${ports[0]} ${ports[1]}\n`);
      for (const item of servers) item.close();
    } else {
      allocate();
    }
  });
}
allocate();
NODE
}

wait_for_port() {
  local port="$1"
  local attempt
  for attempt in $(seq 1 100); do
    if lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.02
  done
  return 1
}

wait_for_port_release() {
  local port="$1"
  local attempt
  for attempt in $(seq 1 100); do
    if ! lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.02
  done
  return 1
}

start_foreign_listener() {
  local port="$1"
  "$FAKE_HTTP" --host 127.0.0.1 --port "$port" > "$TEST_TMP/foreign-$port.log" 2>&1 &
  local pid=$!
  OWNED_PIDS+=("$pid")
  wait_for_port "$port" || fail "Foreign fixture did not listen on $port"
  STARTED_PID="$pid"
}

stop_owned_pid() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    wait "$pid" 2>/dev/null || true
  fi
}

run_foreground() {
  local output="$1"
  local mcp_port="$2"
  local vite_port="$3"
  shift 3
  local status
  env \
    STRATCRAFT_MCP_PORT="$mcp_port" \
    STRATCRAFT_WEB_DASHBOARD_PORT="$vite_port" \
    STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=20 \
    STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS=0.02 \
    STRATCRAFT_MCP_NODE_BIN="$FAKE_HTTP" \
    STRATCRAFT_VITE_BIN="$FAKE_HTTP" \
    "$@" \
    bash "$START_DEV" > "$output" 2>&1 && status=0 || status=$?
  return "$status"
}

run_background() {
  local output="$1"
  local mcp_port="$2"
  local vite_port="$3"
  local command="$4"
  shift 4
  local status
  env \
    STRATCRAFT_MCP_PORT="$mcp_port" \
    STRATCRAFT_WEB_DASHBOARD_PORT="$vite_port" \
    STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=30 \
    STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS=0.02 \
    STRATCRAFT_MCP_NODE_BIN="$FAKE_HTTP" \
    STRATCRAFT_VITE_BIN="$FAKE_HTTP" \
    STRATCRAFT_SYSTEMCTL_BIN="$FAKE_SYSTEMCTL" \
    STRATCRAFT_SYSTEMD_RUN_BIN="$FAKE_SYSTEMD_RUN" \
    STRATCRAFT_JOURNALCTL_BIN="$FAKE_JOURNALCTL" \
    FAKE_SYSTEMCTL_COMMAND_LOG="$TEST_TMP/systemctl.log" \
    FAKE_SYSTEMD_RUN_COMMAND_LOG="$TEST_TMP/systemd-run.log" \
    FAKE_JOURNALCTL_COMMAND_LOG="$TEST_TMP/journalctl.log" \
    FAKE_SYSTEMD_MAIN_PID_FILE="$TEST_TMP/main.pid" \
    FAKE_SYSTEMD_SERVICE_LOG="$TEST_TMP/service.log" \
    STRATCRAFT_BROWSER_READINESS_PROBE="$FAKE_BROWSER_READINESS" \
    "$@" \
    bash "$START_BG" "$command" > "$output" 2>&1 && status=0 || status=$?
  return "$status"
}

# Static ownership contract: root dev excludes Guide WebUI, the deliberate
# all-surfaces entry retains it, and build delegates one ownership-safe start.
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const webPkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/web-dashboard/package.json'), 'utf8'));
if (!pkg.scripts.dev.includes("--filter '!@stratcraft/web-dashboard'")) process.exit(1);
if (pkg.scripts['dev:all'].includes("!@stratcraft/web-dashboard")) process.exit(2);
if (pkg.scripts['dev:webdash'] !== 'bash apps/web-dashboard/start-dev.sh') process.exit(3);
if (webPkg.scripts.dev !== 'bash start-dev.sh') process.exit(4);
const start = fs.readFileSync(path.join(root, 'start.sh'), 'utf8');
const build = start.match(/build_prod\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
const safeStarts = build.match(/start-dev-bg\.sh" start/g) ?? [];
if (safeStarts.length !== 1) process.exit(5);
if (/start-dev-bg\.sh" stop|start-dev\.sh" --bg/.test(build)) process.exit(6);
if (!/start-dev-bg\.sh" start \|\| \{[\s\S]*?return 1/.test(build)) process.exit(7);
NODE
pass "Electron dev excludes Guide; build delegates one fail-fast supervised start"

# TICKET_1297_1: every documented entrypoint is invoked as `./start.sh ...`,
# so the executable bit is part of the contract, not a file attribute. It was
# lost once when an in-place rewrite recreated the file with the umask default;
# `bash start.sh` still worked, which is exactly why nothing caught it. Assert
# the bit AND a real `./` invocation, since only the latter reproduces the
# 126/Permission denied that users hit.
[ -x "$ROOT/start.sh" ] \
  || fail "start.sh is not executable ($(stat -c '%a' "$ROOT/start.sh")); every documented ./start.sh entrypoint fails with 126"
# An unknown argument prints usage and exits 1 with no side effects, so this
# reaches the shell's exec path without starting anything. Captured in an
# assignment: under `set -e` a bare non-zero command would abort the suite.
EXEC_PROBE_STATUS=0
( cd "$ROOT" && ./start.sh --nonexistent-probe-flag >/dev/null 2>&1 ) || EXEC_PROBE_STATUS=$?
[ "$EXEC_PROBE_STATUS" -ne 126 ] \
  || fail "./start.sh could not be executed directly (126 Permission denied)"
# The committed mode must carry it too: a worktree-only chmod is lost on clone.
[ "$(cd "$ROOT" && git ls-files -s start.sh | awk '{print $1}')" = "100755" ] \
  || fail "start.sh is recorded in git as non-executable; a fresh clone cannot run ./start.sh"
pass "start.sh is executable in the worktree, in git, and when invoked as ./start.sh"

if rg -n 'pkill|kill -9|PPID_VAL|STALE_PPID|Killing orphaned|lsof.*kill' "$START_DEV" "$START_BG" >/dev/null; then
  fail "Guide launchers retain prohibited port-based termination logic"
fi
pass "Guide launchers contain no orphan or port-based kill fallback"

# TICKET_1297_1: ownership is a launch fact, not an argv shape.
#
# Regression guard. A dependency install regenerated
# apps/web-dashboard/node_modules/.bin/vite from an npx-style invocation into an
# absolute pnpm shim. That changed the Guide Vite's argv so it matched
# `grep -F "$ROOT_DIR"` for the first time, and `./start.sh build` began killing
# the healthy :7790 listener. The argv pattern had not changed; only the string
# shape of an unrelated process had.
#
# The predicate must therefore key on cgroup membership, which the kernel
# assigns at launch. These cases use real /proc data -- no stubbed cgroup file --
# so they stay honest about what the kernel actually reports.
webdash_pid_is_guide_owned "$$" && fail "Predicate claims the test shell as Guide-owned"
webdash_pid_is_guide_owned 1 && fail "Predicate claims PID 1 as Guide-owned"
webdash_pid_is_guide_owned "not-a-pid" && fail "Predicate accepted a non-numeric PID"
webdash_pid_is_guide_owned 2147483646 && fail "Predicate accepted an unmapped PID"
pass "Guide ownership predicate rejects foreign, invalid, and unmapped PIDs"

# The success branch is covered deterministically through the pure text
# predicate, so it runs identically on a developer host, in a `.scope` shell,
# and in a CI container -- none of which is guaranteed to contain an observable
# `stratcraft-webdash-dev.service` cgroup.
UNIT="stratcraft-webdash-dev"

# cgroup v2: a single `0::<path>` line.
webdash_cgroup_text_names_unit \
  "0::/user.slice/user-1000.slice/user@1000.service/app.slice/$UNIT.service" "$UNIT" \
  || fail "v2 cgroup line naming the unit was not recognised"

# The supervised leaf may itself have children (a nested scope or slice).
webdash_cgroup_text_names_unit \
  "0::/user.slice/user@1000.service/app.slice/$UNIT.service/child.scope" "$UNIT" \
  || fail "Unit membership was not recognised when the unit is an interior path segment"

# cgroup v1: several `<id>:<controllers>:<path>` lines, only one of which names
# the unit. The controllers field also contains ':' characters.
webdash_cgroup_text_names_unit \
  "12:pids:/user.slice
5:cpu,cpuacct:/user.slice/app.slice/$UNIT.service
0::/user.slice" "$UNIT" \
  || fail "v1 multi-line cgroup naming the unit was not recognised"

# Negative and boundary cases.
webdash_cgroup_text_names_unit "0::/user.slice/session-6.scope" "$UNIT" \
  && fail "A plain session scope was reported as Guide-owned"
webdash_cgroup_text_names_unit "0::/user.slice/app.slice/$UNIT.scope" "$UNIT" \
  && fail "A .scope with the unit name was accepted where a .service is required"
webdash_cgroup_text_names_unit "0::/user.slice/app.slice/not-$UNIT.service" "$UNIT" \
  && fail "A unit whose name merely ends with the target was accepted"
webdash_cgroup_text_names_unit "0::/user.slice/app.slice/$UNIT-extra.service" "$UNIT" \
  && fail "A unit whose name merely starts with the target was accepted"
webdash_cgroup_text_names_unit "" "$UNIT" \
  && fail "Empty cgroup text was accepted"
webdash_cgroup_text_names_unit "0::/user.slice/app.slice/$UNIT.service" "" \
  && fail "Empty unit name was accepted"
pass "Guide ownership cgroup parsing covers v1, v2, nesting, and name-prefix boundaries"

# Integration check: the /proc reader must agree with the pure predicate on a
# real process. The harness redirects the unit name at its own cgroup leaf, so
# this exercises the real /proc path without touching the live 7789/7790
# services. Suffix differences (.scope vs .service) are handled by asserting the
# reader's agreement with the text predicate rather than a fixed outcome.
PROBE_CGROUP="$(cat /proc/self/cgroup)"
PROBE_LEAF="$(awk -F/ 'END {print $NF}' <<< "$PROBE_CGROUP")"
PROBE_UNIT="${PROBE_LEAF%.*}"
[ -n "$PROBE_UNIT" ] || fail "Could not resolve the harness cgroup leaf for the ownership probe"
if webdash_cgroup_text_names_unit "$PROBE_CGROUP" "$PROBE_UNIT"; then
  WEBDASH_DEV_UNIT_NAME="$PROBE_UNIT" webdash_pid_is_guide_owned "$$" \
    || fail "/proc reader disagreed with the text predicate on the harness process"
else
  WEBDASH_DEV_UNIT_NAME="$PROBE_UNIT" webdash_pid_is_guide_owned "$$" \
    && fail "/proc reader claimed ownership the text predicate rejects"
fi
pass "Guide ownership /proc reader agrees with the text predicate on a real process"

# start.sh must consult the shared predicate rather than re-deriving ownership,
# and must require a positive Electron launch fact before terminating anything.
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const start = fs.readFileSync(path.join(process.argv[2], 'start.sh'), 'utf8');
const fn = start.match(/find_running_pids\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
if (!fn) process.exit(1);
// The candidate set must be filtered by the Guide ownership predicate.
if (!fn.includes('webdash_pid_is_guide_owned')) process.exit(2);
// The shared module must be the single source of the rule.
if (!start.includes('source "$ROOT_DIR/apps/web-dashboard/dev-lifecycle.sh"')) process.exit(3);
// Termination requires the candidate to carry this session's token; absence of
// a live claim must yield no candidates at all.
if (!fn.includes('electron_dev_owner_token')) process.exit(4);
if (!/owner_token="\$\(electron_dev_owner_token\)" \|\| return 0/.test(fn)) process.exit(5);
if (!/electron_dev_pid_carries_token "\$pid" "\$owner_token" \|\| continue/.test(fn)) process.exit(6);
// An inherited process group must never be used as the ownership signal: it is
// shared by siblings in any shell without job control.
if (/pgid/i.test(fn)) process.exit(7);
// The dev session must record and release that claim.
if (!/claim_electron_dev_ownership/.test(start)) process.exit(8);
if (!/release_electron_dev_ownership/.test(start)) process.exit(9);
// The token must be exported so the dev subtree inherits it.
if (!/export "\$ELECTRON_DEV_TOKEN_VAR=/.test(start)) process.exit(10);
// The claim must be pinned to the launcher's identity, not its PID alone.
if (!/start_time/.test(start)) process.exit(11);
NODE
pass "start.sh requires a positive Electron launch fact before terminating candidates"

# TICKET_1297_1: the Turbo daemon is user-scoped shared state that no
# ./start.sh invocation owns. The contract is about the daemon's LIFECYCLE, not
# about which mechanism ends it: signalling it, wiping the shared /tmp/turbod
# socket root, and calling `turbo daemon clean` are all prohibited on the
# normal path. The last one matters because it reads as the safe alternative
# and is not -- the installed Turbo 2.7.2 documents it as "Stops the turbo
# daemon if it is already running, and removes any stale daemon state", i.e. it
# stops a running healthy daemon unconditionally and never tests staleness.
# An earlier revision of this very test REQUIRED that call, which fixed the
# violation in place while the assertion name claimed the opposite.
node - "$ROOT/start.sh" <<'NODE' || fail "start.sh still asserts authority over the shared Turbo daemon lifecycle (code $?)"
const fs = require('fs');
const start = fs.readFileSync(process.argv[2], 'utf8');
const preflight = (start.match(/^turbo_preflight\(\) \{[\s\S]*?^\}/m) || [''])[0];
if (!preflight) process.exit(2);
// Assert against executable lines only: the rationale comments necessarily
// quote the removed `pgrep ... | kill -9` form, and matching prose would make
// this check fire on its own explanation.
const code = (s) => s.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const preflightCode = code(preflight);
const startCode = code(start);
// No signal may be aimed at a daemon this script does not own.
if (/pgrep[^\n]*turbo/.test(preflightCode)) process.exit(3);
if (/\bkill\b/.test(preflightCode)) process.exit(4);
// The socket root holds one subdirectory per repo hash, for every repo.
if (/\/tmp\/turbod/.test(startCode)) process.exit(5);
// `turbo daemon <stop|clean|restart>` ends a running daemon unconditionally.
// Prohibited anywhere on the normal path, not just inside the preflight.
if (/turbo\s+daemon\s+(clean|stop|restart)/.test(startCode)) process.exit(6);
// The repo content-hash cache stays (TICKET_1371 R7).
if (/rm -rf "\$ROOT_DIR\/\.turbo"/.test(preflightCode)) process.exit(7);
// Nothing may replace the removed steps with another daemon-lifecycle call.
if (/turbo[^\n]*daemon/.test(preflightCode)) process.exit(8);
NODE
pass "Turbo preflight never ends or wipes the shared user-scoped daemon, by any mechanism"

# TICKET_1297_1: behavioural proof that ownership is established, not inherited.
#
# Two fixtures stand in for the two ways a matching process can fail to be
# owned. Both carry an argv that the candidate pattern matches, including
# $ROOT_DIR, so only the ownership rule can separate them from a real dev child.
#
# The fixtures must `exec -a` a BINARY, not a `#!` script: the kernel re-execs
# the interpreter with the script's real path and the assigned argv[0] is lost,
# leaving `bash /tmp/.../f.sh` in `ps`. `sleep` is self-limiting, so a fixture
# can never outlive the suite even if cleanup is skipped.
OWNERSHIP_FIXTURE_DIR="$TEST_TMP/ownership"
mkdir -p "$OWNERSHIP_FIXTURE_DIR"

OWNERSHIP_TOKEN_VAR="STRATCRAFT_ELECTRON_DEV_SESSION_TOKEN"
OWNED_TOKEN="test-token-$$-owned-abcdefghijklmnop"

# Fixture A -- "foreign daemon": its own process group and session, no token.
# Stands in for the Turbo daemon, which the pattern matches but no session owns.
#
# The argv is a parameter, not a constant: the daemon and the ordinary dev
# watcher must be distinguishable, or the "owned" positive control below would
# itself be daemon-shaped and would prove the opposite of what it claims.
DAEMON_ARGV="node $ROOT/node_modules/turbo-linux-64/bin/turbo --skip-infer daemon"
WATCHER_ARGV="node $ROOT/node_modules/tsup/dist/cli-default.js --watch"
start_argv_fixture() {
  local pid_file="$1"
  local env_assignment="$2"
  local detach="$3"
  local argv="${4:-$DAEMON_ARGV}"
  local pid=""
  : > "$pid_file"
  if [ "$detach" = "setsid" ]; then
    env $env_assignment setsid bash -c \
      "echo \$\$ > '$pid_file'; exec -a '$argv' sleep 30" \
      </dev/null >/dev/null 2>&1 &
  else
    # No setsid: this shell has no job control, so the fixture INHERITS this
    # shell's process group -- the shared-PGID case.
    env $env_assignment bash -c \
      "echo \$\$ > '$pid_file'; exec -a '$argv' sleep 30" \
      </dev/null >/dev/null 2>&1 &
  fi
  disown 2>/dev/null || true
  for _ in $(seq 1 60); do
    pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
    [ -n "$pid" ] && break
    sleep 0.05
  done
  # The fixture reports its own PID, so no host-wide pgrep can confuse it with a
  # real Turbo daemon that may legitimately be running on this machine.
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  echo "$pid"
}

FOREIGN_PID="$(start_argv_fixture "$OWNERSHIP_FIXTURE_DIR/foreign.pid" "" setsid)" \
  || fail "Could not start the foreign argv-matching fixture"

# Fixture B -- "same process group, different owner". This is the review case:
#   bash apps/web-dashboard/start-dev.sh &
#   ./start.sh
# in a shell without job control. It is NOT in stratcraft-webdash-dev.service,
# so the cgroup exclusion does not cover it, and it shares this shell's PGID.
# Only the absence of the session token may keep it alive.
SIBLING_PID="$(start_argv_fixture "$OWNERSHIP_FIXTURE_DIR/sibling.pid" "" inherit)" \
  || fail "Could not start the same-process-group fixture"

# Fixture C -- a genuine dev child: same inherited process group AND the token.
# Deliberately watcher-shaped, NOT daemon-shaped: this is the positive control,
# and a daemon-shaped positive control would assert that a token-carrying Turbo
# daemon IS terminable -- the exact defect fixture D covers.
OWNED_PID="$(start_argv_fixture "$OWNERSHIP_FIXTURE_DIR/owned.pid" \
  "$OWNERSHIP_TOKEN_VAR=$OWNED_TOKEN" inherit "$WATCHER_ARGV")" \
  || fail "Could not start the token-carrying fixture"

# Fixture D -- the Turbo daemon as it actually appears in a real dev session:
# spawned on demand by this session's own `turbo dev`, so it INHERITS the
# exported session token and passes every ownership test. Only removing
# daemon-shaped argv from the candidate set keeps it alive.
OWNED_DAEMON_PID="$(start_argv_fixture "$OWNERSHIP_FIXTURE_DIR/owned-daemon.pid" \
  "$OWNERSHIP_TOKEN_VAR=$OWNED_TOKEN" inherit "$DAEMON_ARGV")" \
  || fail "Could not start the token-carrying daemon fixture"

cleanup_ownership_fixtures() {
  local p
  for p in "${FOREIGN_PID:-}" "${SIBLING_PID:-}" "${OWNED_PID:-}" "${OWNED_DAEMON_PID:-}"; do
    [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true
  done
}
trap 'cleanup_ownership_fixtures; cleanup' EXIT

# The shared-PGID premise must actually hold, or the sibling assertion below
# would pass for the wrong reason.
SELF_PGID="$(ps -o pgid= -p $$ | tr -d '[:space:]')"
SIBLING_PGID="$(ps -o pgid= -p "$SIBLING_PID" | tr -d '[:space:]')"
OWNED_PGID="$(ps -o pgid= -p "$OWNED_PID" | tr -d '[:space:]')"
[ "$SIBLING_PGID" = "$SELF_PGID" ] \
  || fail "Fixture setup invalid: the sibling fixture did not inherit this shell's process group"
[ "$OWNED_PGID" = "$SELF_PGID" ] \
  || fail "Fixture setup invalid: the owned fixture did not inherit this shell's process group"
pass "Ownership fixtures reproduce a shared inherited process group"

OWNERSHIP_PROBE="$OWNERSHIP_FIXTURE_DIR/probe.sh"
cat > "$OWNERSHIP_PROBE" <<PROBE
#!/usr/bin/env bash
set -e
ROOT_DIR="$ROOT"
BUILD_CACHE_DIR="$OWNERSHIP_FIXTURE_DIR/cache"
ELECTRON_DEV_OWNER_FILE="\$BUILD_CACHE_DIR/electron-dev-owner.json"
ELECTRON_DEV_TOKEN_VAR="$OWNERSHIP_TOKEN_VAR"
ensure_build_cache_dir() { mkdir -p "\$BUILD_CACHE_DIR"; }
log_error() { echo "\$*" >&2; }
source "$ROOT/apps/web-dashboard/dev-lifecycle.sh"
$(sed -n '/^process_start_time()/,/^}/p;/^electron_dev_owner_token()/,/^}/p;/^electron_dev_pid_carries_token()/,/^}/p;/^claim_electron_dev_ownership()/,/^}/p;/^release_electron_dev_ownership()/,/^}/p;/^find_running_pids()/,/^}/p' "$ROOT/start.sh")
write_claim() {
  ensure_build_cache_dir
  printf '{"token":"%s","pid":%s,"start_time":"%s"}\n' \
    "\$1" "\$2" "\$(process_start_time "\$2")" > "\$ELECTRON_DEV_OWNER_FILE"
}
case "\$1" in
  no-claim)    find_running_pids ;;
  with-claim)  write_claim "\$2" "\$3"; find_running_pids ;;
  forged-time) ensure_build_cache_dir
               printf '{"token":"%s","pid":%s,"start_time":"1"}\n' "\$2" "\$3" \
                 > "\$ELECTRON_DEV_OWNER_FILE"
               find_running_pids ;;
esac
PROBE
chmod +x "$OWNERSHIP_PROBE"

# No recorded dev session: nothing may be proposed for termination.
if [ -n "$(bash "$OWNERSHIP_PROBE" no-claim)" ]; then
  fail "find_running_pids proposed candidates with no Electron dev claim recorded"
fi
pass "Stop path proposes nothing when no Electron dev session is recorded"

# Positive control. Without this, every negative assertion below could pass for
# the trivial reason that no fixture is ever matched at all.
CLAIMED="$(bash "$OWNERSHIP_PROBE" with-claim "$OWNED_TOKEN" $$)"
if ! grep -qx "$OWNED_PID" <<< "$CLAIMED"; then
  fail "A live claim did not return the token-carrying fixture"
fi
pass "Live Electron dev claim returns the token-carrying process"

# The review case: same inherited process group, no token -> never terminable.
if grep -qx "$SIBLING_PID" <<< "$CLAIMED"; then
  fail "A process sharing the inherited process group but carrying no session token was proposed for termination"
fi
pass "Processes sharing an inherited process group are not owned without the session token"

# The Turbo-daemon case: foreign group, no token.
if grep -qx "$FOREIGN_PID" <<< "$CLAIMED"; then
  fail "An argv-matching foreign daemon was proposed for termination"
fi
pass "Argv-matching foreign daemons are never proposed"

# The real-world Turbo-daemon case: the session's own `turbo dev` spawns the
# daemon, so it carries the session token. Ownership alone cannot save it.
if grep -qx "$OWNED_DAEMON_PID" <<< "$CLAIMED"; then
  fail "A Turbo daemon carrying this session's token was proposed for termination"
fi
pass "A token-carrying Turbo daemon is excluded from the candidate set"

# A claim whose recorded start time does not match the live PID is a stale
# record whose PID has been reused; it must not resolve.
if [ -n "$(bash "$OWNERSHIP_PROBE" forged-time "$OWNED_TOKEN" $$)" ]; then
  fail "A claim with a mismatched launcher start time authorized termination"
fi
pass "Claim pinned to launcher start time rejects PID reuse"

# Direct assertions on the owner-claim reader, at its own contract. The stop
# path alone cannot distinguish these: a malformed or dead claim and a claim
# whose token nothing carries both yield an empty candidate list.
OWNER_LOOKUP_PROBE="$OWNERSHIP_FIXTURE_DIR/owner-lookup.sh"
cat > "$OWNER_LOOKUP_PROBE" <<PROBE
#!/usr/bin/env bash
set -e
BUILD_CACHE_DIR="$OWNERSHIP_FIXTURE_DIR/lookup-cache"
ELECTRON_DEV_OWNER_FILE="\$BUILD_CACHE_DIR/electron-dev-owner.json"
mkdir -p "\$BUILD_CACHE_DIR"
$(sed -n '/^process_start_time()/,/^}/p;/^electron_dev_owner_token()/,/^}/p' "$ROOT/start.sh")
printf '%s' "\$1" > "\$ELECTRON_DEV_OWNER_FILE"
electron_dev_owner_token
PROBE
chmod +x "$OWNER_LOOKUP_PROBE"

LIVE_START="$(awk '{print $22}' /proc/$$/stat)"
VALID_CLAIM="$(printf '{"token":"%s","pid":%s,"start_time":"%s"}' "$OWNED_TOKEN" "$$" "$LIVE_START")"

[ "$(bash "$OWNER_LOOKUP_PROBE" "$VALID_CLAIM" 2>/dev/null)" = "$OWNED_TOKEN" ] \
  || fail "Owner lookup failed to resolve a valid live claim"
[ -z "$(bash "$OWNER_LOOKUP_PROBE" "" 2>/dev/null)" ] \
  || fail "Owner lookup resolved an empty claim"
[ -z "$(bash "$OWNER_LOOKUP_PROBE" 'not json at all' 2>/dev/null)" ] \
  || fail "Owner lookup resolved a malformed claim"
[ -z "$(bash "$OWNER_LOOKUP_PROBE" "$(printf '{"token":"short","pid":%s,"start_time":"%s"}' "$$" "$LIVE_START")" 2>/dev/null)" ] \
  || fail "Owner lookup resolved a claim whose token is too short to be unguessable"
[ -z "$(bash "$OWNER_LOOKUP_PROBE" "$(printf '{"token":"%s","pid":0,"start_time":"%s"}' "$OWNED_TOKEN" "$LIVE_START")" 2>/dev/null)" ] \
  || fail "Owner lookup resolved a claim naming PID 0"
[ -z "$(bash "$OWNER_LOOKUP_PROBE" "$(printf '{"token":"%s","pid":%s,"start_time":"1"}' "$OWNED_TOKEN" "$$")" 2>/dev/null)" ] \
  || fail "Owner lookup resolved a claim whose start time does not match the live PID"
[ -z "$(bash "$OWNER_LOOKUP_PROBE" "$(printf '{"token":"%s","pid":2147483646,"start_time":"%s"}' "$OWNED_TOKEN" "$LIVE_START")" 2>/dev/null)" ] \
  || fail "Owner lookup resolved a claim naming a dead launcher"
pass "Electron dev owner lookup resolves valid claims and rejects dead, forged, and malformed ones"

# The token test must match a whole environment entry, not a substring: a
# process carrying an unrelated variable whose value contains the token text
# must not be treated as owned.
SUBSTRING_PID="$(start_argv_fixture "$OWNERSHIP_FIXTURE_DIR/substring.pid" \
  "UNRELATED_VAR=prefix-$OWNED_TOKEN-suffix" inherit)" \
  || fail "Could not start the substring-environment fixture"
if bash -c "
  ELECTRON_DEV_TOKEN_VAR='$OWNERSHIP_TOKEN_VAR'
  $(sed -n '/^electron_dev_pid_carries_token()/,/^}/p' "$ROOT/start.sh")
  electron_dev_pid_carries_token '$SUBSTRING_PID' '$OWNED_TOKEN'
"; then
  kill -9 "$SUBSTRING_PID" 2>/dev/null || true
  fail "Token check matched a substring of an unrelated environment variable"
fi
kill -9 "$SUBSTRING_PID" 2>/dev/null || true
pass "Token check requires a whole-entry environment match"

# Development identity discovery is read-only: absence is distinct from
# corruption, and a valid identity reports the lifecycle installer's trust
# store without rewriting it.
IDENTITY_CONFIG_ROOT="$TEST_TMP/identity-config"
set +e
XDG_CONFIG_HOME="$IDENTITY_CONFIG_ROOT" node "$DEV_IDENTITY_SCRIPT" --existing \
  > "$TEST_TMP/identity-absent.json" 2> "$TEST_TMP/identity-absent.err"
STATUS=$?
set -e
assert_status 3 "$STATUS" "absent development identity"
IDENTITY_JSON="$(XDG_CONFIG_HOME="$IDENTITY_CONFIG_ROOT" node "$DEV_IDENTITY_SCRIPT")"
DEV_TRUST_STORE="$(
  printf '%s' "$IDENTITY_JSON" \
    | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).trustStorePath)"
)"
XDG_CONFIG_HOME="$IDENTITY_CONFIG_ROOT" node "$DEV_IDENTITY_SCRIPT" --existing \
  > "$TEST_TMP/identity-existing.json"
assert_contains "$TEST_TMP/identity-existing.json" "$DEV_TRUST_STORE"
cp "$DEV_TRUST_STORE" "$TEST_TMP/valid-dev-trust.json"
printf '%s\n' '{"schemaVersion":1,"keys":[]}' > "$DEV_TRUST_STORE"
set +e
XDG_CONFIG_HOME="$IDENTITY_CONFIG_ROOT" node "$DEV_IDENTITY_SCRIPT" --existing \
  > "$TEST_TMP/identity-invalid.json" 2> "$TEST_TMP/identity-invalid.err"
STATUS=$?
set -e
assert_status 1 "$STATUS" "invalid development identity"
assert_contains "$TEST_TMP/identity-invalid.err" "incomplete or invalid"
mv "$TEST_TMP/valid-dev-trust.json" "$DEV_TRUST_STORE"
pass "Development identity discovery distinguishes valid, absent, and invalid state"

# Unsupported background mode is redirected to the supervised owner.
OUTPUT="$TEST_TMP/unsupported.log"
set +e
bash "$START_DEV" --bg > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 2 "$STATUS" "unsupported foreground argument"
assert_contains "$OUTPUT" "start-dev-bg.sh start"
pass "Unsafe disowned background mode is removed"

# Both owners fail before port inspection when the compiled MCP entry is
# missing.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/missing-mcp-entry.log"
set +e
STRATCRAFT_MCP_PORT="$MCP_PORT" \
  STRATCRAFT_WEB_DASHBOARD_PORT="$VITE_PORT" \
  STRATCRAFT_MCP_ENTRY="$TEST_TMP/does-not-exist.js" \
  bash "$START_DEV" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "foreground missing MCP entry"
assert_contains "$OUTPUT" "MCP server not compiled"

OUTPUT="$TEST_TMP/background-missing-mcp-entry.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  STRATCRAFT_MCP_ENTRY="$TEST_TMP/does-not-exist.js" \
  FAKE_SYSTEMCTL_ACTIVE=0
STATUS=$?
set -e
assert_status 1 "$STATUS" "background missing MCP entry"
assert_contains "$OUTPUT" "MCP server not compiled"
pass "Both Guide owners fail fast when the MCP artifact is missing"

# Service API ownership is established before MCP is exposed. A failed,
# malformed, or unreachable candidate leaves both Guide ports unopened.
for SERVICE_MODE in exit-failure invalid unreachable missing; do
  read -r MCP_PORT VITE_PORT < <(allocate_ports)
  OUTPUT="$TEST_TMP/service-api-$SERVICE_MODE.log"
  set +e
  run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" \
    FAKE_SERVICE_RUNTIME_MODE="$SERVICE_MODE" \
    FAKE_SERVICE_RUNTIME_EXIT_CODE=36 \
    STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=2
  STATUS=$?
  set -e
  assert_status 1 "$STATUS" "Service API $SERVICE_MODE startup"
  if lsof -nP -tiTCP:"$MCP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "MCP was exposed while Service API mode $SERVICE_MODE was unhealthy"
  fi
done
assert_contains "$TEST_TMP/service-api-exit-failure.log" "exited with status 36"
assert_contains "$TEST_TMP/service-api-invalid.log" "malformed, stale, or unreachable"
assert_contains "$TEST_TMP/service-api-missing.log" "No Service API runtime owner"
pass "Guide fails before MCP exposure for every unavailable Service API startup class"

# Exit 3 means the TICKET_1334 claim is held by another live host. Guide must
# validate that incumbent and must not treat the benign claim loss as startup
# failure or terminate the incumbent during cleanup.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
"$FAKE_SERVICE_API" > "$TEST_TMP/incumbent-service.log" 2>&1 &
INCUMBENT_SERVICE_PID=$!
OWNED_PIDS+=("$INCUMBENT_SERVICE_PID")
webdash_wait_for_service_api \
  "$STRATCRAFT_SERVICE_API_DISCOVERY_DIR" "$INCUMBENT_SERVICE_PID" 30 0.02 curl \
  >/dev/null || fail "Incumbent Service API fixture did not become healthy"
OUTPUT="$TEST_TMP/incumbent-service-owner.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" \
  FAKE_SERVICE_RUNTIME_MODE=exit-failure \
  FAKE_SERVICE_RUNTIME_EXIT_CODE=3 \
  FAKE_MCP_EXIT_MS=250 \
  FAKE_MCP_EXIT_CODE=23
STATUS=$?
set -e
assert_status 23 "$STATUS" "Guide with incumbent Service API owner"
kill -0 "$INCUMBENT_SERVICE_PID" 2>/dev/null || fail "Guide cleanup terminated the incumbent Service API owner"
assert_contains "$OUTPUT" "pre-existing Service API runtime owner is healthy"
stop_owned_pid "$INCUMBENT_SERVICE_PID"
pass "Guide accepts but never owns or terminates a healthy incumbent Service API role"

# Port validation covers non-numeric, zero, and above-range values.
for BAD_PORT in abc 0 65536; do
  OUTPUT="$TEST_TMP/invalid-$BAD_PORT.log"
  set +e
  STRATCRAFT_MCP_PORT="$BAD_PORT" bash "$START_DEV" > "$OUTPUT" 2>&1
  STATUS=$?
  set -e
  assert_status 1 "$STATUS" "invalid port $BAD_PORT"
  assert_contains "$OUTPUT" "Invalid MCP port"
done
pass "Port validation rejects every invalid boundary class"

# A missing lsof fails closed because ownership cannot be established.
OUTPUT="$TEST_TMP/no-lsof.log"
set +e
PATH=/nonexistent /bin/bash -c "source '$HELPERS'; webdash_listener_pids 17889" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 2 "$STATUS" "missing lsof"
assert_contains "$OUTPUT" "lsof is required"
pass "Listener ownership check fails closed without lsof"

# MCP conflict: preserve the listener and prove Vite was never spawned.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
start_foreign_listener "$MCP_PORT"
FOREIGN_PID="$STARTED_PID"
OUTPUT="$TEST_TMP/mcp-conflict.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT"
STATUS=$?
set -e
assert_status 1 "$STATUS" "MCP conflict"
kill -0 "$FOREIGN_PID" 2>/dev/null || fail "MCP conflict listener was terminated"
if lsof -nP -tiTCP:"$VITE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Vite started despite MCP preflight conflict"
fi
assert_contains "$OUTPUT" "no process was terminated"
stop_owned_pid "$FOREIGN_PID"
pass "MCP conflict is atomic and preserves the foreign listener"

# Vite conflict: both ports are checked before MCP is spawned.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
start_foreign_listener "$VITE_PORT"
FOREIGN_PID="$STARTED_PID"
OUTPUT="$TEST_TMP/vite-conflict.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT"
STATUS=$?
set -e
assert_status 1 "$STATUS" "Vite conflict"
kill -0 "$FOREIGN_PID" 2>/dev/null || fail "Vite conflict listener was terminated"
if lsof -nP -tiTCP:"$MCP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "MCP started despite Vite preflight conflict"
fi
stop_owned_pid "$FOREIGN_PID"
pass "Vite conflict is atomic and preserves the foreign listener"

# MCP exits after both children are ready: Vite must be cleaned up.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/mcp-exit.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" \
  NONA_SERVER_URL=https://example.invalid \
  FAKE_MCP_EXIT_MS=250 \
  FAKE_MCP_EXIT_CODE=23
STATUS=$?
set -e
assert_status 23 "$STATUS" "MCP child failure"
wait_for_port_release "$MCP_PORT" || fail "MCP port remained after failure"
wait_for_port_release "$VITE_PORT" || fail "Vite sibling remained after MCP failure"
assert_contains "$OUTPUT" "MCP server"
assert_contains "$OUTPUT" "exited with status 23"
pass "MCP failure stops only its owned Vite sibling"

# Vite exits after both children are ready: MCP must be cleaned up.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/vite-exit.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" \
  DESKTOP_API_URL=https://example.invalid \
  FAKE_VITE_EXIT_MS=250 \
  FAKE_VITE_EXIT_CODE=24
STATUS=$?
set -e
assert_status 24 "$STATUS" "Vite child failure"
wait_for_port_release "$MCP_PORT" || fail "MCP sibling remained after Vite failure"
wait_for_port_release "$VITE_PORT" || fail "Vite port remained after failure"
assert_contains "$OUTPUT" "Vite"
assert_contains "$OUTPUT" "exited with status 24"
pass "Vite failure stops only its owned MCP sibling"

# A clean child exit is still an unhealthy pair and returns failure.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/clean-child-exit.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" \
  FAKE_MCP_EXIT_MS=250 \
  FAKE_MCP_EXIT_CODE=0
STATUS=$?
set -e
assert_status 1 "$STATUS" "clean child exit"
pass "Unexpected clean child exit is reported as pair failure"

# Once Guide owns the headless runtime, losing it tears down MCP and Vite.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/service-api-exit.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" \
  FAKE_SERVICE_RUNTIME_EXIT_MS=250 \
  FAKE_SERVICE_RUNTIME_EXIT_CODE=37
STATUS=$?
set -e
assert_status 37 "$STATUS" "Service API child failure"
wait_for_port_release "$MCP_PORT" || fail "MCP remained after Service API failure"
wait_for_port_release "$VITE_PORT" || fail "Vite remained after Service API failure"
assert_contains "$OUTPUT" "Research Runtime Service"
assert_contains "$OUTPUT" "exited with status 37"
pass "Service API failure stops its owned Guide siblings"

# Child failure before bind and startup timeout both clean their owned child.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/prebind-failure.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" FAKE_MCP_FAIL_BEFORE_LISTEN_CODE=31
STATUS=$?
set -e
assert_status 1 "$STATUS" "pre-bind child failure"
assert_contains "$OUTPUT" "exited with status 31"

read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/startup-timeout.log"
set +e
env \
  STRATCRAFT_MCP_PORT="$MCP_PORT" \
  STRATCRAFT_WEB_DASHBOARD_PORT="$VITE_PORT" \
  STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=1 \
  STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS=0.01 \
  STRATCRAFT_MCP_NODE_BIN="$FAKE_HTTP" \
  STRATCRAFT_VITE_BIN="$FAKE_HTTP" \
  FAKE_MCP_LISTEN_DELAY_MS=500 \
  bash "$START_DEV" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "startup timeout"
wait_for_port_release "$MCP_PORT" || fail "Timed-out MCP child remained alive"
assert_contains "$OUTPUT" "TIMEOUT"
pass "Pre-bind failure and timeout clean owned processes"

# Vite also reports a pre-bind failure and timeout without leaving MCP alive.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/vite-prebind-failure.log"
set +e
run_foreground "$OUTPUT" "$MCP_PORT" "$VITE_PORT" FAKE_VITE_FAIL_BEFORE_LISTEN_CODE=32
STATUS=$?
set -e
assert_status 1 "$STATUS" "Vite pre-bind failure"
assert_contains "$OUTPUT" "exited with status 32"
wait_for_port_release "$MCP_PORT" || fail "MCP remained after Vite pre-bind failure"

read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/vite-startup-timeout.log"
set +e
env \
  STRATCRAFT_MCP_PORT="$MCP_PORT" \
  STRATCRAFT_WEB_DASHBOARD_PORT="$VITE_PORT" \
  STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=1 \
  STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS=0.01 \
  STRATCRAFT_MCP_NODE_BIN="$FAKE_HTTP" \
  STRATCRAFT_VITE_BIN="$FAKE_HTTP" \
  FAKE_VITE_LISTEN_DELAY_MS=500 \
  bash "$START_DEV" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "Vite startup timeout"
wait_for_port_release "$MCP_PORT" || fail "MCP remained after Vite timeout"
wait_for_port_release "$VITE_PORT" || fail "Timed-out Vite child remained alive"
assert_contains "$OUTPUT" "TIMEOUT"
pass "Vite pre-bind failure and timeout clean the owned pair"

# The shared waiter rejects an invalid owner PID instead of treating PID zero
# as the current process group.
OUTPUT="$TEST_TMP/invalid-owner-pid.log"
set +e
/bin/bash -c "source '$HELPERS'; webdash_wait_for_port fixture 17889 0 1 0.01" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "invalid owner PID"
assert_contains "$OUTPUT" "invalid owner PID"
pass "Waiter rejects unsafe owner PIDs"

# A systemd MainPID is supervised by systemd and is not waitable by this
# shell. Its disappearance must never be passed to the shell wait builtin.
NON_CHILD_PID_FILE="$TEST_TMP/non-child.pid"
bash -c 'sleep 0.05 & echo "$!" > "$1"' _ "$NON_CHILD_PID_FILE"
NON_CHILD_PID="$(tr -d '[:space:]' < "$NON_CHILD_PID_FILE")"
OUTPUT="$TEST_TMP/supervised-owner-exit.log"
set +e
/bin/bash -c "source '$HELPERS'; webdash_wait_for_port fixture 17889 '$NON_CHILD_PID' 20 0.01 supervised" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "supervised owner exit"
assert_contains "$OUTPUT" "supervised owner PID $NON_CHILD_PID exited"
assert_not_contains "$OUTPUT" "not a child of this shell"
assert_not_contains "$OUTPUT" "status 127"
pass "Supervised non-child exit is observed without invoking shell wait"

OUTPUT="$TEST_TMP/invalid-port-owner-type.log"
set +e
/bin/bash -c "source '$HELPERS'; webdash_wait_for_port fixture 17889 $$ 1 0.01 invalid" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "invalid port owner type"
assert_contains "$OUTPUT" "invalid owner type 'invalid'"

OUTPUT="$TEST_TMP/invalid-service-owner-type.log"
set +e
/bin/bash -c "source '$HELPERS'; webdash_wait_for_service_api '$TEST_TMP/missing-discovery' $$ 1 0.01 curl invalid" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "invalid Service API owner type"
assert_contains "$OUTPUT" "invalid owner type 'invalid'"
pass "Waiters reject unknown process ownership contracts"

NON_CHILD_PID_FILE="$TEST_TMP/non-child-service.pid"
bash -c 'sleep 0.05 & echo "$!" > "$1"' _ "$NON_CHILD_PID_FILE"
NON_CHILD_PID="$(tr -d '[:space:]' < "$NON_CHILD_PID_FILE")"
OUTPUT="$TEST_TMP/supervised-service-owner-exit.log"
set +e
/bin/bash -c "source '$HELPERS'; webdash_wait_for_service_api '$TEST_TMP/missing-discovery' '$NON_CHILD_PID' 20 0.01 curl supervised" > "$OUTPUT" 2>&1
STATUS=$?
set -e
assert_status 1 "$STATUS" "supervised Service API owner exit"
assert_contains "$OUTPUT" "supervised owner PID $NON_CHILD_PID exited"
assert_not_contains "$OUTPUT" "not a child of this shell"
assert_not_contains "$OUTPUT" "status 127"
pass "Supervised Service API non-child exit is observed without shell wait"

# Runtime launchers may be wrappers (the Electron CLI spawns the actual binary
# that writes the claim), so ownership follows ancestry rather than requiring
# the claim PID to equal the shell's direct child PID.
ANCESTRY_PID_FILE="$TEST_TMP/ancestry-child.pid"
bash -c 'sleep 5 & child=$!; echo "$child" > "$1"; wait "$child"' _ "$ANCESTRY_PID_FILE" &
ANCESTRY_PARENT_PID=$!
OWNED_PIDS+=("$ANCESTRY_PARENT_PID")
for _attempt in $(seq 1 30); do
  [ -s "$ANCESTRY_PID_FILE" ] && break
  sleep 0.02
done
[ -s "$ANCESTRY_PID_FILE" ] || fail "Ancestry fixture did not publish its child PID"
ANCESTRY_CHILD_PID="$(tr -d '[:space:]' < "$ANCESTRY_PID_FILE")"
OWNED_PIDS+=("$ANCESTRY_CHILD_PID")
webdash_pid_descends_from "$ANCESTRY_CHILD_PID" "$ANCESTRY_PARENT_PID" ||
  fail "Service claim child was not attributed to its launcher"
if webdash_pid_descends_from "$ANCESTRY_PARENT_PID" "$ANCESTRY_CHILD_PID"; then
  fail "Service launcher was incorrectly attributed to its child"
fi
if webdash_pid_descends_from invalid "$ANCESTRY_PARENT_PID"; then
  fail "Invalid claim PID was accepted"
fi
stop_owned_pid "$ANCESTRY_PARENT_PID"
stop_owned_pid "$ANCESTRY_CHILD_PID"
pass "Service runtime claim ownership follows a validated launcher ancestry"

# SIGTERM to the launcher cleans both children without addressing any foreign
# process or process group.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
OUTPUT="$TEST_TMP/signal-cleanup.log"
env \
  STRATCRAFT_MCP_PORT="$MCP_PORT" \
  STRATCRAFT_WEB_DASHBOARD_PORT="$VITE_PORT" \
  STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=20 \
  STRATCRAFT_WEBDASH_STARTUP_DELAY_SECONDS=0.02 \
  STRATCRAFT_MCP_NODE_BIN="$FAKE_HTTP" \
  STRATCRAFT_VITE_BIN="$FAKE_HTTP" \
  XDG_CONFIG_HOME="$IDENTITY_CONFIG_ROOT" \
  FAKE_SERVICE_RUNTIME_ENV_FILE="$TEST_TMP/service-runtime-env.txt" \
  bash "$START_DEV" > "$OUTPUT" 2>&1 &
LAUNCHER_PID=$!
OWNED_PIDS+=("$LAUNCHER_PID")
wait_for_port "$MCP_PORT" || fail "Signal test MCP did not start"
wait_for_port "$VITE_PORT" || fail "Signal test Vite did not start"
assert_contains "$TEST_TMP/service-runtime-env.txt" "$DEV_TRUST_STORE"
assert_contains "$OUTPUT" "Quant Lab trust: isolated development identity"
kill "$LAUNCHER_PID"
set +e
wait "$LAUNCHER_PID"
STATUS=$?
set -e
assert_status 143 "$STATUS" "launcher SIGTERM"
wait_for_port_release "$MCP_PORT" || fail "MCP remained after launcher SIGTERM"
wait_for_port_release "$VITE_PORT" || fail "Vite remained after launcher SIGTERM"
pass "Foreground injects verified development trust and scopes signal cleanup"

# Background start uses the supervised command, verifies both ports, and stop
# targets only the unit.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
rm -f "$TEST_TMP/main.pid" "$TEST_TMP/systemctl.log" "$TEST_TMP/systemd-run.log"
OUTPUT="$TEST_TMP/background-start.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=0 \
  FAKE_SYSTEMCTL_LOAD_STATE=loaded
STATUS=$?
set -e
assert_status 0 "$STATUS" "background start"
wait_for_port "$MCP_PORT" || fail "Background MCP did not start"
wait_for_port "$VITE_PORT" || fail "Background Vite did not start"
assert_contains "$TEST_TMP/systemd-run.log" "--collect"
assert_contains "$TEST_TMP/systemd-run.log" "start-dev.sh"

OUTPUT="$TEST_TMP/background-stop.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" stop \
  FAKE_SYSTEMCTL_LOAD_STATE=loaded
STATUS=$?
set -e
assert_status 0 "$STATUS" "background stop"
wait_for_port_release "$MCP_PORT" || fail "Background MCP remained after unit stop"
wait_for_port_release "$VITE_PORT" || fail "Background Vite remained after unit stop"
assert_contains "$TEST_TMP/systemctl.log" "stop stratcraft-webdash-dev.service"
pass "Background lifecycle is supervised and unit-scoped"

# Each dependency stage gets the configured startup budget. The background
# owner must not spend the Service API budget waiting for MCP, which is started
# only after the Service API becomes healthy by the foreground composition.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
rm -f "$TEST_TMP/main.pid"
OUTPUT="$TEST_TMP/background-sequential-readiness.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=0 \
  STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=12 \
  FAKE_SERVICE_RUNTIME_LISTEN_DELAY_MS=150 \
  FAKE_MCP_LISTEN_DELAY_MS=150
STATUS=$?
set -e
assert_status 0 "$STATUS" "background sequential readiness"
assert_contains "$OUTPUT" "Waiting for Research Runtime Service"
assert_contains "$OUTPUT" "Waiting for MCP server"
OUTPUT="$TEST_TMP/background-sequential-readiness-stop.log"
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" stop \
  FAKE_SYSTEMCTL_LOAD_STATE=loaded
wait_for_port_release "$MCP_PORT" || fail "Sequential-readiness MCP remained after stop"
wait_for_port_release "$VITE_PORT" || fail "Sequential-readiness Vite remained after stop"
pass "Background readiness follows Service API, MCP, and Vite dependency order"

# Stopping an absent unit reports a foreign listener but never kills it.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
start_foreign_listener "$MCP_PORT"
FOREIGN_PID="$STARTED_PID"
rm -f "$TEST_TMP/systemctl.log"
OUTPUT="$TEST_TMP/background-foreign-stop.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" stop \
  FAKE_SYSTEMCTL_LOAD_STATE=not-found
STATUS=$?
set -e
assert_status 0 "$STATUS" "absent background unit stop"
kill -0 "$FOREIGN_PID" 2>/dev/null || fail "Background stop killed a foreign listener"
assert_contains "$OUTPUT" "foreign listener"
assert_not_contains "$TEST_TMP/systemctl.log" "stop stratcraft-webdash-dev.service"
stop_owned_pid "$FOREIGN_PID"
pass "Background stop preserves listeners outside the unit"

# Idempotent start verifies both ports and returns without a restart when the
# unit is already active and healthy.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
start_foreign_listener "$MCP_PORT"
ACTIVE_MCP_PID="$STARTED_PID"
start_foreign_listener "$VITE_PORT"
ACTIVE_VITE_PID="$STARTED_PID"
"$FAKE_SERVICE_API" > "$TEST_TMP/active-service.log" 2>&1 &
ACTIVE_SERVICE_PID=$!
OWNED_PIDS+=("$ACTIVE_SERVICE_PID")
webdash_wait_for_service_api \
  "$STRATCRAFT_SERVICE_API_DISCOVERY_DIR" "$ACTIVE_SERVICE_PID" 30 0.02 curl \
  >/dev/null || fail "Active-unit Service API fixture did not become healthy"
printf '%s\n' "$ACTIVE_MCP_PID" > "$TEST_TMP/main.pid"
rm -f "$TEST_TMP/systemd-run.log"
OUTPUT="$TEST_TMP/background-active.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start FAKE_SYSTEMCTL_ACTIVE=1
STATUS=$?
set -e
assert_status 0 "$STATUS" "already-active background start"
assert_contains "$OUTPUT" "already active and ready"
[ ! -e "$TEST_TMP/systemd-run.log" ] || fail "Already-active start invoked systemd-run"
stop_owned_pid "$ACTIVE_MCP_PID"
stop_owned_pid "$ACTIVE_VITE_PID"
stop_owned_pid "$ACTIVE_SERVICE_PID"
rm -f "$TEST_TMP/main.pid"
pass "Background start is idempotent"

# An active unit without both healthy endpoints fails without restarting it.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
start_foreign_listener "$MCP_PORT"
ACTIVE_MCP_PID="$STARTED_PID"
printf '%s\n' "$ACTIVE_MCP_PID" > "$TEST_TMP/main.pid"
rm -f "$TEST_TMP/systemd-run.log"
OUTPUT="$TEST_TMP/background-active-unhealthy.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=1 \
  STRATCRAFT_WEBDASH_STARTUP_ATTEMPTS=2
STATUS=$?
set -e
assert_status 1 "$STATUS" "active but unhealthy background start"
assert_contains "$OUTPUT" "active but Guide WebUI is not ready"
[ ! -e "$TEST_TMP/systemd-run.log" ] || fail "Unhealthy active unit was restarted"
kill -0 "$ACTIVE_MCP_PID" 2>/dev/null || fail "Unhealthy active-unit check killed its listener"
stop_owned_pid "$ACTIVE_MCP_PID"
rm -f "$TEST_TMP/main.pid"
pass "Active background unit must expose both endpoints and is never restarted"

# TICKET_1373 R4/AC5/AC6: an incumbent Guide whose every dependency is healthy
# but whose application does not render in a browser is NOT ready. This is the
# exact shape of the incident: Service API, MCP, and Vite all reported ready
# and the user still saw a white screen. The failure must be explicit and must
# not restart the incumbent (TICKET_1297).
read -r MCP_PORT VITE_PORT < <(allocate_ports)
start_foreign_listener "$MCP_PORT"
ACTIVE_MCP_PID="$STARTED_PID"
start_foreign_listener "$VITE_PORT"
ACTIVE_VITE_PID="$STARTED_PID"
"$FAKE_SERVICE_API" > "$TEST_TMP/browser-service.log" 2>&1 &
ACTIVE_SERVICE_PID=$!
OWNED_PIDS+=("$ACTIVE_SERVICE_PID")
webdash_wait_for_service_api \
  "$STRATCRAFT_SERVICE_API_DISCOVERY_DIR" "$ACTIVE_SERVICE_PID" 30 0.02 curl \
  >/dev/null || fail "Browser-gate Service API fixture did not become healthy"
printf '%s\n' "$ACTIVE_MCP_PID" > "$TEST_TMP/main.pid"
rm -f "$TEST_TMP/systemd-run.log" "$TEST_TMP/browser-probe.log"
OUTPUT="$TEST_TMP/background-active-white-screen.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=1 \
  FAKE_BROWSER_READINESS_RESULT=broken \
  FAKE_BROWSER_READINESS_LOG="$TEST_TMP/browser-probe.log"
STATUS=$?
set -e
assert_status 1 "$STATUS" "active but non-rendering background start"
assert_contains "$OUTPUT" "does not render"
assert_contains "$TEST_TMP/browser-probe.log" "broken"
[ ! -e "$TEST_TMP/systemd-run.log" ] || fail "Non-rendering active unit was restarted"
kill -0 "$ACTIVE_MCP_PID" 2>/dev/null || fail "Browser gate killed the incumbent MCP listener"
kill -0 "$ACTIVE_VITE_PID" 2>/dev/null || fail "Browser gate killed the incumbent Vite listener"

# An unavailable probe is missing evidence, not evidence of failure: a machine
# without Chromium must not be reported as a broken Guide.
rm -f "$TEST_TMP/systemd-run.log"
OUTPUT="$TEST_TMP/background-active-probe-unavailable.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=1 \
  FAKE_BROWSER_READINESS_RESULT=unavailable
STATUS=$?
set -e
assert_status 0 "$STATUS" "active start with unavailable browser probe"
assert_contains "$OUTPUT" "could not be verified"
assert_contains "$OUTPUT" "already active and ready"
[ ! -e "$TEST_TMP/systemd-run.log" ] || fail "Unavailable probe caused a restart"

stop_owned_pid "$ACTIVE_MCP_PID"
stop_owned_pid "$ACTIVE_VITE_PID"
stop_owned_pid "$ACTIVE_SERVICE_PID"
rm -f "$TEST_TMP/main.pid"
pass "Guide readiness includes browser rendering and never restarts an incumbent"

# A systemd-run failure and either child failing during background startup are
# propagated and scoped cleanup is requested for the development unit.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
rm -f "$TEST_TMP/main.pid"
OUTPUT="$TEST_TMP/systemd-run-failure.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=0 \
  FAKE_SYSTEMD_RUN_STATUS=9
STATUS=$?
set -e
assert_status 9 "$STATUS" "systemd-run failure"

read -r MCP_PORT VITE_PORT < <(allocate_ports)
rm -f "$TEST_TMP/main.pid"
OUTPUT="$TEST_TMP/background-mcp-failure.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=0 \
  FAKE_MCP_FAIL_BEFORE_LISTEN_CODE=33
STATUS=$?
set -e
assert_status 1 "$STATUS" "background MCP startup failure"
assert_contains "$OUTPUT" "failed to start MCP"
assert_not_contains "$OUTPUT" "not a child of this shell"
assert_not_contains "$OUTPUT" "status 127"

read -r MCP_PORT VITE_PORT < <(allocate_ports)
rm -f "$TEST_TMP/main.pid"
OUTPUT="$TEST_TMP/background-vite-failure.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=0 \
  FAKE_VITE_FAIL_BEFORE_LISTEN_CODE=34
STATUS=$?
set -e
assert_status 1 "$STATUS" "background Vite startup failure"
assert_contains "$OUTPUT" "failed to start Vite"
assert_not_contains "$OUTPUT" "not a child of this shell"
assert_not_contains "$OUTPUT" "status 127"
wait_for_port_release "$MCP_PORT" || fail "Background MCP remained after Vite startup failure"

# TICKET_1373 R4: a freshly started unit that binds every port but serves a
# non-rendering application must fail too. Here the unit belongs to this
# invocation, so scoped cleanup of its own process is correct.
read -r MCP_PORT VITE_PORT < <(allocate_ports)
rm -f "$TEST_TMP/main.pid" "$TEST_TMP/systemctl.log"
OUTPUT="$TEST_TMP/background-fresh-white-screen.log"
set +e
run_background "$OUTPUT" "$MCP_PORT" "$VITE_PORT" start \
  FAKE_SYSTEMCTL_ACTIVE=0 \
  FAKE_BROWSER_READINESS_RESULT=broken
STATUS=$?
set -e
assert_status 1 "$STATUS" "background fresh start with non-rendering application"
assert_contains "$OUTPUT" "does not render"
assert_contains "$TEST_TMP/systemctl.log" "stop stratcraft-webdash-dev.service"
wait_for_port_release "$MCP_PORT" || fail "Background MCP remained after browser readiness failure"
wait_for_port_release "$VITE_PORT" || fail "Background Vite remained after browser readiness failure"
pass "Background startup failures propagate and request unit-scoped cleanup"

# Background error propagation: invalid action, unit query failure, stop
# failure, status, and logs retain their owning command's status.
OUTPUT="$TEST_TMP/background-invalid.log"
set +e
run_background "$OUTPUT" 17889 17990 invalid
STATUS=$?
set -e
assert_status 2 "$STATUS" "invalid background action"

OUTPUT="$TEST_TMP/background-query-fail.log"
set +e
run_background "$OUTPUT" 17889 17990 stop \
  FAKE_SYSTEMCTL_SHOW_STATUS=7
STATUS=$?
set -e
assert_status 1 "$STATUS" "unit query failure"
assert_contains "$OUTPUT" "Cannot query"

OUTPUT="$TEST_TMP/background-stop-fail.log"
set +e
run_background "$OUTPUT" 17889 17990 stop \
  FAKE_SYSTEMCTL_LOAD_STATE=loaded \
  FAKE_SYSTEMCTL_STOP_STATUS=8
STATUS=$?
set -e
assert_status 1 "$STATUS" "unit stop failure"
assert_contains "$OUTPUT" "Failed to stop"

OUTPUT="$TEST_TMP/background-status.log"
set +e
run_background "$OUTPUT" 17889 17990 status FAKE_SYSTEMCTL_STATUS_STATUS=6
STATUS=$?
set -e
assert_status 6 "$STATUS" "status propagation"

OUTPUT="$TEST_TMP/background-logs.log"
set +e
run_background "$OUTPUT" 17889 17990 logs FAKE_JOURNALCTL_STATUS=5
STATUS=$?
set -e
assert_status 5 "$STATUS" "logs propagation"
pass "Background command failures propagate explicitly"

echo "All $PASS_COUNT lifecycle tests passed."
