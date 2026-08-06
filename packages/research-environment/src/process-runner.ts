/**
 * TICKET_1335 L4 / D3: locked, non-shell process execution.
 *
 * One place builds argument vectors and one place runs them. D3 requires the
 * process be "launched with an argument vector (`spawn`/`execFile`), never a
 * shell string" -- with no shell there is no word-splitting, no globbing, and no
 * interpolation of a path into a command line, so a directory name containing a
 * space or a quote cannot become an argument boundary.
 *
 * `--locked` is mandatory and lives in `constants.ts`, not here, so no caller can
 * assemble an unlocked variant. The ticket's D3 record documents why: bare
 * `pixi install` silently re-solves and rewrites `pixi.lock` on manifest drift,
 * turning an install into an unreviewed dependency change. That hole existed at
 * `start.sh:224` and was closed; this module must not reopen it.
 */

import {
  PIXI_ENVIRONMENT_FLAG,
  PIXI_INSTALL_ARGS,
  PIXI_INSTALL_TIMEOUT_MS,
  PIXI_MANIFEST_PATH_FLAG,
  PIXI_REPAIR_ARGS,
  PIXI_UNINSTALL_ARGS,
  PIXI_VERSION_ARGS,
  PIXI_VERSION_TIMEOUT_MS,
  RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES,
  RESEARCH_ENV_VERIFY_TIMEOUT_MS,
} from './constants';

// -----------------------------------------------------------------------------
// Injected process surface
// -----------------------------------------------------------------------------

export interface ProcessResult {
  /** Exit code, or `null` when the process was terminated by a signal. */
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** True when the runner terminated the child for exceeding its time bound. */
  timedOut: boolean;
  /** Set when the process could not be started at all (e.g. ENOENT). */
  spawnError?: string;
}

export interface ProcessSpawnRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Invoked for each captured output line, for the live log tail. */
  onOutputLine?: (line: string) => void;
  /** Invoked once the child has an operating-system PID. */
  onSpawn?: (pid: number) => void;
}

/**
 * Injected rather than importing `node:child_process` so that install, repair,
 * and verification paths are testable without spawning anything.
 *
 * This is also the seam the parent ticket's own regression test relies on: it
 * mocks `child_process` and asserts that no surface spawns a package manager
 * directly. A module that imported `spawn` at top level would be untestable in
 * exactly the dimension that matters.
 */
export interface ProcessRunner {
  run(request: ProcessSpawnRequest): Promise<ProcessResult>;
}

// -----------------------------------------------------------------------------
// Argument vectors
// -----------------------------------------------------------------------------

/**
 * `pixi install --locked --manifest-path <root>/pixi.toml`, verbatim from D3.
 *
 * The manifest path is passed explicitly rather than relying on the working
 * directory. `pixi` discovers a manifest by walking upward from the cwd, so an
 * ambient cwd could silently select a *different* repository's manifest -- the
 * same class of interpreter-identity drift the ticket recorded in
 * `resolve-toolchain.sh`, where a fallback resolved an interpreter other than
 * the one the resolver was told to use.
 */
export function buildInstallArgs(manifestPath: string, environment = 'default'): readonly string[] {
  return [...PIXI_INSTALL_ARGS, PIXI_ENVIRONMENT_FLAG, environment, PIXI_MANIFEST_PATH_FLAG, manifestPath];
}

/**
 * Repair uses `pixi reinstall`, which re-materializes packages instead of
 * assuming already-present artifacts are intact.
 *
 * This is what makes repair a distinct operation rather than install with
 * different button text (TICKET_1335_1 D4): plain `install` is a no-op against
 * an environment pixi already considers materialized, so it would skip the very
 * artifacts suspected of being damaged. Neither form ever changes `pixi.toml`
 * or `pixi.lock`.
 *
 * This was `install --locked --revalidate` until 2026-07-31; that flag does not
 * exist in pixi and made every repair exit 2 before doing any work. See
 * `PIXI_REPAIR_ARGS` in `constants.ts` for the live evidence.
 */
export function buildRepairArgs(manifestPath: string, environment = 'default'): readonly string[] {
  return [...PIXI_REPAIR_ARGS, PIXI_ENVIRONMENT_FLAG, environment, PIXI_MANIFEST_PATH_FLAG, manifestPath];
}

export function buildUninstallArgs(manifestPath: string, environment = 'default'): readonly string[] {
  return [...PIXI_UNINSTALL_ARGS, PIXI_ENVIRONMENT_FLAG, environment, PIXI_MANIFEST_PATH_FLAG, manifestPath];
}

