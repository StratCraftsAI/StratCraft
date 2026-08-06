/**
 * TICKET_1317: Shared AI Studio workflow contract.
 *
 * This module is the single internal authority for validating, gating, and
 * reducing the versioned AI Studio workflow snapshot issued by nona_server.
 * Both surfaces consume it unchanged (CLAUDE.md surface-layer rule, AC6):
 *
 *   - Guide WebUI  -> MCP handlers (handlers/strategies.ts)
 *   - Electron     -> Main service (main/services/api/ai-studio-api.ts)
 *
 * Neither surface may reconstruct any decision made here. Adapters supply
 * surface context (identity, transport, persistence) and nothing else.
 *
 * Authority model
 * ---------------
 * The backend owns rule evolution, action availability, expiry, and the
 * generation manifest. This module owns validation, compare-and-swap
 * transition rules, request construction, and response reduction. The durable
 * mirror persisted by the host is for deterministic *dispatch* only -- it is
 * never an independent rule authority, and assistant prose is never an
 * authority at all (TICKET_1317 AC2/AC3).
 *
 * Hash compatibility
 * ------------------
 * `computeRulesHash` MUST stay byte-identical to the backend's
 * `compute_rules_hash` in `ai_studio_workflow_contract.py`. Both canonicalize
 * to the same behavioural projection and serialize with sorted keys and no
 * separator whitespace. See
 * docs/design/TICKET_1317_BACKEND_WORKFLOW_CONTRACT_SPEC.md.
 */

import { createHash } from 'node:crypto';

import type { StrategyRulesResponse, VibingChatAction } from './vibing-chat-protocol';

// =============================================================================
// Contract constants (TICKET_179: no magic numbers at call sites)
// =============================================================================

/** Wire-format version. Must match the backend contract version. */
export const AI_STUDIO_WORKFLOW_CONTRACT_VERSION = 1;

/** Revision assigned to the first snapshot of a session. */
export const INITIAL_WORKFLOW_REVISION = 1;

/** Hash primitive shared with the backend. */
export const RULES_HASH_ALGORITHM = 'sha256';

/**
 * Hard bound on the canonical rules this process will hash or persist.
 * Mirrors the backend bound so a payload rejected there is rejected here too
 * rather than being stored locally and failing later (AC7 byte bounds).
 */
export const MAX_CANONICAL_RULES_BYTES = 256 * 1024;

/** Upper bound on a persisted generated-artifact hash string. */
export const MAX_ARTIFACT_HASH_LENGTH = 128;

/**
 * Rule fields that materially change generated strategy behaviour. Exactly the
 * backend's BEHAVIOURAL_RULE_FIELDS -- the two lists must not drift.
 */
export const BEHAVIOURAL_RULE_FIELDS = [
  'entry_conditions',
  'exit_conditions',
  'risk_management',
  'indicators',
  'filters',
] as const;

/** Structured conflict codes emitted by the backend contract. */
export const WORKFLOW_CONFLICT_CODES = {
  STALE_REVISION: 'workflow_revision_stale',
  RULES_HASH_MISMATCH: 'workflow_rules_hash_mismatch',
  SESSION_EXPIRED: 'workflow_session_expired',
  SESSION_UNKNOWN: 'workflow_session_unknown',
  ACTION_UNAVAILABLE: 'workflow_action_unavailable',
  RULES_TOO_LARGE: 'workflow_rules_too_large',
  CROSS_SUBJECT: 'workflow_cross_subject',
} as const;

/**
 * Local-only code raised when the backend response carries no workflow
 * snapshot at all -- i.e. the backend has not yet implemented the TICKET_1317
 * contract. TICKET_858: this degrades explicitly and visibly. It is never
 * treated as "no conflict".
 */
export const WORKFLOW_CONTRACT_UNAVAILABLE = 'workflow_contract_unavailable';

// =============================================================================
// Types
// =============================================================================

/** A committed, backend-authoritative workflow state. */
export interface WorkflowSnapshot {
  readonly contractVersion: number;
  readonly sessionId: string;
  readonly workflowRevision: number;
  readonly strategyRules: StrategyRulesResponse | null;
  readonly rulesHash: string;
  readonly availableActions: readonly string[];
  readonly committedAt: number;
  readonly expiresAt: number;
  readonly resumable: boolean;
  readonly generatedArtifactHash: string | null;
  readonly generatedClassName: string | null;
}

