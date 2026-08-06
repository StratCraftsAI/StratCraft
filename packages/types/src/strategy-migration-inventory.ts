/**
 * TICKET_661_1 section 5.1 / 5.1.1, AC-1 / AC-2: the deterministic legacy
 * inventory and its replayable consistency snapshot.
 *
 * This is the single owner of "which saved strategies exist, what language is
 * each, and what exactly did we see when we decided that?". UI, IPC, the
 * Service API, MCP, and release verification all consume this operation instead
 * of reimplementing the scan (CLAUDE.md surface-layer rule); it is Electron-free
 * and pure, so callers inject already-acquired rows, attachment bytes, and a
 * hash function rather than having this module read the database or the disk.
 *
 * ---------------------------------------------------------------------------
 * Why the capability split is the first thing this module does
 * ---------------------------------------------------------------------------
 *
 * Section 3.2 corrects the evidence baseline the original design was built on.
 * The 2026-07-26 census recorded "65 active rows, zero Python" and counted
 * `nona_algorithms` alone -- but every execution boundary resolves records
 * through the `v_algorithms_all` view, which TICKET_762 A3 defined as
 * `nona_algorithms UNION ALL nona_signal`. The 2026-08-01 re-census of the same
 * database found 65 algorithm rows against 12,560 active (plus 10,731
 * soft-deleted) `nona_signal` rows, of which 12,556 are Python.
 *
 * Those signal rows are Signal Discovery research artifacts. Sections 5.1.1 and
 * 7 assign them to TICKET_1292_21 and explicitly bar this policy from rewriting
 * or removing them. So the inventory splits on the persisted `parentKind`
 * discriminator the view already emits -- **before** classification, and never
 * by a heuristic:
 *
 *   - `algorithm` -> legacy saved strategy. The full policy applies: snapshot,
 *     immutable archive, optional regeneration, lineage.
 *   - `signal`    -> research artifact. Release **accounting only**. Never
 *     archived, never regenerated. It stays non-executable through the existing
 *     admission refusal, which already returns the `pythonResearchArtifact`
 *     composition remedy rather than the `legacyPythonStrategy` regeneration
 *     remedy.
 *
 * A single undifferentiated scan would stage 12,556 archive records for a
 * capability class this ticket does not own -- a defect against section 7, not
 * merely a slow scan. `archivable` on each entry is what carries that decision
 * to the archive writer, so the writer cannot re-derive it and get it wrong.
 *
 * ---------------------------------------------------------------------------
 * Why DB code and attachment are hashed separately
 * ---------------------------------------------------------------------------
 *
 * Section 5.1.1: DB `code` and `file_path` are two distinct sources and neither
 * is silently authoritative. The run path already picks between them
 * conditionally, so one record can carry two different bodies. Merging them into
 * one hash would make an AC-2 "byte-exact" recheck unable to say *which* side
 * moved, and would let a record whose attachment changed pass a recheck of the
 * DB column. They are therefore pinned as two independent digests, and
 * `verifySnapshotEntryUnchanged()` fails on either independently.
 */

import {
  classifyStrategyLanguageEvidence,
  STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
  type ResolvedStrategyLanguage,
  type StrategyLanguageClassification,
  type StrategyLanguageEvidence,
} from './strategy-language-evidence';
import type {
  StrategyExecutionReadiness,
  StrategySemanticEquivalence,
} from './strategy-execution-admission';

// =============================================================================
// Contract version
// =============================================================================

/**
 * Version of the inventory/snapshot contract, persisted alongside results so a
 * later run can tell whether a stored snapshot was produced by current rules.
 * Distinct from `STRATEGY_LANGUAGE_CLASSIFIER_VERSION`: the classifier's rules
 * and the snapshot's shape version independently.
 */
export const STRATEGY_MIGRATION_INVENTORY_VERSION = 1;

// =============================================================================
// Capability class (section 3.2 / 5.1.1 / 7)
// =============================================================================

/**
 * Which table the record came from, as emitted by `v_algorithms_all`. This is a
 * persisted discriminator, never inferred from content.
 */
export type StrategyRecordParentKind = 'algorithm' | 'signal';

/**
 * What this ticket is allowed to do with a record.
 *
 * `legacy_strategy`   -- full migration policy applies (archive, regenerate).
 * `research_artifact` -- accounting only; owned by TICKET_1292_21.
 */
export type StrategyMigrationCapabilityClass = 'legacy_strategy' | 'research_artifact';

