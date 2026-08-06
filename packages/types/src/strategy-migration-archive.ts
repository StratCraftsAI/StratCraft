/**
 * TICKET_661_1 section 5.2, AC-2: the immutable legacy-strategy archive.
 *
 * The archive is the half of the policy that must survive being wrong about
 * everything else: if regeneration fails, if classification was ambiguous, if
 * the user abandons the migration, the original Python source must still be
 * recoverable byte-for-byte. So this module owns the manifest shape, the hash
 * verification, and the staged-then-published lifecycle -- and owns them purely.
 *
 * Filesystem effects are injected through `ArchiveFileSystem`. That keeps the
 * decision logic Electron-free and public-classified (section 8 item 7) and
 * makes the failure modes testable without touching a real disk: an archive
 * writer whose "verify" step cannot be tested against a mutated file is not
 * meaningfully verifying anything.
 *
 * ---------------------------------------------------------------------------
 * Ordering, and why it is not negotiable
 * ---------------------------------------------------------------------------
 *
 * stage -> recheck pinned hashes -> verify manifest -> atomic publish
 *
 * The recheck is section 5.1.1 and it sits *between* staging and publication on
 * purpose. Inventory and archive are separate passes, so a record can be edited
 * between them; publishing without re-verifying would let an archive combine
 * metadata captured at one instant with source bytes captured at another, which
 * is exactly what AC-2's "byte-exact" forbids. Any divergence refuses
 * publication and demands a rescan rather than publishing a best-effort copy.
 *
 * Publication is atomic (stage under a temporary path, then a single rename)
 * because a half-written archive directory that looks published is worse than
 * no archive: the migration would proceed to regeneration believing the
 * original was safely captured.
 *
 * Archives are never edited after publication. There is deliberately no update
 * or append operation in this module.
 */

import type {
  StrategyInventoryEntry,
  Sha256Fn,
  SnapshotDivergence,
} from './strategy-migration-inventory';
import { verifySnapshotEntryUnchanged } from './strategy-migration-inventory';

// =============================================================================
// Contract version
// =============================================================================

/** Archive schema version, recorded in every manifest (section 5.2). */
export const STRATEGY_ARCHIVE_SCHEMA_VERSION = 1;

/** Filenames inside a published archive. Stable identifiers, not conventions. */
export const ARCHIVE_MANIFEST_FILENAME = 'manifest.json';
export const ARCHIVE_DB_CODE_FILENAME = 'source.db-code.txt';
export const ARCHIVE_ATTACHMENT_FILENAME = 'source.attachment.txt';

// =============================================================================
// Injected effects
// =============================================================================

/**
 * The filesystem surface this module needs. Injected so the owner stays pure
 * and Electron-free; Electron Main and the standalone MCP surface supply their
 * own adapters over the same contract.
 */
export interface ArchiveFileSystem {
  mkdirp(path: string): void;
  writeFile(path: string, contents: string): void;
  readFile(path: string): string;
  exists(path: string): boolean;
  /** Must be atomic within a filesystem (a rename, not a copy). */
  rename(from: string, to: string): void;
  /** Best-effort cleanup of a failed staging directory. */
  removeDir(path: string): void;
  join(...segments: string[]): string;
}

// =============================================================================
// Manifest
// =============================================================================

/**
 * One archived file's identity. Hashes are per-file, so verification can name
 * the specific file that was omitted or mutated (AC-2: "archive verification
 * fails on omission or mutation").
 */
export interface ArchiveFileEntry {
  filename: string;
  sha256: string;
  byteLength: number;
}

/**
 * The metadata section 5.2 requires alongside the source bytes. Captured from
 * the inventory snapshot so the manifest and the classification verdict cannot
 * describe different instants.
 */
export interface ArchiveRecordMetadata {
  recordId: number;
  parentKind: string;
  strategyName: string | null;
  version: number | null;
  updateTime: string | null;
  softDeleted: boolean;
  resolvedLanguage: string;
  executionReadiness: string;
  semanticEquivalence: string;
  originalFilePath: string | null;
  /**
   * Section 5.2: a missing or unreadable attachment is archived as an explicit
   * finding. Regeneration cannot then claim source completeness.
   */
  attachmentMissing: boolean;
  classifierVersion: number;
  classificationReason: string;
  classificationEvidenceJson: string;
}

