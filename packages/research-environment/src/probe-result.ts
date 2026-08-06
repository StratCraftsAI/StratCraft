/**
 * TICKET_1335 L4: turn raw probe output into the shared contract's capability
 * record and, on failure, into a structured `ResearchEnvironmentFailure`.
 *
 * This is the module that makes `ready` mean something. The contract schema
 * refuses to call an environment `ready` unless every capability is `ready` with
 * a non-empty installed version, so the only way to produce a `ready` status is
 * to have actually read five versions back from the locked interpreter. There is
 * no code path here that can assert readiness from filesystem existence, which
 * TICKET_1335_1 explicitly forbids the UI from doing and which the service must
 * not do either.
 */

import {
  RESEARCH_CAPABILITIES,
  type ResearchCapability,
  type ResearchCapabilityStatus,
  type ResearchEnvironmentFailure,
  type ResearchEnvironmentProjection,
} from '@StratCraft/types';

import { PROBE_RESULT_BEGIN, PROBE_RESULT_END } from './probe-program';

// -----------------------------------------------------------------------------
// Raw probe shape
// -----------------------------------------------------------------------------

/**
 * `cause` values the probe may report, mirroring the contract's
 * `verification_failed` causes exactly. `backend_init` exists only for PySR's
 * Julia layer.
 */
const PROBE_CAUSES = ['import', 'probe', 'backend_init'] as const;

type ProbeCause = (typeof PROBE_CAUSES)[number];

interface RawCapabilityResult {
  ok: boolean;
  cause?: ProbeCause;
  message?: string;
  version?: string;
  verification?: string;
  backend_ok?: boolean;
}

export interface ParsedProbeOutput {
  interpreter: string;
  pythonVersion: string;
  capabilities: Record<ResearchCapability, RawCapabilityResult>;
}

export const RESEARCH_ENV_PROBE_ERROR_CODES = {
  NO_PAYLOAD: 'RESEARCH_ENV_PROBE_NO_PAYLOAD',
  MALFORMED_PAYLOAD: 'RESEARCH_ENV_PROBE_MALFORMED_PAYLOAD',
} as const;

export type ResearchEnvironmentProbeErrorCode =
  (typeof RESEARCH_ENV_PROBE_ERROR_CODES)[keyof typeof RESEARCH_ENV_PROBE_ERROR_CODES];