/**
 * Map the persisted parent kind to its capability class.
 *
 * Exported because it is the contract, not an implementation detail: the
 * archive writer and the release accounting both consume the same mapping so
 * they cannot disagree about which records this ticket owns.
 */
export function capabilityClassForParentKind(
  parentKind: StrategyRecordParentKind,
): StrategyMigrationCapabilityClass {
  return parentKind === 'algorithm' ? 'legacy_strategy' : 'research_artifact';
}

// =============================================================================
// Input
// =============================================================================

/**
 * One saved-strategy row plus the evidence needed to classify it. Callers read
 * these from `v_algorithms_all` and inject them; this module never queries.
 */
export interface StrategyInventoryRecordInput {
  id: number;
  /** Persisted discriminator from the view. Drives the capability split. */
  parentKind: StrategyRecordParentKind;
  /** Row version, pinned by the snapshot for the AC-2 recheck. */
  version?: number | null;
  /** Row update timestamp, pinned alongside the version. */
  updateTime?: string | null;
  /** True for soft-deleted rows. AC-1 requires them inventoried too. */
  deleted?: boolean;
  /** User-visible name, carried for the UI remedy and the archive record. */
  strategyName?: string | null;
  /** Bytes of the `code` column. */
  dbCode?: string | null;
  /** The `file_path` value, whether or not it resolves. */
  filePath?: string | null;
  /** Bytes read from `filePath` by the caller's adapter. */
  attachmentCode?: string | null;
  /** Whether `filePath` resolved to readable bytes. */
  attachmentReadable?: boolean;
  /** Raw `classification_metadata`; the classifier owns the parse. */
  classificationMetadata?: string | null;
  /** Explicit artifact kind when the schema records one. */
  artifactKind?: string | null;
  /** Persisted readiness from the TICKET_661_1 additive schema, when present. */
  executionReadiness?: StrategyExecutionReadiness | null;
  /** Persisted semantic state from the additive schema, when present. */
  semanticEquivalence?: StrategySemanticEquivalence | null;
}

/** Injected SHA-256. Kept injected so this module stays dependency-free. */
export type Sha256Fn = (input: string) => string;

export interface StrategyInventoryOptions {
  /** Stable identifier for this snapshot; callers supply it (no clock here). */
  snapshotId: string;
  /** ISO timestamp for the snapshot; injected so the module stays pure. */
  capturedAt: string;
  sha256: Sha256Fn;
}

// =============================================================================
// Output
// =============================================================================

/**
 * The three independent axes of section 5.1, never collapsed into one value.
 *
 * `resolvedLanguage === 'cpp'` alone never authorizes execution; only
 * `executionReadiness === 'admitted'` does. Semantic equivalence is reported
 * separately and is never inferred from executability.
 */
export interface StrategyInventoryAxes {
  resolvedLanguage: ResolvedStrategyLanguage;
  executionReadiness: StrategyExecutionReadiness;
  semanticEquivalence: StrategySemanticEquivalence;
}

export interface StrategySnapshotHashes {
  /** SHA-256 of the DB `code` bytes, or null when the column is empty. */
  dbCodeSha256: string | null;
  /** The pinned `file_path`, or null. */
  attachmentPath: string | null;
  /** SHA-256 of the attachment bytes, or null when unreadable/absent. */
  attachmentSha256: string | null;
  /**
   * True when `filePath` is set but its bytes were not readable. Section 5.2:
   * a missing attachment becomes an explicit finding, never a silent absence,
   * and regeneration cannot then claim source completeness.
   */
  attachmentMissing: boolean;
}

export interface StrategyInventoryEntry {
  id: number;
  parentKind: StrategyRecordParentKind;
  capabilityClass: StrategyMigrationCapabilityClass;
  /**
   * Whether this ticket may archive/regenerate this record. Derived once here
   * from the capability class so no downstream consumer re-derives it.
   */
  archivable: boolean;
  strategyName: string | null;
  version: number | null;
  updateTime: string | null;
  deleted: boolean;
  axes: StrategyInventoryAxes;
  hashes: StrategySnapshotHashes;
  /** Full evidence and conflict set behind the verdict, for the audit trail. */
  classification: StrategyLanguageClassification;
}

export interface StrategyInventoryCounts {
  total: number;
  byCapabilityClass: Record<StrategyMigrationCapabilityClass, number>;
  byResolvedLanguage: Record<ResolvedStrategyLanguage, number>;
  /** Records this ticket must archive: legacy strategies only. */
  archivable: number;
  /** Legacy strategies needing human resolution before regeneration. */
  ambiguousLegacyStrategies: number;
  /** Records with a `file_path` whose bytes could not be read. */
  missingAttachments: number;
  softDeleted: number;
}