/** Backend proof of what generation consumed and produced. */
export interface GenerationManifest {
  readonly contractVersion: number;
  readonly sessionId: string;
  readonly inputWorkflowRevision: number;
  readonly inputRulesHash: string;
  readonly generatedRulesHash: string;
  readonly rulesAgreement: boolean;
  readonly artifactHash: string | null;
  readonly className: string | null;
  readonly fieldDigests: Readonly<Record<string, { usedDigest: string; matchesInput: boolean }>>;
}

export interface WorkflowConflict {
  readonly code: string;
  readonly message: string;
  readonly expected?: Record<string, unknown>;
  readonly actual?: Record<string, unknown>;
}

export type WorkflowValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly conflict: WorkflowConflict };

/** The durable binding persisted per (subject, Guide conversation). */
export interface WorkflowBinding {
  readonly subjectId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly workflowRevision: number;
  readonly rulesHash: string;
  readonly strategyRules: StrategyRulesResponse | null;
  readonly availableActions: readonly string[];
  readonly expiresAt: number;
  readonly generatedArtifactHash: string | null;
  readonly generatedClassName: string | null;
  /** Local row revision, used for compare-and-swap against concurrent writers. */
  readonly rowRevision: number;
}

// =============================================================================
// Canonicalization and hashing
// =============================================================================

/**
 * Deterministic JSON with sorted mapping keys and no separator whitespace.
 *
 * Sequence order is preserved -- condition order is semantically meaningful
 * and reordering entry conditions is a real strategy change.
 */
function canonicalJson(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    const normalized = Object.is(value, -0) ? 0 : value;
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, normalized, false);
    const bytes = new Uint8Array(buffer);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return canonicalJson({ $number_f64: hex });
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Project a rule object onto its behavioural subset.
 *
 * Advisory telemetry (`completeness_score`, `status`, `missing_fields`,
 * `detected_language`, `is_llm_driven`) is deliberately excluded: those values
 * drift between an extraction and a refinement without the strategy itself
 * changing. Including them would make the hash spuriously unstable -- the very
 * instability that made the backend's removed completeness-score arbitration
 * look necessary.
 */
export class StrategyRulesShapeError extends Error {
  readonly code = WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH;

  constructor(message: string, readonly detail: Record<string, unknown>) {
    super(message);
    this.name = 'StrategyRulesShapeError';
  }
}

/**
 * A wrong-typed field is REJECTED, never coerced -- byte-for-byte the same
 * rule as the backend's `canonicalize_strategy_rules`.
 *
 * The two implementations previously disagreed here: Python coerced with
 * `list(value)` (turning `"trend_up"` into its characters and a mapping into
 * its keys) while this side passed the value through unchanged. Coercion is
 * the worse half of that pair -- it manufactures rules the user never wrote
 * and the hash then certifies them -- so both sides now fail instead.
 */
export function canonicalizeStrategyRules(
  rules: StrategyRulesResponse | null | undefined,
): Record<string, unknown> {
  if (rules !== null && rules !== undefined
    && (typeof rules !== 'object' || Array.isArray(rules))) {
    throw new StrategyRulesShapeError(
      `Strategy rules must be an object, got ${Array.isArray(rules) ? 'array' : typeof rules}.`,
      { strategy_rules_type: Array.isArray(rules) ? 'array' : typeof rules },
    );
  }
  const source = (rules ?? {}) as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of BEHAVIOURAL_RULE_FIELDS) {
    const value = source[key];
    if (value === null || value === undefined) {
      canonical[key] = key === 'risk_management' ? {} : [];
      continue;
    }
    if (key === 'risk_management') {
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new StrategyRulesShapeError(
          `Strategy rule field '${key}' must be an object, got `
          + `${Array.isArray(value) ? 'array' : typeof value}.`,
          { field: key, type: Array.isArray(value) ? 'array' : typeof value },
        );
      }
      // Drop null/undefined knobs so an explicitly-absent stop loss and an
      // omitted stop loss hash identically -- matching the backend projection.
      canonical[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined),
      );
    } else {
      if (!Array.isArray(value)) {
        throw new StrategyRulesShapeError(
          `Strategy rule field '${key}' must be a list, got ${typeof value}.`,
          { field: key, type: typeof value },
        );
      }
      canonical[key] = [...value];
    }
  }
  return canonical;
}

