/**
 * TICKET_661_1 section 5.3 / 5.3.1, AC-3 / AC-4 / AC-7: non-destructive C++
 * regeneration as a two-phase lifecycle.
 *
 * This module owns the two state transitions that decide whether a regenerated
 * replacement exists and whether it may execute. Both are Electron-free: the
 * caller injects a storage handle, so Electron Main and the standalone MCP
 * surface drive the identical operation rather than each reconstructing the
 * decision (CLAUDE.md surface-layer rule).
 *
 * ---------------------------------------------------------------------------
 * Why two phases and not one ordered sequence
 * ---------------------------------------------------------------------------
 *
 * Section 5.3.1 explicitly rejects the earlier "archive publish -> validate ->
 * commit new record -> commit lineage" ordering. It is not crash-safe: a
 * process exit between the record commit and the lineage commit leaves a
 * replacement that exists -- possibly executable -- with no complete
 * bidirectional lineage. That contradicts AC-7. It is also unimplementable for
 * `review_required`, because a record that has not been committed cannot be a
 * stable object for a user to inspect and accept.
 *
 * So:
 *
 *   Phase 1 (`commitReplacementCandidate`) -- the new record, BOTH directions of
 *   lineage, and the migration state row are written in ONE transaction. There
 *   is no window in which any one exists without the others. The record is
 *   committed NON-EXECUTABLE, and non-executability is a persisted property
 *   (`execution_readiness` below `admitted`), not a missing lineage row and not
 *   a UI affordance.
 *
 *   Phase 2 (`admitReplacementForExecution`) -- a separate, single atomic
 *   transition, and the ONLY writer of `execution_readiness == 'admitted'`.
 *
 * ---------------------------------------------------------------------------
 * Why acceptance is not parity
 * ---------------------------------------------------------------------------
 *
 * Section 5.3.1 is emphatic: user acceptance of a `review_required` candidate is
 * NOT a semantic-equivalence verification pass. Where reproducible fixtures
 * exist, parity is the applicable semantic gate and admission requires
 * `parity_verified`. Where they do not, informed acceptance is the applicable
 * *adoption* gate and the semantic axis stays explicitly
 * `accepted_without_parity` -- even after readiness independently reaches
 * `admitted`. A successful admission therefore writes only the readiness axis;
 * it never rewrites semantic state as verified. `deriveCandidatePresentation()`
 * exists so the UI cannot invent a different rule for the same states.
 */

import type {
  StrategyExecutionReadiness,
  StrategySemanticEquivalence,
} from './strategy-execution-admission';

// =============================================================================
// Contract version
// =============================================================================

/** Version of the regeneration/admission lifecycle contract. */
export const STRATEGY_MIGRATION_LIFECYCLE_VERSION = 1;

// =============================================================================
// Attempt state (mirrors the migration 141 CHECK constraint)
// =============================================================================

/**
 * Durable attempt state. The set matches the `strategy_migration_attempt.state`
 * CHECK constraint in migration 141 exactly -- the database is the enforcement,
 * this type is the compile-time mirror of it.
 */
export type StrategyMigrationAttemptState =
  | 'inventoried'
  | 'archive_staged'
  | 'archive_published'
  | 'candidate_committed'
  | 'admitted'
  | 'failed'
  | 'cancelled';

/** States after which an attempt is finished and must never be re-driven. */
export const TERMINAL_ATTEMPT_STATES: readonly StrategyMigrationAttemptState[] = [
  'admitted',
  'failed',
  'cancelled',
];

export function isTerminalAttemptState(state: StrategyMigrationAttemptState): boolean {
  return TERMINAL_ATTEMPT_STATES.includes(state);
}

// =============================================================================
// Injected storage
// =============================================================================

export interface LifecycleStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
}

/**
 * The storage surface this module needs.
 *
 * `transactionImmediate` is required rather than incidental, for the same
 * reason TICKET_1335 requires it: a deferred transaction takes its write lock
 * only at the first write, which would let two concurrent regenerations both
 * complete their reads before either claimed the source record -- exactly the
 * duplicate-replacement race AC-7 forbids.
 */
export interface StrategyMigrationDb {
  prepare(sql: string): LifecycleStatement;
  transactionImmediate<T>(fn: () => T): () => T;
}