export interface StrategyInventorySnapshot {
  snapshotId: string;
  capturedAt: string;
  inventoryVersion: number;
  classifierVersion: number;
  entries: StrategyInventoryEntry[];
  counts: StrategyInventoryCounts;
}

// =============================================================================
// Inventory
// =============================================================================

function hashOrNull(value: string | null | undefined, sha256: Sha256Fn): string | null {
  if (value == null || value === '') return null;
  return sha256(value);
}

/**
 * Resolve the readiness axis for a record.
 *
 * Persisted readiness always wins when the additive schema recorded one. When
 * it did not, readiness is derived from language and is deliberately
 * conservative: a Python or ambiguous record is `blocked`, and a C++ record is
 * `unvalidated` -- NOT `admitted`. Deriving `admitted` here would let the
 * inventory authorize execution, which section 5.3.1 reserves for the shared
 * admission operation as the only writer of that transition.
 */
function resolveReadiness(
  persisted: StrategyExecutionReadiness | null | undefined,
  language: ResolvedStrategyLanguage,
): StrategyExecutionReadiness {
  if (persisted != null) return persisted;
  return language === 'cpp' ? 'unvalidated' : 'blocked';
}

/**
 * Resolve the semantic-equivalence axis.
 *
 * A legacy Python record is `not_applicable` per section 5.1 -- there is no
 * replacement to compare against. Anything else without persisted state is
 * `unassessed`. This axis is never inferred from executability.
 */
function resolveSemantic(
  persisted: StrategySemanticEquivalence | null | undefined,
  language: ResolvedStrategyLanguage,
): StrategySemanticEquivalence {
  if (persisted != null) return persisted;
  return language === 'python' ? 'not_applicable' : 'unassessed';
}

function toEvidence(record: StrategyInventoryRecordInput): StrategyLanguageEvidence {
  return {
    dbCode: record.dbCode ?? null,
    filePath: record.filePath ?? null,
    attachmentCode: record.attachmentCode ?? null,
    attachmentReadable: record.attachmentReadable,
    classificationMetadata: record.classificationMetadata ?? null,
    artifactKind: record.artifactKind ?? null,
  };
}

/**
 * AC-1: resolve every supplied record exactly once onto the three independent
 * axes, and pin the section 5.1.1 consistency snapshot for each.
 *
 * Duplicate `(id, parentKind)` pairs are a caller defect and throw rather than
 * being silently de-duplicated: AC-1 says "exactly once", and quietly dropping
 * one of two rows that disagree would hide precisely the inconsistency the
 * inventory exists to surface. Note that `id` alone is NOT unique across the
 * union view in principle -- the two tables have independent id sequences -- so
 * identity here is the pair, never the bare id.
 */
export function buildStrategyMigrationInventory(
  records: readonly StrategyInventoryRecordInput[],
  options: StrategyInventoryOptions,
): StrategyInventorySnapshot {
  const { sha256, snapshotId, capturedAt } = options;

  const seen = new Set<string>();
  const entries: StrategyInventoryEntry[] = [];

  for (const record of records) {
    const identity = `${record.parentKind}:${record.id}`;
    if (seen.has(identity)) {
      throw new Error(
        `TICKET_661_1 inventory: record ${identity} supplied more than once. ` +
          'AC-1 requires every record to resolve exactly once; de-duplicating ' +
          'silently would hide a genuine source inconsistency.',
      );
    }
    seen.add(identity);

    const classification = classifyStrategyLanguageEvidence(toEvidence(record));
    const language = classification.language;
    const capabilityClass = capabilityClassForParentKind(record.parentKind);

    entries.push({
      id: record.id,
      parentKind: record.parentKind,
      capabilityClass,
      // Only legacy saved strategies are archived/regenerated by this ticket.
      archivable: capabilityClass === 'legacy_strategy',
      strategyName: record.strategyName ?? null,
      version: record.version ?? null,
      updateTime: record.updateTime ?? null,
      deleted: record.deleted === true,
      axes: {
        resolvedLanguage: language,
        executionReadiness: resolveReadiness(record.executionReadiness, language),
        semanticEquivalence: resolveSemantic(record.semanticEquivalence, language),
      },
      hashes: {
        dbCodeSha256: hashOrNull(record.dbCode, sha256),
        attachmentPath: record.filePath ?? null,
        attachmentSha256: hashOrNull(record.attachmentCode, sha256),
        attachmentMissing: classification.missingAttachment,
      },
      classification,
    });
  }

  return {
    snapshotId,
    capturedAt,
    inventoryVersion: STRATEGY_MIGRATION_INVENTORY_VERSION,
    classifierVersion: STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
    entries,
    counts: summarizeInventory(entries),
  };
}