export class ResearchEnvironmentProbeError extends Error {
  constructor(
    readonly code: ResearchEnvironmentProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ResearchEnvironmentProbeError';
  }
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

function isProbeCause(value: unknown): value is ProbeCause {
  return typeof value === 'string' && (PROBE_CAUSES as readonly string[]).includes(value);
}

/**
 * Extract the delimited JSON payload from probe stdout.
 *
 * Delimiters rather than parsing all of stdout, because the probe cannot
 * guarantee exclusive use of it: initializing the Julia backend prints
 * precompilation notices, and `pandas_ta` emits warnings on some pandas
 * versions. `JSON.parse(stdout)` would fail on the first such line -- reporting a
 * healthy environment as unverifiable -- so the payload is framed instead.
 *
 * `lastIndexOf` on the begin marker: if the program were somehow run twice into
 * one buffer, the final payload is the current one.
 */
export function parseProbeOutput(stdout: string): ParsedProbeOutput {
  const begin = stdout.lastIndexOf(PROBE_RESULT_BEGIN);
  const end = stdout.indexOf(PROBE_RESULT_END, begin >= 0 ? begin : 0);
  if (begin < 0 || end < 0) {
    throw new ResearchEnvironmentProbeError(
      RESEARCH_ENV_PROBE_ERROR_CODES.NO_PAYLOAD,
      'The readiness verifier produced no result payload. The interpreter may '
      + 'have crashed before completing the probe.',
    );
  }

  const json = stdout.slice(begin + PROBE_RESULT_BEGIN.length, end).trim();
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch (error) {
    throw new ResearchEnvironmentProbeError(
      RESEARCH_ENV_PROBE_ERROR_CODES.MALFORMED_PAYLOAD,
      `The readiness verifier emitted an undecodable result payload: ${(error as Error).message}`,
    );
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw new ResearchEnvironmentProbeError(
      RESEARCH_ENV_PROBE_ERROR_CODES.MALFORMED_PAYLOAD,
      'The readiness verifier result payload was not an object.',
    );
  }

  const record = decoded as Record<string, unknown>;
  const rawCapabilities = record.capabilities;
  if (typeof rawCapabilities !== 'object' || rawCapabilities === null) {
    throw new ResearchEnvironmentProbeError(
      RESEARCH_ENV_PROBE_ERROR_CODES.MALFORMED_PAYLOAD,
      'The readiness verifier result payload carried no capability results.',
    );
  }
  const capabilityRecord = rawCapabilities as Record<string, unknown>;

  // Every contract capability must be present. A capability the probe simply
  // omitted is treated as malformed output rather than as absent or ready:
  // silently defaulting it would let a truncated probe certify an environment,
  // and the contract requires an entry for every capability so that any
  // capability blamed by a failure has a renderable card.
  const capabilities: Partial<Record<ResearchCapability, RawCapabilityResult>> = {};
  const missing: ResearchCapability[] = [];
  for (const capability of RESEARCH_CAPABILITIES) {
    const entry = capabilityRecord[capability];
    if (typeof entry !== 'object' || entry === null || typeof (entry as { ok?: unknown }).ok !== 'boolean') {
      missing.push(capability);
      continue;
    }
    const raw = entry as Record<string, unknown>;
    capabilities[capability] = {
      ok: raw.ok as boolean,
      cause: isProbeCause(raw.cause) ? raw.cause : undefined,
      message: typeof raw.message === 'string' ? raw.message : undefined,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      verification: typeof raw.verification === 'string' ? raw.verification : undefined,
      backend_ok: typeof raw.backend_ok === 'boolean' ? raw.backend_ok : undefined,
    };
  }

  if (missing.length > 0) {
    throw new ResearchEnvironmentProbeError(
      RESEARCH_ENV_PROBE_ERROR_CODES.MALFORMED_PAYLOAD,
      `The readiness verifier omitted results for: ${missing.join(', ')}.`,
    );
  }

  return {
    interpreter: typeof record.interpreter === 'string' ? record.interpreter : '',
    pythonVersion: typeof record.pythonVersion === 'string' ? record.pythonVersion : '',
    capabilities: capabilities as Record<ResearchCapability, RawCapabilityResult>,
  };
}

// -----------------------------------------------------------------------------
// Contract projection
// -----------------------------------------------------------------------------

/**
 * PySR is the only capability whose failure can land in either verification
 * stage, because it has two runtime layers. `backend_init` is a Julia-layer
 * fault and belongs to `julia_verify`; everything else is Python-layer and
 * belongs to `python_verify`.
 *
 * TICKET_1335_1 AC8 depends on this separation being real rather than cosmetic:
 * PySR must be unable to display Ready when backend initialization failed, and
 * the two stages must be distinguishable in the failure.
 */
export function stageForProbeCause(cause: ProbeCause): 'python_verify' | 'julia_verify' {
  return cause === 'backend_init' ? 'julia_verify' : 'python_verify';
}

export interface CapabilityProjection {
  capabilities: Record<ResearchCapability, ResearchCapabilityStatus>;
  /** The first failing capability, or `undefined` when all capabilities verified. */
  failure?: ResearchEnvironmentFailure;
}

/**
 * Project probe results onto the contract, using lock-derived expected versions.
 *
 * A capability is `ready` only when the probe reported success *and* returned an
 * installed version. Success without a version is treated as a failure rather
 * than as a ready capability with the field omitted: the contract requires a
 * version for a ready capability, so omitting it would produce a status the
 * boundary parser rejects -- surfacing later as an opaque validation error rather
 * than as the actionable verification failure it is. This is the case that made
 * distribution-metadata version reads mandatory, since `pandas_ta` exposes no
 * `__version__`.
 */
export function projectProbeResults(input: {
  parsed: ParsedProbeOutput;
  expectedVersions: Record<ResearchCapability, string>;
  projection?: ResearchEnvironmentProjection;
}): CapabilityProjection {
  const { parsed, expectedVersions, projection = 'default' } = input;
  const capabilities: Partial<Record<ResearchCapability, ResearchCapabilityStatus>> = {};
  let failure: ResearchEnvironmentFailure | undefined;

  for (const capability of RESEARCH_CAPABILITIES) {
    const raw = parsed.capabilities[capability];
    const expected = expectedVersions[capability];

    if (projection === 'without-gpquant' && capability === 'gpquant') {
      if (raw.ok) {
        const message = 'GPQuant imported in the without-gpquant projection; the locked removal postcondition failed.';
        capabilities[capability] = {
          expected,
          ...(raw.version ? { installed: raw.version } : {}),
          state: 'failed',
          verification: message,
        };
        failure ??= {
          category: 'verification_failed',
          stage: 'python_verify',
          cause: 'probe',
          capability,
          message,
          remediation: 'Do not publish this projection. Re-solve and review the repository lock so GPQuant is excluded.',
        };
        continue;
      }
      capabilities[capability] = {
        expected,
        state: 'intentionally_absent',
        verification: 'Excluded by the active repository-locked without-gpquant projection.',
      };
      continue;
    }

    if (raw.ok && raw.version) {
      capabilities[capability] = {
        expected,
        installed: raw.version,
        state: 'ready',
        verification: raw.verification ?? 'Verified against the locked interpreter.',
      };
      continue;
    }

    // Iteration order follows RESEARCH_CAPABILITIES, so "first failure" is
    // deterministic rather than dependent on object key order.
    const cause: ProbeCause = raw.ok && !raw.version ? 'probe' : (raw.cause ?? 'probe');
    const message = raw.ok && !raw.version
      ? `${capability} verified but reported no installed version, so its readiness cannot be `
        + 'attested. The distribution metadata may be damaged.'
      : (raw.message ?? `${capability} failed verification against the locked interpreter.`);

    capabilities[capability] = {
      expected,
      ...(raw.version ? { installed: raw.version } : {}),
      state: 'failed',
      verification: message.slice(0, 1_800),
    };

    if (!failure) {
      failure = {
        category: 'verification_failed',
        stage: stageForProbeCause(cause),
        cause,
        capability,
        message: message.slice(0, 1_800),
        remediation: remediationForCause(capability, cause),
      };
    }
  }

  return {
    capabilities: capabilities as Record<ResearchCapability, ResearchCapabilityStatus>,
    ...(failure ? { failure } : {}),
  };
}

/**
 * Remediation text per failure cause.
 *
 * Produced here, by the layer that knows what actually failed, rather than
 * assembled by each surface. Surfaces render this string but never parse it
 * (TICKET_1335 AC5); the decision they branch on is `cause`.
 */
function remediationForCause(capability: ResearchCapability, cause: ProbeCause): string {
  switch (cause) {
    case 'import':
      return `${capability} could not be imported by the locked interpreter. Run Repair `
        + 'Environment to revalidate and restore the environment from the committed lock.';
    case 'backend_init':
      return 'The PySR Julia backend failed to initialize. The Julia depot is downloaded and '
        + 'precompiled on first use, so this can also mean the download was interrupted. '
        + 'Run Repair Environment, and check available disk space -- the depot needs '
        + 'roughly 1.5 GB.';
    case 'probe':
    default:
      return `${capability} imported but failed its readiness probe, so the installed version is `
        + 'present but not usable. Run Repair Environment to revalidate the environment against '
        + 'the committed lock.';
  }
}

/**
 * The capability record for an environment that has not been verified.
 *
 * Every capability carries its lock-derived `expected` version and the supplied
 * state, with no `installed` value -- because nothing has read one back. This is
 * what an `absent` or in-flight environment reports, and it is the reason the UI
 * can show expected versions before anything is installed.
 */
export function uniformCapabilities(
  expectedVersions: Record<ResearchCapability, string>,
  state: ResearchCapabilityStatus['state'],
  verification?: string,
): Record<ResearchCapability, ResearchCapabilityStatus> {
  return Object.fromEntries(
    RESEARCH_CAPABILITIES.map(capability => [
      capability,
      {
        expected: expectedVersions[capability],
        state,
        ...(verification ? { verification } : {}),
      } satisfies ResearchCapabilityStatus,
    ]),
  ) as Record<ResearchCapability, ResearchCapabilityStatus>;
}