/** Hash over the canonical behavioural projection. Backend-compatible. */
export function computeRulesHash(rules: StrategyRulesResponse | null | undefined): string {
  return createHash(RULES_HASH_ALGORITHM)
    .update(canonicalJson(canonicalizeStrategyRules(rules)), 'utf8')
    .digest('hex');
}

/** Serialized byte length of the canonical projection (bound enforcement). */
export function canonicalRulesSize(rules: StrategyRulesResponse | null | undefined): number {
  return Buffer.byteLength(canonicalJson(canonicalizeStrategyRules(rules)), 'utf8');
}

/** Hash of a generated artifact, for manifest agreement checks. */
export function computeArtifactHash(artifact: string | null | undefined): string | null {
  if (!artifact) return null;
  return createHash(RULES_HASH_ALGORITHM).update(artifact, 'utf8').digest('hex');
}

// =============================================================================
// Snapshot validation
// =============================================================================

function conflict(
  code: string,
  message: string,
  extra?: { expected?: Record<string, unknown>; actual?: Record<string, unknown> },
): WorkflowValidation<never> {
  return { ok: false, conflict: { code, message, ...extra } };
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validate a raw backend `workflow_snapshot` object.
 *
 * A response without a snapshot yields WORKFLOW_CONTRACT_UNAVAILABLE rather
 * than a silently-permissive default: the caller must decide explicitly how to
 * degrade, and the reason reaches the UI (TICKET_858).
 */
export function validateWorkflowSnapshot(
  raw: unknown,
  options?: { now?: number },
): WorkflowValidation<WorkflowSnapshot> {
  if (raw === null || typeof raw !== 'object') {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      'The AI Studio server response carried no versioned workflow snapshot. '
      + 'The backend TICKET_1317 contract is required for verified rule continuity.',
    );
  }

  const source = raw as Record<string, unknown>;

  const contractVersion = asFiniteNumber(source.contract_version);
  if (contractVersion === null) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      'The AI Studio workflow snapshot is missing contract_version.',
    );
  }
  if (contractVersion !== AI_STUDIO_WORKFLOW_CONTRACT_VERSION) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      `Unsupported AI Studio workflow contract version ${contractVersion}; `
      + `this build implements version ${AI_STUDIO_WORKFLOW_CONTRACT_VERSION}.`,
      {
        expected: { contract_version: AI_STUDIO_WORKFLOW_CONTRACT_VERSION },
        actual: { contract_version: contractVersion },
      },
    );
  }

  const sessionId = typeof source.session_id === 'string' ? source.session_id.trim() : '';
  if (sessionId.length === 0) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      'The AI Studio workflow snapshot is missing session_id.',
    );
  }

  const workflowRevision = asFiniteNumber(source.workflow_revision);
  if (workflowRevision === null || !Number.isInteger(workflowRevision) || workflowRevision < INITIAL_WORKFLOW_REVISION) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      'The AI Studio workflow snapshot carries an invalid workflow_revision.',
      { actual: { workflow_revision: source.workflow_revision } },
    );
  }

  const algorithm = typeof source.rules_hash_algorithm === 'string'
    ? source.rules_hash_algorithm
    : RULES_HASH_ALGORITHM;
  if (algorithm !== RULES_HASH_ALGORITHM) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      `Unsupported rules hash algorithm '${algorithm}'.`,
      { expected: { rules_hash_algorithm: RULES_HASH_ALGORITHM } },
    );
  }

  const rulesHash = typeof source.rules_hash === 'string' ? source.rules_hash.trim() : '';
  if (rulesHash.length === 0) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      'The AI Studio workflow snapshot is missing rules_hash.',
    );
  }

  const strategyRules = (source.strategy_rules ?? null) as StrategyRulesResponse | null;

  // A malformed field makes the rules unhashable rather than merely different.
  // Surface it as the same structured conflict the backend raises, so the two
  // sides report an identical failure for identical input.
  let size: number;
  let recomputed: string;
  try {
    size = canonicalRulesSize(strategyRules);
    recomputed = computeRulesHash(strategyRules);
  } catch (error: unknown) {
    if (error instanceof StrategyRulesShapeError) {
      return conflict(
        WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH,
        `The AI Studio workflow snapshot carries malformed strategy_rules: ${error.message}`,
        { actual: error.detail },
      );
    }
    throw error;
  }

  if (size > MAX_CANONICAL_RULES_BYTES) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.RULES_TOO_LARGE,
      `AI Studio strategy rules exceed the ${MAX_CANONICAL_RULES_BYTES} byte contract bound (${size} bytes).`,
      { actual: { canonical_bytes: size } },
    );
  }

  // The server's own hash must describe the rules it shipped. A mismatch means
  // the payload was altered in transit or the two canonicalizations diverged;
  // either way the snapshot cannot be trusted as a dispatch basis.
  if (recomputed !== rulesHash) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH,
      'The AI Studio workflow snapshot rules_hash does not describe its own strategy_rules.',
      { expected: { rules_hash: rulesHash }, actual: { rules_hash: recomputed } },
    );
  }

  const availableActions = Array.isArray(source.available_actions)
    ? source.available_actions.filter((a): a is string => typeof a === 'string')
    : [];

  const committedAt = asFiniteNumber(source.committed_at) ?? 0;
  const expiresAt = asFiniteNumber(source.expires_at) ?? 0;
  const now = options?.now ?? Date.now() / 1000;

  if (expiresAt > 0 && now >= expiresAt) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.SESSION_EXPIRED,
      `AI Studio session '${sessionId}' expired. Start a new session to continue authoring this strategy.`,
      { actual: { expires_at: expiresAt } },
    );
  }

  const artifactHash = typeof source.generated_artifact_hash === 'string'
    && source.generated_artifact_hash.length <= MAX_ARTIFACT_HASH_LENGTH
    ? source.generated_artifact_hash
    : null;

  return {
    ok: true,
    value: {
      contractVersion,
      sessionId,
      workflowRevision,
      strategyRules,
      rulesHash,
      availableActions,
      committedAt,
      expiresAt,
      resumable: source.resumable !== false,
      generatedArtifactHash: artifactHash,
      generatedClassName: typeof source.generated_class_name === 'string'
        ? source.generated_class_name
        : null,
    },
  };
}

