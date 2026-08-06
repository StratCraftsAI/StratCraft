/**
 * TICKET_1335 L4: canonical environment identity -- paths, executables, hashes,
 * and the lock-derived expected versions.
 *
 * This module answers "which files and which executables are authoritative"
 * exactly once. TICKET_1335's root-cause section records what happens when it is
 * answered per-surface: package identity lived partly in a SQLite registry row
 * and partly in `pixi.toml`, and an ambient `pip` exit code was treated as
 * readiness even though research jobs resolve a different, Pixi-managed
 * interpreter. Everything here is derived from the repository root, never from a
 * caller argument, so an MCP or IPC request cannot redirect an install
 * (TICKET_1335 D3: "the repository root and manifest path are resolved by
 * existing runtime path utilities and are not user inputs").
 */

import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import {
  DEFAULT_RESEARCH_ENVIRONMENT_PROJECTION,
  RESEARCH_ENVIRONMENT_PROJECTIONS,
  RESEARCH_ENV_MAX_VERSION_CHARS,
  RESEARCH_CAPABILITIES,
  type ResearchCapability,
  type ResearchEnvironmentProjection,
} from '@StratCraft/types';

import {
  PIXI_ENVIRONMENT_DIR_NAME,
  PIXI_DEFAULT_ENV_NAME,
  PIXI_WITHOUT_GPQUANT_ENV_NAME,
  PIXI_EXECUTABLE_NAME,
  PIXI_FALLBACK_EXECUTABLE_PATHS,
  PIXI_LOCK_FILE_NAME,
  PIXI_MANIFEST_FILE_NAME,
  RESEARCH_ENV_INTERPRETER_RELATIVE_POSIX,
  RESEARCH_ENV_INTERPRETER_RELATIVE_WINDOWS,
} from './constants';

// -----------------------------------------------------------------------------
// Injected host surface
// -----------------------------------------------------------------------------

/**
 * The filesystem and platform facts this module reads.
 *
 * Injected rather than importing `node:fs` directly so that every branch --
 * missing lock, missing pixi, unsupported platform, unreadable file -- is
 * reachable in a test without touching the real repository. TICKET_1335 D6
 * requires each of those to produce a *distinct* visible failure, which is only
 * provable if each is independently inducible.
 */
export interface EnvironmentHost {
  fileExists(path: string): boolean;
  /** Canonical filesystem path, following every symlink in an existing path. */
  realPath(path: string): string;
  isExecutable(path: string): boolean;
  readFile(path: string): string;
  /** `process.platform` value. */
  platform: string;
  /** `process.arch` value. */
  architecture: string;
  /** `PATH`-resolved executable lookup, or `undefined`. */
  which(executable: string): string | undefined;
  /** Home directory, used only for the documented fallback install locations. */
  homeDirectory?: string;
}