// =============================================================================
// Phase 1 -- atomic candidate commit
// =============================================================================

export interface ReplacementCandidateInput {
  attemptId: string;
  /** The legacy record being replaced. Always an `algorithm` (section 3.2). */
  sourceRecordId: number;
  /** The already-created C++ replacement record. */
  replacementRecordId: number;
  /** Pinned source digests, carried into lineage as provenance. */
  sourceDbCodeSha256: string | null;
  sourceAttachmentSha256: string | null;
  /** Hash of the published archive manifest; ties lineage to the archive. */
  archiveManifestSha256: string | null;
  generationProvider?: string | null;
  generationModel?: string | null;
  /** Injected timestamp; this module keeps no clock. */
  migratedAt: string;
}

export type CandidateCommitRefusalCode =
  /** The attempt is already finished; re-driving it would duplicate work. */
  | 'attempt_terminal'
  /** The archive was never published; regeneration may not precede it. */
  | 'archive_not_published'
  /** A replacement already exists for this source record. */
  | 'replacement_exists'
  /** No such attempt. */
  | 'attempt_not_found';

export type CandidateCommitResult =
  | { committed: true; replacementRecordId: number }
  | { committed: false; code: CandidateCommitRefusalCode; detail: string };

/**
 * Phase 1: commit the replacement candidate, both lineage directions, and the
 * migration state row in ONE transaction.
 *
 * The candidate is committed NON-EXECUTABLE. This function never writes
 * `execution_readiness == 'admitted'`; only `admitReplacementForExecution()`
 * may, which is what keeps "structurally valid" and "allowed to run" separable.
 *
 * Retrying an attempt that already committed its candidate is a no-op that
 * reports success rather than producing a second replacement (AC-7).
 */