/** Parse a structured backend conflict payload, when present. */
export function parseWorkflowConflict(raw: unknown): WorkflowConflict | null {
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const code = typeof source.code === 'string' ? source.code : '';
  if (code.length === 0) return null;
  const known = Object.values(WORKFLOW_CONFLICT_CODES) as string[];
  if (!known.includes(code)) return null;
  return {
    code,
    message: typeof source.message === 'string' ? source.message : code,
    expected: (source.expected ?? undefined) as Record<string, unknown> | undefined,
    actual: (source.actual ?? undefined) as Record<string, unknown> | undefined,
  };
}

// =============================================================================
// Action gate
// =============================================================================

/**
 * Gate an action against the committed snapshot BEFORE dispatch.
 *
 * AC3: `generate_code` may run only when the current backend snapshot
 * advertises it. Failing here means no backend task is ever created, so a
 * stale action cannot consume quota or produce a misleading artifact.
 */
export function gateWorkflowAction(
  binding: Pick<WorkflowBinding, 'availableActions' | 'expiresAt' | 'sessionId'>,
  action: VibingChatAction | string,
  options?: { now?: number },
): WorkflowValidation<true> {
  const now = options?.now ?? Date.now() / 1000;
  if (binding.expiresAt > 0 && now >= binding.expiresAt) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.SESSION_EXPIRED,
      `AI Studio session '${binding.sessionId}' expired. Start a new session to continue authoring this strategy.`,
      { actual: { expires_at: binding.expiresAt } },
    );
  }
  if (!binding.availableActions.includes(action)) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.ACTION_UNAVAILABLE,
      `Action '${action}' is not available on the current AI Studio snapshot. `
      + `Available: ${binding.availableActions.join(', ') || 'none'}.`,
      { expected: { action }, actual: { available_actions: [...binding.availableActions] } },
    );
  }
  return { ok: true, value: true };
}