function summarizeInventory(
  entries: readonly StrategyInventoryEntry[],
): StrategyInventoryCounts {
  const counts: StrategyInventoryCounts = {
    total: entries.length,
    byCapabilityClass: { legacy_strategy: 0, research_artifact: 0 },
    byResolvedLanguage: { cpp: 0, python: 0, ambiguous: 0 },
    archivable: 0,
    ambiguousLegacyStrategies: 0,
    missingAttachments: 0,
    softDeleted: 0,
  };

  for (const entry of entries) {
    counts.byCapabilityClass[entry.capabilityClass] += 1;
    counts.byResolvedLanguage[entry.axes.resolvedLanguage] += 1;
    if (entry.archivable) counts.archivable += 1;
    if (entry.archivable && entry.axes.resolvedLanguage === 'ambiguous') {
      counts.ambiguousLegacyStrategies += 1;
    }
    if (entry.hashes.attachmentMissing) counts.missingAttachments += 1;
    if (entry.deleted) counts.softDeleted += 1;
  }

  return counts;
}

// =============================================================================
// Consistency recheck (section 5.1.1)
// =============================================================================

/** Why a record's pinned snapshot no longer matches what is on disk / in the DB. */
export type SnapshotDivergenceReason =
  | 'db_code_changed'
  | 'attachment_changed'
  | 'attachment_disappeared'
  | 'attachment_appeared'
  | 'row_version_changed';

export interface SnapshotDivergence {
  reason: SnapshotDivergenceReason;
  detail: string;
}

export type SnapshotVerification =
  | { unchanged: true }
  | { unchanged: false; divergences: SnapshotDivergence[] };

/**
 * AC-2 / section 5.1.1: re-verify one record against its pinned snapshot
 * immediately before an archive is published.
 *
 * Any divergence invalidates that record's inventory result -- the archive is
 * not published, the record is reported as changed-under-migration, and a
 * rescan is required. This is what makes "byte-exact" in AC-2 true: without it
 * an archive could combine metadata captured at one instant with source bytes
 * captured at another.
 *
 * All divergences are collected rather than returning on the first, so the
 * remedy can tell the user everything that moved in one pass.
 */
export function verifySnapshotEntryUnchanged(
  pinned: StrategyInventoryEntry,
  current: {
    version?: number | null;
    dbCode?: string | null;
    attachmentCode?: string | null;
    attachmentReadable?: boolean;
  },
  sha256: Sha256Fn,
): SnapshotVerification {
  const divergences: SnapshotDivergence[] = [];

  const currentDbHash = hashOrNull(current.dbCode, sha256);
  if (currentDbHash !== pinned.hashes.dbCodeSha256) {
    divergences.push({
      reason: 'db_code_changed',
      detail:
        `DB code hash changed: pinned ${pinned.hashes.dbCodeSha256 ?? '(absent)'} ` +
        `-> current ${currentDbHash ?? '(absent)'}`,
    });
  }

  const currentAttachmentHash = hashOrNull(current.attachmentCode, sha256);
  if (currentAttachmentHash !== pinned.hashes.attachmentSha256) {
    // Distinguish the three shapes so the remedy is actionable rather than a
    // bare "something changed".
    let reason: SnapshotDivergenceReason = 'attachment_changed';
    if (pinned.hashes.attachmentSha256 != null && currentAttachmentHash == null) {
      reason = 'attachment_disappeared';
    } else if (pinned.hashes.attachmentSha256 == null && currentAttachmentHash != null) {
      reason = 'attachment_appeared';
    }
    divergences.push({
      reason,
      detail:
        `Attachment hash changed at ${pinned.hashes.attachmentPath ?? '(no path)'}: ` +
        `pinned ${pinned.hashes.attachmentSha256 ?? '(absent)'} ` +
        `-> current ${currentAttachmentHash ?? '(absent)'}`,
    });
  }

  if (current.version !== undefined && current.version !== pinned.version) {
    divergences.push({
      reason: 'row_version_changed',
      detail: `Row version changed: pinned ${pinned.version ?? '(none)'} -> current ${current.version ?? '(none)'}`,
    });
  }

  return divergences.length === 0 ? { unchanged: true } : { unchanged: false, divergences };
}