export function buildVersionArgs(): readonly string[] {
  return [...PIXI_VERSION_ARGS];
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

export interface PixiCommandRequest {
  runner: ProcessRunner;
  pixiExecutable: string;
  manifestPath: string;
  repositoryRoot: string;
  onOutputLine?: (line: string) => void;
  onSpawn?: (pid: number) => void;
  environment?: string;
}

export async function runPixiInstall(request: PixiCommandRequest): Promise<ProcessResult> {
  return request.runner.run({
    executable: request.pixiExecutable,
    args: buildInstallArgs(request.manifestPath, request.environment),
    cwd: request.repositoryRoot,
    timeoutMs: PIXI_INSTALL_TIMEOUT_MS,
    maxOutputBytes: RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES,
    onOutputLine: request.onOutputLine,
    onSpawn: request.onSpawn,
  });
}

export async function runPixiRepair(request: PixiCommandRequest): Promise<ProcessResult> {
  return request.runner.run({
    executable: request.pixiExecutable,
    args: buildRepairArgs(request.manifestPath, request.environment),
    cwd: request.repositoryRoot,
    timeoutMs: PIXI_INSTALL_TIMEOUT_MS,
    maxOutputBytes: RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES,
    onOutputLine: request.onOutputLine,
    onSpawn: request.onSpawn,
  });
}

export async function runPixiUninstall(request: PixiCommandRequest): Promise<ProcessResult> {
  return request.runner.run({
    executable: request.pixiExecutable,
    args: buildUninstallArgs(request.manifestPath, request.environment),
    cwd: request.repositoryRoot,
    timeoutMs: PIXI_INSTALL_TIMEOUT_MS,
    maxOutputBytes: RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES,
    onOutputLine: request.onOutputLine,
    onSpawn: request.onSpawn,
  });
}

/**
 * `pixi --version`, recorded in the status for diagnostics.
 *
 * Failure is not fatal to readiness: the version string is reported, not
 * enforced. Gating readiness on a parsed pixi version would add a second
 * compatibility authority beside the committed lock, which is what the lock
 * exists to be.
 */
export async function runPixiVersion(request: Omit<PixiCommandRequest, 'manifestPath'>): Promise<ProcessResult> {
  return request.runner.run({
    executable: request.pixiExecutable,
    args: buildVersionArgs(),
    cwd: request.repositoryRoot,
    timeoutMs: PIXI_VERSION_TIMEOUT_MS,
    maxOutputBytes: RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES,
  });
}

/**
 * Run the readiness verifier with the exact locked interpreter.
 *
 * The interpreter path is the materialized `.pixi/envs/default/bin/python` and
 * never ambient `python`/`pip` (D5, first sentence). The ticket's root-cause
 * section records the consequence of getting this wrong: an ambient `pip` exit
 * code was treated as readiness even though research jobs resolve a different,
 * Pixi-managed interpreter, so the reported versions described an environment
 * nothing actually ran in.
 *
 * `-I` runs in isolated mode: no `PYTHONPATH`, no user site-packages, no
 * implicit cwd on `sys.path`. Without it a stray module in the repository root
 * or an inherited `PYTHONPATH` could satisfy an import that the locked
 * environment does not actually provide, and the probe would certify a
 * capability the real research job cannot use.
 */
export async function runReadinessProbe(request: {
  runner: ProcessRunner;
  interpreterPath: string;
  repositoryRoot: string;
  program: string;
  onOutputLine?: (line: string) => void;
  onSpawn?: (pid: number) => void;
}): Promise<ProcessResult> {
  return request.runner.run({
    executable: request.interpreterPath,
    args: ['-I', '-c', request.program],
    cwd: request.repositoryRoot,
    timeoutMs: RESEARCH_ENV_VERIFY_TIMEOUT_MS,
    maxOutputBytes: RESEARCH_ENV_MAX_CAPTURED_OUTPUT_BYTES,
    onOutputLine: request.onOutputLine,
    onSpawn: request.onSpawn,
  });
}

// -----------------------------------------------------------------------------
// Failure classification
// -----------------------------------------------------------------------------

/**
 * Network-failure detection, the one place output text is inspected.
 *
 * This does not contradict the "never parse message text" rule: that rule
 * governs *consumers* of the contract, which must branch on `category`/`stage`/
 * `cause`. Here we are the producer, turning an opaque exit code into a
 * structured category -- pixi exits 1 for both a download failure and a solve
 * failure, so the distinction exists nowhere else. Classifying it here is what
 * lets every surface downstream branch on `network_failed` without reading text.
 *
 * A missed match degrades to `install_failed`, which is still actionable and
 * still shows the log tail; it never silently succeeds.
 */
const NETWORK_FAILURE_MARKERS: readonly string[] = [
  'failed to download',
  'network error',
  'connection refused',
  'connection reset',
  'connection timed out',
  'temporary failure in name resolution',
  'could not resolve host',
  'dns error',
  'tls connect error',
  'certificate verify failed',
  'error sending request',
  'operation timed out',
];

export function looksLikeNetworkFailure(result: ProcessResult): boolean {
  const haystack = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return NETWORK_FAILURE_MARKERS.some(marker => haystack.includes(marker));
}

/**
 * Lock-drift detection.
 *
 * `pixi install --locked` refuses and exits non-zero when the lock disagrees
 * with the manifest. The ticket's D3 record verified the exact message
 * (`lock file not up-to-date with the workspace`) and, more importantly, that
 * `pixi.lock` is left byte-identical -- so drift is reportable without the lock
 * having been rewritten behind the user's back.
 */
const LOCK_DRIFT_MARKERS: readonly string[] = [
  'lock file not up-to-date',
  'lock-file not up-to-date',
  'lockfile not up-to-date',
];

export function looksLikeLockDrift(result: ProcessResult): boolean {
  const haystack = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return LOCK_DRIFT_MARKERS.some(marker => haystack.includes(marker));
}