// =============================================================================
// Request construction
// =============================================================================

/**
 * The compare-and-swap preconditions every mutating request must carry.
 *
 * Built from the durable binding, never from LLM-authored arguments -- this is
 * what makes the backend able to reject a stale caller instead of silently
 * arbitrating between two rule objects.
 */
export function buildWorkflowPreconditions(
  binding: Pick<WorkflowBinding, 'workflowRevision' | 'rulesHash'>,
): Record<string, unknown> {
  return {
    expected_workflow_revision: binding.workflowRevision,
    expected_rules_hash: binding.rulesHash,
  };
}

// =============================================================================
// Response reduction
// =============================================================================

/**
 * Reduce a validated snapshot into the next durable binding.
 *
 * Compare-and-swap: a snapshot whose revision is not strictly greater than the
 * committed one is rejected. A stale or concurrent writer therefore cannot
 * overwrite newer state -- it receives an explicit conflict and must reload
 * (TICKET_1317 section 6.2).
 */
export function reduceWorkflowSnapshot(
  previous: WorkflowBinding | null,
  snapshot: WorkflowSnapshot,
  identity: { subjectId: string; conversationId: string },
): WorkflowValidation<WorkflowBinding> {
  if (previous) {
    if (previous.subjectId !== identity.subjectId) {
      return conflict(
        WORKFLOW_CONFLICT_CODES.CROSS_SUBJECT,
        'The AI Studio workflow binding belongs to a different user. Refusing to apply this snapshot.',
      );
    }
    if (previous.sessionId !== snapshot.sessionId) {
      return conflict(
        WORKFLOW_CONFLICT_CODES.SESSION_UNKNOWN,
        `The AI Studio snapshot is for session '${snapshot.sessionId}' but this `
        + `conversation is bound to '${previous.sessionId}'. Reset the draft to start a different strategy.`,
        { expected: { session_id: previous.sessionId }, actual: { session_id: snapshot.sessionId } },
      );
    }
    if (snapshot.workflowRevision <= previous.workflowRevision) {
      return conflict(
        WORKFLOW_CONFLICT_CODES.STALE_REVISION,
        `Refusing to overwrite AI Studio workflow revision ${previous.workflowRevision} `
        + `with older revision ${snapshot.workflowRevision}. Reload and retry.`,
        {
          expected: { workflow_revision: previous.workflowRevision },
          actual: { workflow_revision: snapshot.workflowRevision },
        },
      );
    }
  }

  return {
    ok: true,
    value: {
      subjectId: identity.subjectId,
      conversationId: identity.conversationId,
      sessionId: snapshot.sessionId,
      workflowRevision: snapshot.workflowRevision,
      rulesHash: snapshot.rulesHash,
      strategyRules: snapshot.strategyRules,
      availableActions: [...snapshot.availableActions],
      expiresAt: snapshot.expiresAt,
      generatedArtifactHash: snapshot.generatedArtifactHash,
      generatedClassName: snapshot.generatedClassName,
      rowRevision: (previous?.rowRevision ?? 0) + 1,
    },
  };
}

// =============================================================================
// Generation manifest validation
// =============================================================================

/**
 * Validate that a generation response agrees with the snapshot we dispatched.
 *
 * AC4: this is what turns "the generated code should use the reviewed rules"
 * into a checkable property. A manifest whose input revision, input hash, or
 * artifact hash disagrees with the dispatch is rejected -- the artifact is not
 * surfaced as if it were correct.
 */