export interface StrategyArchiveManifest {
  archiveSchemaVersion: number;
  createdAt: string;
  applicationVersion: string;
  record: ArchiveRecordMetadata;
  /**
   * Pinned source digests, kept separate exactly as section 5.1.1 requires:
   * DB `code` and the attachment are two distinct sources and neither is
   * silently authoritative.
   */
  dbCodeSha256: string | null;
  attachmentSha256: string | null;
  /** Manifest covering every file written (section 5.2). */
  files: ArchiveFileEntry[];
}

// =============================================================================
// Results
// =============================================================================

export type ArchiveRefusalCode =
  /** This ticket does not own the record's capability class (section 3.2 / 7). */
  | 'not_archivable'
  /** The record changed between inventory and publish (section 5.1.1). */
  | 'changed_under_migration'
  /** A staged file's bytes do not match its manifest entry. */
  | 'manifest_verification_failed'
  /** Publishing would overwrite an existing archive; archives are immutable. */
  | 'destination_exists';

export interface ArchiveRefusal {
  code: ArchiveRefusalCode;
  detail: string;
  divergences?: SnapshotDivergence[];
}

export type StrategyArchiveResult =
  | { published: true; path: string; manifest: StrategyArchiveManifest }
  | { published: false; refusal: ArchiveRefusal };

export interface StrategyArchiveInput {
  /** The pinned inventory entry for this record. */
  entry: StrategyInventoryEntry;
  /** Current DB `code` bytes, re-read immediately before publish. */
  currentDbCode?: string | null;
  /** Current attachment bytes, re-read immediately before publish. */
  currentAttachmentCode?: string | null;
  /** Whether the attachment is currently readable. */
  currentAttachmentReadable?: boolean;
  /** Current row version, re-read immediately before publish. */
  currentVersion?: number | null;
  stagingDir: string;
  publishDir: string;
  createdAt: string;
  applicationVersion: string;
}

// =============================================================================
// Archive
// =============================================================================

function fileEntry(filename: string, contents: string, sha256: Sha256Fn): ArchiveFileEntry {
  return {
    filename,
    sha256: sha256(contents),
    // Byte length, not string length: a multi-byte source would otherwise be
    // recorded short and an omission check could pass on a truncated file.
    byteLength: new TextEncoder().encode(contents).byteLength,
  };
}

/**
 * Build the manifest for one record. Pure: no filesystem access, so the
 * manifest shape is testable independently of writing it.
 */
export function buildArchiveManifest(
  input: Pick<StrategyArchiveInput, 'entry' | 'createdAt' | 'applicationVersion'>,
  sources: { dbCode: string | null; attachmentCode: string | null },
  sha256: Sha256Fn,
): StrategyArchiveManifest {
  const { entry } = input;
  const files: ArchiveFileEntry[] = [];
  if (sources.dbCode != null) {
    files.push(fileEntry(ARCHIVE_DB_CODE_FILENAME, sources.dbCode, sha256));
  }
  if (sources.attachmentCode != null) {
    files.push(fileEntry(ARCHIVE_ATTACHMENT_FILENAME, sources.attachmentCode, sha256));
  }

  return {
    archiveSchemaVersion: STRATEGY_ARCHIVE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    applicationVersion: input.applicationVersion,
    record: {
      recordId: entry.id,
      parentKind: entry.parentKind,
      strategyName: entry.strategyName,
      version: entry.version,
      updateTime: entry.updateTime,
      softDeleted: entry.deleted,
      resolvedLanguage: entry.axes.resolvedLanguage,
      executionReadiness: entry.axes.executionReadiness,
      semanticEquivalence: entry.axes.semanticEquivalence,
      originalFilePath: entry.hashes.attachmentPath,
      attachmentMissing: entry.hashes.attachmentMissing,
      classifierVersion: entry.classification.classifierVersion,
      classificationReason: entry.classification.reason,
      classificationEvidenceJson: JSON.stringify({
        signals: entry.classification.signals,
        conflicts: entry.classification.conflicts,
      }),
    },
    dbCodeSha256: entry.hashes.dbCodeSha256,
    attachmentSha256: entry.hashes.attachmentSha256,
    files,
  };
}

/**
 * AC-2: verify a staged archive against its manifest.
 *
 * Fails on **omission** (a manifest entry with no file on disk) and on
 * **mutation** (a file whose bytes no longer hash to the manifest value). Both
 * are required by AC-2 and they are genuinely different failures, so they are
 * reported distinctly rather than as one "invalid archive".
 */