export interface EnvironmentPathsDeps {
  repositoryRoot: string;
  host: EnvironmentHost;
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export const RESEARCH_ENV_PATH_ERROR_CODES = {
  MANIFEST_MISSING: 'RESEARCH_ENV_MANIFEST_MISSING',
  LOCK_MISSING: 'RESEARCH_ENV_LOCK_MISSING',
  PIXI_MISSING: 'RESEARCH_ENV_PIXI_MISSING',
  LOCK_UNREADABLE: 'RESEARCH_ENV_LOCK_UNREADABLE',
  LOCK_CAPABILITY_MISSING: 'RESEARCH_ENV_LOCK_CAPABILITY_MISSING',
  TARGET_PATH_ESCAPE: 'RESEARCH_ENV_TARGET_PATH_ESCAPE',
} as const;

export type ResearchEnvironmentPathErrorCode =
  (typeof RESEARCH_ENV_PATH_ERROR_CODES)[keyof typeof RESEARCH_ENV_PATH_ERROR_CODES];

/**
 * Carries a machine-readable code so the service can map it to a contract
 * failure category without matching on message text, which TICKET_1335 AC5
 * forbids.
 */
export class ResearchEnvironmentPathError extends Error {
  constructor(
    readonly code: ResearchEnvironmentPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ResearchEnvironmentPathError';
  }
}

/**
 * Proves that a registered projection is the corresponding direct child of
 * this workspace's canonical Pixi environment directory. This rejects both a
 * symlink at the environment itself and an ancestor alias that resolves the
 * deletion target outside the repository-owned scope.
 */
export function validateEnvironmentRemovalTarget(
  host: Pick<EnvironmentHost, 'fileExists' | 'realPath'>,
  paths: Pick<ResearchEnvironmentPaths, 'repositoryRoot' | 'environmentRoot'>,
  projection: ResearchEnvironmentProjection,
): void {
  if (!(RESEARCH_ENVIRONMENT_PROJECTIONS as readonly string[]).includes(projection)) {
    throw new ResearchEnvironmentPathError(
      RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
      `Refusing to remove an unregistered research environment projection: ${String(projection)}`,
    );
  }

  const environmentName = projection === 'without-gpquant'
    ? PIXI_WITHOUT_GPQUANT_ENV_NAME
    : PIXI_DEFAULT_ENV_NAME;
  const declaredParent = join(
    paths.repositoryRoot,
    PIXI_ENVIRONMENT_DIR_NAME,
    'envs',
  );
  const declaredTarget = join(declaredParent, environmentName);
  if (resolve(paths.environmentRoot) !== resolve(declaredTarget)) {
    throw new ResearchEnvironmentPathError(
      RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
      `Refusing to remove research environment outside its registered workspace target: ${paths.environmentRoot}`,
    );
  }
  if (!host.fileExists(paths.environmentRoot)) {
    return;
  }
  const canonicalParent = host.realPath(declaredParent);
  const canonicalTarget = host.realPath(paths.environmentRoot);
  const expectedTarget = join(canonicalParent, environmentName);
  if (canonicalTarget !== expectedTarget) {
    throw new ResearchEnvironmentPathError(
      RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
      `Refusing to remove research environment outside its canonical workspace target: ${canonicalTarget}`,
    );
  }
}

// -----------------------------------------------------------------------------
// Supported platforms
// -----------------------------------------------------------------------------

/**
 * The manifest declares `platforms = ["linux-64"]`. A lock solved for one
 * platform cannot materialize on another, so support is a property of the
 * committed lock rather than a policy choice made here.
 *
 * TICKET_1335 D7 makes this an *environment-level* verdict: on an unsupported
 * host every capability stays `absent` and the environment carries
 * `unsupported_platform`, so an unsupported machine is never mistaken for a
 * broken package. The contract schema enforces that pairing.
 */
export const SUPPORTED_PLATFORM_TARGETS: Readonly<Record<string, readonly string[]>> = {
  linux: ['x64'],
};

export function isSupportedPlatform(platform: string, architecture: string): boolean {
  return SUPPORTED_PLATFORM_TARGETS[platform]?.includes(architecture) ?? false;
}

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export interface ResearchEnvironmentPaths {
  repositoryRoot: string;
  manifestPath: string;
  lockPath: string;
  environmentRoot: string;
  interpreterPath: string;
}

/**
 * Locate the repository root: the nearest ancestor of `startDir` containing
 * both `pixi.toml` and `pixi.lock`.
 *
 * Every surface needs this and none of them can hardcode it. Electron main runs
 * from `app.getAppPath()`, the headless `serve` host runs from its own build
 * output, the standalone MCP server runs from a third location, and tests run
 * from a package directory -- so a per-call-site `join(appPath, '..', '..')`
 * would be four guesses that silently disagree. Searching upward for the
 * governed pair is host-independent by construction: the thing being located is
 * defined by the presence of the files that define it.
 *
 * Both files are required, not either. A tree containing only `pixi.toml` is a
 * manifest without a solved lock; treating it as the root would resolve an
 * environment the repository never approved, and the resulting failure would be
 * reported against the wrong directory.
 *
 * Returns `null` rather than throwing or defaulting to `startDir`. An absent
 * root is a legitimate state on a packaged install with no source tree, and the
 * caller reports it as a structured contract failure (`manifest_missing`); a
 * silent fallback to the process CWD would spawn pixi in an arbitrary directory.
 */
export function resolveRepositoryRoot(
  startDir: string,
  host: Pick<EnvironmentHost, 'fileExists'>,
): string | null {
  let current = resolve(startDir);
  // Bounded by the filesystem root: `dirname('/') === '/'`, so equality is the
  // documented termination condition rather than an arbitrary depth limit.
  for (;;) {
    const hasManifest = host.fileExists(join(current, PIXI_MANIFEST_FILE_NAME));
    const hasLock = host.fileExists(join(current, PIXI_LOCK_FILE_NAME));
    if (hasManifest && hasLock) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolve the canonical file locations. Pure path algebra -- no existence check,
 * because callers need the paths in order to *report* that one is missing.
 */
export function resolveEnvironmentPaths(deps: EnvironmentPathsDeps): ResearchEnvironmentPaths {
  return resolveProjectionEnvironmentPaths(deps, DEFAULT_RESEARCH_ENVIRONMENT_PROJECTION);
}

export function resolveProjectionEnvironmentPaths(
  deps: EnvironmentPathsDeps,
  projection: ResearchEnvironmentProjection,
): ResearchEnvironmentPaths {
  const { repositoryRoot, host } = deps;
  const environmentName = projection === 'without-gpquant'
    ? PIXI_WITHOUT_GPQUANT_ENV_NAME
    : PIXI_DEFAULT_ENV_NAME;
  const interpreterRelative = host.platform === 'win32'
    ? RESEARCH_ENV_INTERPRETER_RELATIVE_WINDOWS
    : RESEARCH_ENV_INTERPRETER_RELATIVE_POSIX;

  return {
    repositoryRoot,
    manifestPath: join(repositoryRoot, PIXI_MANIFEST_FILE_NAME),
    lockPath: join(repositoryRoot, PIXI_LOCK_FILE_NAME),
    environmentRoot: join(repositoryRoot, PIXI_ENVIRONMENT_DIR_NAME, 'envs', environmentName),
    interpreterPath: join(
      repositoryRoot,
      PIXI_ENVIRONMENT_DIR_NAME,
      'envs',
      environmentName,
      ...interpreterRelative,
    ),
  };
}

/**
 * Locate the `pixi` executable.
 *
 * `PATH` is consulted first, then the documented per-user install location. The
 * fallback is not a workaround for a broken lookup: pixi's own installer writes
 * to `~/.pixi/bin` and only appends that directory to the *interactive* shell
 * profile, so a GUI-launched Electron process routinely inherits an environment
 * where the executable exists but is not on `PATH`. That is the live condition
 * on the development host (pixi 0.75.0 at `~/.pixi/bin/pixi`, absent from a
 * non-login shell's `PATH`), and treating it as "pixi missing" would report a
 * healthy machine as unusable.
 *
 * Throws `PIXI_MISSING` rather than returning a bare name to spawn: spawning an
 * unresolved `pixi` would defer the failure into the child process, where it
 * arrives as an opaque ENOENT during install instead of a distinct admission
 * failure with remediation (TICKET_1335 D6, TICKET_857).
 */
export function resolvePixiExecutable(host: EnvironmentHost): string {
  const onPath = host.which(PIXI_EXECUTABLE_NAME);
  if (onPath) {
    return onPath;
  }

  const home = host.homeDirectory;
  if (home) {
    for (const relative of PIXI_FALLBACK_EXECUTABLE_PATHS) {
      const candidate = join(home, ...relative);
      if (host.isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  throw new ResearchEnvironmentPathError(
    RESEARCH_ENV_PATH_ERROR_CODES.PIXI_MISSING,
    'The pixi executable was not found on PATH or in the default per-user '
    + 'installation directory. Install pixi from https://pixi.sh and restart '
    + 'the application so it inherits the updated PATH.',
  );
}

// -----------------------------------------------------------------------------
// Hashes
// -----------------------------------------------------------------------------

/**
 * SHA-256 of a canonical file, lowercase hex.
 *
 * Line endings are deliberately NOT normalized. These hashes are bound into a
 * `LocalMutationApproval` (TICKET_1335 D4/D6) so that a manifest edit while a
 * confirmation dialog is open invalidates the approval. Normalizing would make
 * a real byte-level change to the file invisible to that check.
 */
export function hashFile(host: EnvironmentHost, path: string, missingCode: ResearchEnvironmentPathErrorCode): string {
  if (!host.fileExists(path)) {
    throw new ResearchEnvironmentPathError(
      missingCode,
      `Required environment file is missing: ${path}`,
    );
  }
  return createHash('sha256').update(host.readFile(path), 'utf8').digest('hex');
}

export interface EnvironmentIdentity {
  manifestSha256: string;
  lockSha256: string;
}

/**
 * Recompute both hashes from the canonical paths.
 *
 * The service calls this at admission time rather than trusting a hash supplied
 * by an adapter: TICKET_1335 D4 states that "adapters may not prevalidate hashes
 * and assume the service will see the same files".
 */
export function readEnvironmentIdentity(deps: EnvironmentPathsDeps): EnvironmentIdentity {
  const paths = resolveEnvironmentPaths(deps);
  return {
    manifestSha256: hashFile(
      deps.host,
      paths.manifestPath,
      RESEARCH_ENV_PATH_ERROR_CODES.MANIFEST_MISSING,
    ),
    lockSha256: hashFile(
      deps.host,
      paths.lockPath,
      RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING,
    ),
  };
}

// -----------------------------------------------------------------------------
// Lock-derived expected versions
// -----------------------------------------------------------------------------

/**
 * Maps a contract capability to the distribution name that appears in the lock
 * and in installed metadata.
 *
 * Contract keys are stable UI/API identifiers, while lock entries use Python
 * distribution names. The two currently differ for `histdata` and `pandas_ta`;
 * that translation is owned exactly here so callers never reconstruct it.
 */
export const CAPABILITY_DISTRIBUTION_NAMES: Readonly<Record<ResearchCapability, string>> = {
  histdata: 'histdata-supplementary',
  duckdb: 'duckdb',
  gplearn: 'gplearn',
  gpquant: 'gpquant',
  pysr: 'pysr',
  pandas_ta: 'pandas-ta',
};

/**
 * PyPI normalizes distribution names for comparison (PEP 503): runs of `-`, `_`,
 * and `.` collapse to a single `-`, case-insensitively. Applied to both sides of
 * every lock comparison so `pandas_ta`, `pandas-ta`, and `Pandas.TA` are one
 * name rather than three.
 */
export function normalizeDistributionName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Parse the resolved version of every capability out of `pixi.lock`.
 *
 * The lock -- not the manifest -- is the source of `expected`. This is
 * load-bearing rather than stylistic: the manifest pins `gplearn = ">=0.4.2"`,
 * so a manifest-derived `expected` would be the literal string `">=0.4.2"`, and
 * comparing it for equality against the installed `0.4.3` would report a healthy
 * environment as drifted. The lock records the single resolved version that
 * `pixi install --locked` actually materializes, which is the only value an
 * installed version can be meaningfully compared against.
 *
 * Parsing is intentionally narrow: it reads `name:`/`version:` pairs from lock
 * entries and ignores everything else. It is not a YAML implementation, and it
 * must not become one -- a full parser would invite treating the lock as
 * queryable configuration, when the only question asked of it is "which version
 * of these five packages did the solver choose".
 */
export function parseLockedVersions(lockContent: string): Record<ResearchCapability, string> {
  const wanted = new Map<string, ResearchCapability>(
    RESEARCH_CAPABILITIES.map(capability => [
      normalizeDistributionName(CAPABILITY_DISTRIBUTION_NAMES[capability]),
      capability,
    ]),
  );

  const found = new Map<ResearchCapability, string>();
  const lines = lockContent.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    // Lock package entries carry `name:` and `version:` as sibling keys. Match
    // the name first, then look ahead a bounded distance for its version rather
    // than tracking block indentation, which would couple this to the lock's
    // formatting.
    const nameMatch = /^\s*(?:-\s+)?name:\s*(\S+)\s*$/.exec(lines[index]);
    if (!nameMatch) {
      continue;
    }
    const capability = wanted.get(normalizeDistributionName(nameMatch[1]));
    if (!capability || found.has(capability)) {
      continue;
    }
    for (let ahead = index + 1; ahead < Math.min(index + 6, lines.length); ahead += 1) {
      // Stop at the next entry so a version is never stolen from the following
      // package when this one has no `version:` key.
      if (/^\s*(?:-\s+)?name:\s*\S+\s*$/.test(lines[ahead])) {
        break;
      }
      const versionMatch = /^\s*version:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(lines[ahead]);
      if (versionMatch && versionMatch[1].length <= RESEARCH_ENV_MAX_VERSION_CHARS) {
        found.set(capability, versionMatch[1]);
        break;
      }
    }
  }

  const missing = RESEARCH_CAPABILITIES.filter(capability => !found.has(capability));
  if (missing.length > 0) {
    // Fail rather than substituting a placeholder. A capability with no locked
    // version cannot be verified against anything, and the contract requires a
    // non-empty `expected` for every capability -- an invented value would make
    // `ready` reachable without evidence (TICKET_856, TICKET_857).
    throw new ResearchEnvironmentPathError(
      RESEARCH_ENV_PATH_ERROR_CODES.LOCK_CAPABILITY_MISSING,
      'The committed pixi.lock does not resolve a version for: '
      + `${missing.join(', ')}. The lock and the capability contract have `
      + 'diverged; re-solve and commit the lock through dependency review.',
    );
  }

  return Object.fromEntries(
    RESEARCH_CAPABILITIES.map(capability => [capability, found.get(capability) as string]),
  ) as Record<ResearchCapability, string>;
}

/** Read and parse the locked versions from disk. */
export function readLockedVersions(deps: EnvironmentPathsDeps): Record<ResearchCapability, string> {
  const paths = resolveEnvironmentPaths(deps);
  if (!deps.host.fileExists(paths.lockPath)) {
    throw new ResearchEnvironmentPathError(
      RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING,
      `The committed pixi.lock is missing at ${paths.lockPath}. Restore it from `
      + 'version control; the environment must never be solved at runtime.',
    );
  }
  return parseLockedVersions(deps.host.readFile(paths.lockPath));
}