export function validateGenerationManifest(
  raw: unknown,
  dispatched: Pick<WorkflowBinding, 'sessionId' | 'workflowRevision' | 'rulesHash'>,
  artifact: string | null | undefined,
): WorkflowValidation<GenerationManifest> {
  if (raw === null || typeof raw !== 'object') {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      'The AI Studio generation response carried no generation manifest, so the '
      + 'generated code cannot be proven to match the reviewed strategy rules.',
    );
  }

  const source = raw as Record<string, unknown>;

  const contractVersion = asFiniteNumber(source.contract_version);
  if (contractVersion !== AI_STUDIO_WORKFLOW_CONTRACT_VERSION) {
    return conflict(
      WORKFLOW_CONTRACT_UNAVAILABLE,
      `Unsupported generation manifest contract version ${String(source.contract_version)}.`,
      {
        expected: { contract_version: AI_STUDIO_WORKFLOW_CONTRACT_VERSION },
        actual: { contract_version: source.contract_version },
      },
    );
  }

  const sessionId = typeof source.session_id === 'string' ? source.session_id : '';
  if (sessionId !== dispatched.sessionId) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.SESSION_UNKNOWN,
      'The generation manifest is for a different AI Studio session than the one dispatched.',
      { expected: { session_id: dispatched.sessionId }, actual: { session_id: sessionId } },
    );
  }

  const inputRevision = asFiniteNumber(source.input_workflow_revision);
  if (inputRevision !== dispatched.workflowRevision) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.STALE_REVISION,
      'The generation manifest reports a different input workflow revision than the one dispatched.',
      {
        expected: { input_workflow_revision: dispatched.workflowRevision },
        actual: { input_workflow_revision: source.input_workflow_revision },
      },
    );
  }

  const inputRulesHash = typeof source.input_rules_hash === 'string' ? source.input_rules_hash : '';
  if (inputRulesHash !== dispatched.rulesHash) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH,
      'The generation manifest reports different input rules than the reviewed snapshot.',
      {
        expected: { input_rules_hash: dispatched.rulesHash },
        actual: { input_rules_hash: inputRulesHash },
      },
    );
  }

  const generatedRulesHash = typeof source.generated_rules_hash === 'string'
    ? source.generated_rules_hash
    : '';
  const fieldDigestsRaw = (source.field_digests ?? {}) as Record<string, unknown>;
  const fieldDigests: Record<string, { usedDigest: string; matchesInput: boolean }> = {};
  const driftedFields: string[] = [];
  for (const [name, entry] of Object.entries(fieldDigestsRaw)) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const matchesInput = record.matches_input === true;
    fieldDigests[name] = {
      usedDigest: typeof record.used_digest === 'string' ? record.used_digest : '',
      matchesInput,
    };
    if (!matchesInput) driftedFields.push(name);
  }

  // The backend generated from rules that differ from the ones we reviewed.
  // This is the exact production failure TICKET_1317 was filed for: reviewed
  // period 10 / TP 6% silently generating period 14 / TP 5%.
  if (source.rules_agreement !== true || generatedRulesHash !== dispatched.rulesHash) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH,
      'AI Studio generated code from strategy rules that differ from the reviewed snapshot'
      + (driftedFields.length > 0 ? ` (fields: ${driftedFields.join(', ')})` : '')
      + '. The generated artifact was rejected.',
      {
        expected: { rules_hash: dispatched.rulesHash },
        actual: { generated_rules_hash: generatedRulesHash, drifted_fields: driftedFields },
      },
    );
  }

  const reportedArtifactHash = typeof source.artifact_hash === 'string' ? source.artifact_hash : null;
  const localArtifactHash = computeArtifactHash(artifact);
  if (localArtifactHash !== null && reportedArtifactHash !== null
    && localArtifactHash !== reportedArtifactHash) {
    return conflict(
      WORKFLOW_CONFLICT_CODES.RULES_HASH_MISMATCH,
      'The generation manifest artifact hash does not match the returned strategy code.',
      {
        expected: { artifact_hash: reportedArtifactHash },
        actual: { artifact_hash: localArtifactHash },
      },
    );
  }

  return {
    ok: true,
    value: {
      contractVersion,
      sessionId,
      inputWorkflowRevision: inputRevision,
      inputRulesHash,
      generatedRulesHash,
      rulesAgreement: true,
      artifactHash: reportedArtifactHash,
      className: typeof source.class_name === 'string' ? source.class_name : null,
      fieldDigests,
    },
  };
}