export function commitReplacementCandidate(
  db: StrategyMigrationDb,
  input: ReplacementCandidateInput,
): CandidateCommitResult {
  return db.transactionImmediate<CandidateCommitResult>(() => {
    const attempt = db
      .prepare(
        `SELECT attempt_id, state, archive_manifest_sha256, replacement_record_id
           FROM strategy_migration_attempt WHERE attempt_id = ?`,
      )
      .get(input.attemptId) as
      | {
          attempt_id: string;
          state: StrategyMigrationAttemptState;
          archive_manifest_sha256: string | null;
          replacement_record_id: number | null;
        }
      | undefined;

    if (!attempt) {
      return {
        committed: false,
        code: 'attempt_not_found',
        detail: `No migration attempt ${input.attemptId}.`,
      };
    }

    // Idempotent replay: the candidate is already committed. Reporting success
    // without writing again is what makes recovery safe to run repeatedly.
    if (attempt.state === 'candidate_committed' && attempt.replacement_record_id != null) {
      return { committed: true, replacementRecordId: attempt.replacement_record_id };
    }

    if (isTerminalAttemptState(attempt.state)) {
      return {
        committed: false,
        code: 'attempt_terminal',
        detail:
          `Attempt ${input.attemptId} is already ${attempt.state}. A terminal ` +
          'attempt is never re-driven; retrying a completed migration is a no-op.',
      };
    }

    // Section 5.2: the archive is produced and verified BEFORE regeneration.
    if (attempt.state !== 'archive_published') {
      return {
        committed: false,
        code: 'archive_not_published',
        detail:
          `Attempt ${input.attemptId} is ${attempt.state}; the immutable archive ` +
          'must be published and verified before a replacement is committed.',
      };
    }

    // One replacement per source. The UNIQUE index on
    // strategy_migration_lineage.source_record_id also enforces this, but
    // refusing here produces an actionable message instead of a raw constraint
    // error reaching the UI (TICKET_858).
    const existing = db
      .prepare(
        `SELECT replacement_record_id FROM strategy_migration_lineage
          WHERE source_record_id = ?`,
      )
      .get(input.sourceRecordId) as { replacement_record_id: number } | undefined;
    if (existing) {
      return {
        committed: false,
        code: 'replacement_exists',
        detail:
          `Source record ${input.sourceRecordId} already has replacement ` +
          `${existing.replacement_record_id}. A second replacement would orphan the first.`,
      };
    }

    // Direction 1: replacement -> source (`migrated_from`), plus provenance.
    db.prepare(
      `INSERT INTO strategy_migration_lineage (
         replacement_record_id, source_record_id, attempt_id,
         source_db_code_sha256, source_attachment_sha256, archive_manifest_sha256,
         generation_provider, generation_model, migrated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.replacementRecordId,
      input.sourceRecordId,
      input.attemptId,
      input.sourceDbCodeSha256,
      input.sourceAttachmentSha256,
      input.archiveManifestSha256,
      input.generationProvider ?? null,
      input.generationModel ?? null,
      input.migratedAt,
    );

    // Direction 2: source -> replacement, on migration state owned OUTSIDE the
    // immutable original payload (section 5.3). The original record is never
    // rewritten to point at its replacement.
    db.prepare(
      `UPDATE strategy_migration_attempt
          SET state = 'candidate_committed',
              replacement_record_id = ?,
              updated_at = ?
        WHERE attempt_id = ?`,
    ).run(input.replacementRecordId, input.migratedAt, input.attemptId);

    // The candidate's persisted non-executability. Committed as `unvalidated`
    // with `unassessed` semantics: section 5.3 says validation and compilation
    // advance readiness through `valid` to `compiled`, and only then may the
    // separate admission step run.
    db.prepare(
      `UPDATE strategy_migration_snapshot
          SET execution_readiness = 'unvalidated',
              semantic_equivalence = 'unassessed'
        WHERE record_id = ? AND record_parent_kind = 'algorithm'`,
    ).run(input.replacementRecordId);

    return { committed: true, replacementRecordId: input.replacementRecordId };
  })();
}

// =============================================================================
// Phase 2 -- admission
// =============================================================================

export interface ReplacementAdmissionInput {
  attemptId: string;
  replacementRecordId: number;
  /** C++ integrity validation passed. Always required. */
  integrityValidated: boolean;
  /** ABI v2 compilation succeeded. Always required. */
  compiled: boolean;
  /**
   * Whether reproducible fixtures exist for this strategy. Decides WHICH
   * semantic gate applies -- parity when true, informed acceptance when false.
   */
  fixturesExist: boolean;
  /** Parity outcome, when fixtures exist. */
  parityVerified?: boolean;
  /** Informed user acceptance, when no fixture exists. */
  acceptance?: { acceptedBy: string; acceptedAt: string };
  admittedAt: string;
}

export type AdmissionRefusalReason =
  | 'attempt_not_found'
  | 'candidate_not_committed'
  | 'integrity_validation_missing'
  | 'compilation_missing'
  | 'parity_not_verified'
  | 'acceptance_missing';

export type ReplacementAdmissionResult =
  | {
      admitted: true;
      executionReadiness: 'admitted';
      semanticEquivalence: StrategySemanticEquivalence;
    }
  | { admitted: false; reason: AdmissionRefusalReason; detail: string };

/**
 * Phase 2: the single atomic transition to executable, and the ONLY writer of
 * `execution_readiness == 'admitted'`.
 *
 * Gates, in contract order:
 *   1. the candidate must actually be committed (phase 1 completed);
 *   2. C++ integrity validation -- always required;
 *   3. ABI v2 compilation -- always required;
 *   4. the applicable semantic gate: `parity_verified` when fixtures exist,
 *      otherwise explicit informed acceptance.
 *
 * On success it writes readiness only. The semantic axis records which gate was
 * actually satisfied -- `parity_verified` or `accepted_without_parity` -- and
 * acceptance is NEVER upgraded to parity. Failure at any point leaves the
 * candidate non-executable and rewrites neither the original record nor the
 * published archive.
 */
export function admitReplacementForExecution(
  db: StrategyMigrationDb,
  input: ReplacementAdmissionInput,
): ReplacementAdmissionResult {
  return db.transactionImmediate<ReplacementAdmissionResult>(() => {
    const attempt = db
      .prepare(
        `SELECT state, replacement_record_id FROM strategy_migration_attempt
          WHERE attempt_id = ?`,
      )
      .get(input.attemptId) as
      | { state: StrategyMigrationAttemptState; replacement_record_id: number | null }
      | undefined;

    if (!attempt) {
      return {
        admitted: false,
        reason: 'attempt_not_found',
        detail: `No migration attempt ${input.attemptId}.`,
      };
    }

    // Idempotent replay of a completed admission.
    if (attempt.state === 'admitted') {
      const current = db
        .prepare(
          `SELECT semantic_equivalence FROM strategy_migration_snapshot
            WHERE record_id = ? AND record_parent_kind = 'algorithm'`,
        )
        .get(input.replacementRecordId) as
        | { semantic_equivalence: StrategySemanticEquivalence | null }
        | undefined;
      return {
        admitted: true,
        executionReadiness: 'admitted',
        semanticEquivalence: current?.semantic_equivalence ?? 'unassessed',
      };
    }

    if (attempt.state !== 'candidate_committed') {
      return {
        admitted: false,
        reason: 'candidate_not_committed',
        detail:
          `Attempt ${input.attemptId} is ${attempt.state}; a replacement is ` +
          'admitted only after its candidate is committed by phase 1.',
      };
    }

    if (!input.integrityValidated) {
      return {
        admitted: false,
        reason: 'integrity_validation_missing',
        detail: 'Admission always requires C++ integrity validation to have passed.',
      };
    }

    if (!input.compiled) {
      return {
        admitted: false,
        reason: 'compilation_missing',
        detail: 'Admission always requires successful ABI v2 compilation.',
      };
    }

    // The applicable semantic gate depends on whether fixtures exist. These are
    // two different gates, not two strengths of one gate.
    let semanticEquivalence: StrategySemanticEquivalence;
    if (input.fixturesExist) {
      if (input.parityVerified !== true) {
        return {
          admitted: false,
          reason: 'parity_not_verified',
          detail:
            'Reproducible fixtures exist for this strategy, so admission requires ' +
            'passing parity verification comparing signals, orders, positions, and ' +
            'configured risk behavior.',
        };
      }
      semanticEquivalence = 'parity_verified';
    } else {
      if (input.acceptance == null) {
        return {
          admitted: false,
          reason: 'acceptance_missing',
          detail:
            'No reproducible fixture exists, so admission requires explicit ' +
            'informed user acceptance of the generated replacement.',
        };
      }
      // Section 5.3.1: acceptance is an ADOPTION gate. It is recorded as
      // provenance and must never be represented as parity evidence.
      semanticEquivalence = 'accepted_without_parity';
    }

    db.prepare(
      `UPDATE strategy_migration_snapshot
          SET execution_readiness = 'admitted',
              semantic_equivalence = ?
        WHERE record_id = ? AND record_parent_kind = 'algorithm'`,
    ).run(semanticEquivalence, input.replacementRecordId);

    if (input.acceptance != null) {
      db.prepare(
        `UPDATE strategy_migration_lineage
            SET accepted_by = ?, accepted_at = ?
          WHERE replacement_record_id = ?`,
      ).run(
        input.acceptance.acceptedBy,
        input.acceptance.acceptedAt,
        input.replacementRecordId,
      );
    }

    db.prepare(
      `UPDATE strategy_migration_attempt
          SET state = 'admitted', updated_at = ?
        WHERE attempt_id = ?`,
    ).run(input.admittedAt, input.attemptId);

    return { admitted: true, executionReadiness: 'admitted', semanticEquivalence };
  })();
}

// =============================================================================
// UI presentation (section 5.3)
// =============================================================================

/**
 * What the UI shows for a candidate. Derived here so no surface invents its own
 * rule for the same persisted states -- `review_required` in particular is a
 * *derived* view of "compiled but semantically unassessed", never a stored flag.
 */
export type CandidatePresentation =
  | 'pending_validation'
  | 'review_required'
  | 'executable'
  | 'blocked';

/**
 * Derive the presentation state.
 *
 * `executable` follows readiness alone, because readiness is the only axis that
 * authorizes execution. Note that an `accepted_without_parity` record is
 * `executable` and is still not parity-verified: the caller shows the semantic
 * axis alongside, and must not collapse the two.
 */
export function deriveCandidatePresentation(
  readiness: StrategyExecutionReadiness,
  semantic: StrategySemanticEquivalence,
): CandidatePresentation {
  if (readiness === 'admitted') return 'executable';
  if (readiness === 'blocked' || semantic === 'failed') return 'blocked';
  if (readiness === 'compiled' && semantic === 'unassessed') return 'review_required';
  return 'pending_validation';
}