export function verifyStagedArchive(
  manifest: StrategyArchiveManifest,
  stagingDir: string,
  fs: ArchiveFileSystem,
  sha256: Sha256Fn,
): { valid: true } | { valid: false; problems: string[] } {
  const problems: string[] = [];

  for (const file of manifest.files) {
    const path = fs.join(stagingDir, file.filename);
    if (!fs.exists(path)) {
      problems.push(`omitted: ${file.filename} is in the manifest but absent from the archive`);
      continue;
    }
    const contents = fs.readFile(path);
    const actual = sha256(contents);
    if (actual !== file.sha256) {
      problems.push(
        `mutated: ${file.filename} hashes ${actual}, manifest pins ${file.sha256}`,
      );
    }
  }

  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

/**
 * Stage, re-verify, and atomically publish one record's immutable archive.
 *
 * Refuses rather than publishing a partial or stale archive. Every refusal
 * leaves the original record and any previously published archive untouched.
 */
export function archiveLegacyStrategyRecord(
  input: StrategyArchiveInput,
  fs: ArchiveFileSystem,
  sha256: Sha256Fn,
): StrategyArchiveResult {
  const { entry } = input;

  // Section 3.2 / 7: research artifacts belong to TICKET_1292_21. Refusing here
  // -- rather than trusting callers to filter -- is what keeps 12,556 signal
  // rows out of the archive path even if a caller passes the unfiltered view.
  if (!entry.archivable) {
    return {
      published: false,
      refusal: {
        code: 'not_archivable',
        detail:
          `Record ${entry.parentKind}:${entry.id} is a ${entry.capabilityClass}. ` +
          'TICKET_661_1 archives legacy saved strategies only; Signal Discovery ' +
          'research artifacts are owned by TICKET_1292_21 and must not be ' +
          'archived, rewritten, or removed by this policy.',
      },
    };
  }

  // Archives are immutable: never overwrite an existing publication.
  if (fs.exists(input.publishDir)) {
    return {
      published: false,
      refusal: {
        code: 'destination_exists',
        detail:
          `An archive already exists at ${input.publishDir}. Published archives ` +
          'are immutable and are never edited or replaced.',
      },
    };
  }

  // Section 5.1.1: re-verify the pinned hashes BEFORE publishing.
  const verification = verifySnapshotEntryUnchanged(
    entry,
    {
      version: input.currentVersion,
      dbCode: input.currentDbCode,
      attachmentCode: input.currentAttachmentCode,
      attachmentReadable: input.currentAttachmentReadable,
    },
    sha256,
  );
  if (!verification.unchanged) {
    return {
      published: false,
      refusal: {
        code: 'changed_under_migration',
        detail:
          `Record ${entry.parentKind}:${entry.id} changed between inventory and ` +
          'archive publication. The archive was not published; re-run the ' +
          'inventory so metadata and source bytes describe the same instant.',
        divergences: verification.divergences,
      },
    };
  }

  const dbCode = input.currentDbCode ?? null;
  const attachmentCode = input.currentAttachmentCode ?? null;
  const manifest = buildArchiveManifest(input, { dbCode, attachmentCode }, sha256);

  // Stage.
  fs.mkdirp(input.stagingDir);
  try {
    if (dbCode != null) {
      fs.writeFile(fs.join(input.stagingDir, ARCHIVE_DB_CODE_FILENAME), dbCode);
    }
    if (attachmentCode != null) {
      fs.writeFile(fs.join(input.stagingDir, ARCHIVE_ATTACHMENT_FILENAME), attachmentCode);
    }
    fs.writeFile(
      fs.join(input.stagingDir, ARCHIVE_MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
    );

    // Verify the staged bytes against the manifest before publishing.
    const staged = verifyStagedArchive(manifest, input.stagingDir, fs, sha256);
    if (!staged.valid) {
      fs.removeDir(input.stagingDir);
      return {
        published: false,
        refusal: {
          code: 'manifest_verification_failed',
          detail: `Staged archive failed manifest verification: ${staged.problems.join('; ')}`,
        },
      };
    }

    // Atomic publish.
    fs.rename(input.stagingDir, input.publishDir);
  } catch (error) {
    fs.removeDir(input.stagingDir);
    throw error;
  }

  return { published: true, path: input.publishDir, manifest };
}
