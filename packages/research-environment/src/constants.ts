/**
 * TICKET_1335 L3/L4 constants. TICKET_179 forbids these living inline at their
 * use sites: the reconciler's staleness threshold and the heartbeat period are a
 * matched pair, and a surface that inlined either could silently disagree with
 * the process that writes the heartbeat.
 */

/**
 * How often a live owner refreshes `heartbeat_at` while an operation runs.
 *
 * A Pixi materialization is CPU- and network-bound for minutes, so the heartbeat
 * has to come from a timer that is independent of the child process making
 * progress -- an owner that is merely blocked on a slow download is alive.
 */
export const RESEARCH_ENV_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * How long a job may go without a heartbeat before reconciliation may declare
 * its owner lost.
 *
 * Deliberately a large multiple of the heartbeat interval rather than a tight
 * bound. The failure this guards against is a *wrongly* reclaimed job: a live
 * installer whose heartbeat timer was starved by a saturated event loop would,
 * under a tight threshold, have its row marked failed while its child process
 * kept writing to `.pixi`. That produces exactly the two-concurrent-installers
 * state TICKET_1335 D4 exists to prevent, so the threshold errs toward leaving
 * a possibly-dead job alone. Crash recovery is not latency-sensitive; a
 * corrupted environment is.
 */
export const RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS = 90_000;

/**
 * Bound on the persisted log tail, in lines. Mirrors the contract bound in
 * `@StratCraft/types` (`RESEARCH_ENV_MAX_LOG_LINES`) and is asserted equal to it
 * in `job-repository.test.ts` so the store cannot persist a tail the contract
 * would later reject at the boundary.
 */
export const RESEARCH_ENV_PERSISTED_LOG_LINES = 200;

// -----------------------------------------------------------------------------
// L4: canonical file and executable names
// -----------------------------------------------------------------------------

/**
 * The committed manifest and lock, relative to the repository root. Fixed names
 * rather than configuration: TICKET_1335 D3 requires the manifest path to be
 * resolved from the repository root and never taken from a caller, so that an
 * MCP or IPC request cannot redirect an install at a different manifest.
 */
export const PIXI_MANIFEST_FILE_NAME = 'pixi.toml';
export const PIXI_LOCK_FILE_NAME = 'pixi.lock';

/** Materialized environment directory, created and owned by pixi. */
export const PIXI_ENVIRONMENT_DIR_NAME = '.pixi';

/**
 * The manifest declares no named environments, so pixi materializes the implicit
 * `default` environment. `scripts/research/resolve-toolchain.sh` resolves the
 * same `.pixi/envs/default` path; both must agree or the app and the shell
 * harness would probe different interpreters.
 */
export const PIXI_DEFAULT_ENV_NAME = 'default';
export const PIXI_WITHOUT_GPQUANT_ENV_NAME = 'without-gpquant';
export const PIXI_ENVIRONMENT_FLAG = '--environment';

export const PIXI_EXECUTABLE_NAME = 'pixi';

/**
 * Where pixi's own installer places the executable for a per-user install.
 *
 * Consulted only after a `PATH` lookup fails. This is not a fallback that masks
 * a defect (TICKET_856): pixi appends `~/.pixi/bin` to interactive shell
 * profiles only, so a GUI-launched Electron process legitimately inherits an
 * environment where the executable exists and is simply not on `PATH`.
 */
export const PIXI_FALLBACK_EXECUTABLE_PATHS: readonly (readonly string[])[] = [
  ['.pixi', 'bin', 'pixi'],
];

/**
 * Interpreter location inside the materialized environment. Split by platform
 * because conda-style environments place the interpreter at `bin/python` on
 * POSIX and `python.exe` at the environment root on Windows.
 */
export const RESEARCH_ENV_INTERPRETER_RELATIVE_POSIX: readonly string[] = ['bin', 'python'];
export const RESEARCH_ENV_INTERPRETER_RELATIVE_WINDOWS: readonly string[] = ['python.exe'];

// -----------------------------------------------------------------------------
// L4: process execution
// -----------------------------------------------------------------------------

/**
 * Argument vectors for the two materializing operations.
 *
 * `--locked` is mandatory on both (TICKET_1335 D3). Bare `pixi install`
 * silently re-solves and *rewrites* `pixi.lock` when the manifest has drifted,
 * turning an in-app install into an unreviewed dependency change; that exact
 * hole was found and closed at `start.sh:224`. Verified behaviourally in the
 * ticket's D3 record: with a deliberately drifted manifest, `--locked` exits 1
 * and leaves `pixi.lock` byte-identical.
 *
 * Repair uses `pixi reinstall --locked`, which re-materializes the environment
 * from the same committed lock rather than assuming existing artifacts are
 * intact -- that is what makes repair a distinct operation instead of install
 * with different button text (TICKET_1335_1 D4).
 *
 * It was `install --locked --revalidate` until 2026-07-31. That flag does not
 * exist: real pixi 0.75.0 rejects it with `error: unexpected argument
 * '--revalidate' found` and exits 2, so EVERY repair failed before doing any
 * work. Unit tests could not catch it -- they assert on the argument vector the
 * constant produces, so they agreed with whatever it said. It was found by
 * running a repair against a deliberately corrupted environment (AC7b), and the
 * replacement was verified the same way: with `duckdb` deleted from a
 * materialized environment, `pixi reinstall --locked` exits 0, restores duckdb
 * 1.5.3 to a working import and query, and leaves `pixi.toml`/`pixi.lock`
 * byte-identical.
 *
 * `--locked` remains mandatory here for the same reason as install: `pixi
 * reinstall` without it will update the lock file.
 */
export const PIXI_INSTALL_ARGS: readonly string[] = ['install', '--locked'];
export const PIXI_REPAIR_ARGS: readonly string[] = ['reinstall', '--locked'];
export const PIXI_UNINSTALL_ARGS: readonly string[] = ['clean'];
export const PIXI_MANIFEST_PATH_FLAG = '--manifest-path';
export const PIXI_VERSION_ARGS: readonly string[] = ['--version'];

/**
 * Ceiling on a single `pixi install --locked`.
 *
 * Not a latency knob (TICKET_855 forbids tuning a timeout to make a slow
 * operation pass). It is a liveness bound on a process that must eventually
 * terminate: the measured cold install in the ticket's D0 record is 4 m 09 s
 * against a warm rattler cache, and a first-ever run additionally downloads
 * ~6.9 GB of packages plus a 1.4 GB Julia depot. 90 minutes is far above any
 * observed run, so exceeding it means the child is wedged rather than slow.
 */
export const PIXI_INSTALL_TIMEOUT_MS = 90 * 60 * 1_000;

/**
 * Ceiling on the readiness verifier.
 *
 * Larger than intuition suggests because the PySR probe initializes the Julia
 * backend. On a cold depot `juliapkg` downloads Julia, resolves and precompiles
 * `SymbolicRegression` + `PythonCall` before any regression runs -- the 1.4 GB
 * download recorded in D0. Verification after that is seconds.
 */
export const RESEARCH_ENV_VERIFY_TIMEOUT_MS = 60 * 60 * 1_000;

/** Ceiling on `pixi --version`, which does no I/O beyond process start. */
export const PIXI_VERSION_TIMEOUT_MS = 30 * 1_000;

/**
 * Bound on captured child output, in bytes, before the tail is truncated.
 *
 * A wedged installer can emit progress output indefinitely; retaining all of it
 * would grow main-process memory without bound. Only the tail is persisted
 * anyway (`RESEARCH_ENV_PERSISTED_LOG_LINES`).
 */
export const RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES = 1_000_000;
