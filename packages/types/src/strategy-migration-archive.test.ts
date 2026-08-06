/**
 * TICKET_661_1 AC-2 / AC-8: the immutable archive.
 *
 * The filesystem is a real in-memory implementation rather than per-call stubs,
 * so staging, mutation, omission, and the atomic rename are exercised as an
 * actual sequence. A stubbed `verify` that always returns true would let this
 * suite pass while the archive silently published mutated bytes -- which is the
 * failure AC-2 exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  archiveLegacyStrategyRecord,
  buildArchiveManifest,
  verifyStagedArchive,
  ARCHIVE_DB_CODE_FILENAME,
  ARCHIVE_MANIFEST_FILENAME,
  ARCHIVE_ATTACHMENT_FILENAME,
  STRATEGY_ARCHIVE_SCHEMA_VERSION,
  type ArchiveFileSystem,
} from './strategy-migration-archive';
import {
  buildStrategyMigrationInventory,
  type StrategyInventoryEntry,
  type StrategyInventoryRecordInput,
} from './strategy-migration-inventory';

const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf-8').digest('hex');

const PYTHON_SOURCE = `
import backtrader as bt
class MyPyStrategy(bt.Strategy):
    def next(self):
        self.buy()
`;

/** Minimal in-memory filesystem with a genuinely atomic rename. */
function memoryFs(): ArchiveFileSystem & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    join: (...segments) => segments.join('/'),
    mkdirp(path) {
      dirs.add(path);
    },
    writeFile(path, contents) {
      files.set(path, contents);
    },
    readFile(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    exists: (path) => files.has(path) || dirs.has(path),
    rename(from, to) {
      for (const [path, contents] of [...files]) {
        if (path.startsWith(from + '/')) {
          files.set(to + path.slice(from.length), contents);
          files.delete(path);
        }
      }
      dirs.delete(from);
      dirs.add(to);
    },
    removeDir(path) {
      for (const key of [...files.keys()]) {
        if (key.startsWith(path + '/')) files.delete(key);
      }
      dirs.delete(path);
    },
  };
}

function entryFor(record: StrategyInventoryRecordInput): StrategyInventoryEntry {
  return buildStrategyMigrationInventory([record], {
    snapshotId: 'snap-1',
    capturedAt: '2026-08-01T00:00:00Z',
    sha256,
  }).entries[0];
}

const LEGACY_RECORD: StrategyInventoryRecordInput = {
  id: 61,
  parentKind: 'algorithm',
  version: 3,
  strategyName: 'Legacy Momentum',
  dbCode: PYTHON_SOURCE,
  filePath: '/s/a.py',
  attachmentCode: PYTHON_SOURCE,
  attachmentReadable: true,
};

function archiveInput(entry: StrategyInventoryEntry, overrides: Record<string, unknown> = {}) {
  return {
    entry,
    currentDbCode: PYTHON_SOURCE,
    currentAttachmentCode: PYTHON_SOURCE,
    currentAttachmentReadable: true,
    currentVersion: 3,
    stagingDir: '/archives/.staging/61',
    publishDir: '/archives/61',
    createdAt: '2026-08-01T00:00:00Z',
    applicationVersion: '1.0.0',
    ...overrides,
  };
}

describe('AC-2: byte-exact archive with separate hashes', () => {
  it('publishes a legacy strategy with source, metadata, and manifest', () => {
    const fs = memoryFs();
    const result = archiveLegacyStrategyRecord(archiveInput(entryFor(LEGACY_RECORD)), fs, sha256);

    expect(result.published).toBe(true);
    if (!result.published) throw new Error('unreachable');

    // Published under the final path; staging is gone.
    expect(fs.exists('/archives/61')).toBe(true);
    expect(fs.exists('/archives/.staging/61')).toBe(false);
    expect(fs.readFile(`/archives/61/${ARCHIVE_DB_CODE_FILENAME}`)).toBe(PYTHON_SOURCE);
    expect(fs.readFile(`/archives/61/${ARCHIVE_ATTACHMENT_FILENAME}`)).toBe(PYTHON_SOURCE);

    const manifest = JSON.parse(fs.readFile(`/archives/61/${ARCHIVE_MANIFEST_FILENAME}`));
    expect(manifest.archiveSchemaVersion).toBe(STRATEGY_ARCHIVE_SCHEMA_VERSION);
    expect(manifest.record.strategyName).toBe('Legacy Momentum');
    expect(manifest.record.resolvedLanguage).toBe('python');
    expect(manifest.dbCodeSha256).toBe(sha256(PYTHON_SOURCE));
    expect(manifest.files.map((f: { filename: string }) => f.filename).sort()).toEqual([
      ARCHIVE_ATTACHMENT_FILENAME,
      ARCHIVE_DB_CODE_FILENAME,
    ]);
  });

  it('records byte length rather than string length for multi-byte source', () => {
    // A truncated multi-byte file would otherwise pass an omission check.
    const source = 'x = "ééé"\nimport backtrader as bt\n';
    const manifest = buildArchiveManifest(
      {
        entry: entryFor({ ...LEGACY_RECORD, dbCode: source, attachmentCode: undefined }),
        createdAt: '2026-08-01T00:00:00Z',
        applicationVersion: '1.0.0',
      },
      { dbCode: source, attachmentCode: null },
      sha256,
    );
    expect(manifest.files[0].byteLength).toBe(Buffer.byteLength(source, 'utf-8'));
    expect(manifest.files[0].byteLength).toBeGreaterThan(source.length);
  });

  it('archives the missing-attachment finding rather than dropping it', () => {
    const entry = entryFor({
      ...LEGACY_RECORD,
      attachmentCode: undefined,
      attachmentReadable: false,
    });
    const fs = memoryFs();
    const result = archiveLegacyStrategyRecord(
      archiveInput(entry, { currentAttachmentCode: null, currentAttachmentReadable: false }),
      fs,
      sha256,
    );
    expect(result.published).toBe(true);
    if (!result.published) throw new Error('unreachable');
    expect(result.manifest.record.attachmentMissing).toBe(true);
    expect(result.manifest.attachmentSha256).toBeNull();
  });
});

describe('AC-2: verification fails on omission and on mutation, distinctly', () => {
  it('fails when a manifest file is absent from the archive', () => {
    const fs = memoryFs();
    const entry = entryFor(LEGACY_RECORD);
    const manifest = buildArchiveManifest(
      { entry, createdAt: '2026-08-01T00:00:00Z', applicationVersion: '1.0.0' },
      { dbCode: PYTHON_SOURCE, attachmentCode: PYTHON_SOURCE },
      sha256,
    );
    fs.writeFile(`/stage/${ARCHIVE_DB_CODE_FILENAME}`, PYTHON_SOURCE);
    // attachment deliberately not written

    const verdict = verifyStagedArchive(manifest, '/stage', fs, sha256);
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error('unreachable');
    expect(verdict.problems.join(' ')).toMatch(/omitted/);
  });

  it('fails when a staged file was mutated after writing', () => {
    const fs = memoryFs();
    const entry = entryFor(LEGACY_RECORD);
    const manifest = buildArchiveManifest(
      { entry, createdAt: '2026-08-01T00:00:00Z', applicationVersion: '1.0.0' },
      { dbCode: PYTHON_SOURCE, attachmentCode: null },
      sha256,
    );
    fs.writeFile(`/stage/${ARCHIVE_DB_CODE_FILENAME}`, PYTHON_SOURCE + '# tampered\n');

    const verdict = verifyStagedArchive(manifest, '/stage', fs, sha256);
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error('unreachable');
    expect(verdict.problems.join(' ')).toMatch(/mutated/);
  });
});

describe('section 5.1.1: publication is refused when the record moved', () => {
  it('refuses when the DB code changed between inventory and publish', () => {
    const fs = memoryFs();
    const result = archiveLegacyStrategyRecord(
      archiveInput(entryFor(LEGACY_RECORD), { currentDbCode: PYTHON_SOURCE + '# edited\n' }),
      fs,
      sha256,
    );
    expect(result.published).toBe(false);
    if (result.published) throw new Error('unreachable');
    expect(result.refusal.code).toBe('changed_under_migration');
    expect(result.refusal.divergences?.map((d) => d.reason)).toContain('db_code_changed');
    // Nothing was published.
    expect(fs.exists('/archives/61')).toBe(false);
  });

  it('refuses when only the attachment changed', () => {
    const fs = memoryFs();
    const result = archiveLegacyStrategyRecord(
      archiveInput(entryFor(LEGACY_RECORD), {
        currentAttachmentCode: PYTHON_SOURCE + '# edited\n',
      }),
      fs,
      sha256,
    );
    expect(result.published).toBe(false);
    if (result.published) throw new Error('unreachable');
    expect(result.refusal.code).toBe('changed_under_migration');
    expect(fs.exists('/archives/61')).toBe(false);
  });

  it('refuses when the row version moved even though bytes match', () => {
    const fs = memoryFs();
    const result = archiveLegacyStrategyRecord(
      archiveInput(entryFor(LEGACY_RECORD), { currentVersion: 4 }),
      fs,
      sha256,
    );
    expect(result.published).toBe(false);
    if (result.published) throw new Error('unreachable');
    expect(result.refusal.divergences?.map((d) => d.reason)).toContain('row_version_changed');
  });
});

describe('section 3.2 / 7: research artifacts are refused at the archive boundary', () => {
  it('refuses to archive a nona_signal research artifact', () => {
    // Defence at the layer that owns the invariant: even if a caller passes the
    // unfiltered view, the 12,556 signal rows cannot enter the archive path.
    const entry = entryFor({ id: 8544, parentKind: 'signal', dbCode: PYTHON_SOURCE });
    const fs = memoryFs();
    const result = archiveLegacyStrategyRecord(archiveInput(entry), fs, sha256);

    expect(result.published).toBe(false);
    if (result.published) throw new Error('unreachable');
    expect(result.refusal.code).toBe('not_archivable');
    expect(result.refusal.detail).toMatch(/TICKET_1292_21/);
    expect(fs.files.size).toBe(0);
  });
});

describe('archives are immutable once published', () => {
  it('refuses to overwrite an existing published archive', () => {
    const fs = memoryFs();
    const first = archiveLegacyStrategyRecord(archiveInput(entryFor(LEGACY_RECORD)), fs, sha256);
    expect(first.published).toBe(true);

    const second = archiveLegacyStrategyRecord(archiveInput(entryFor(LEGACY_RECORD)), fs, sha256);
    expect(second.published).toBe(false);
    if (second.published) throw new Error('unreachable');
    expect(second.refusal.code).toBe('destination_exists');
    // The original archive is untouched.
    expect(fs.readFile(`/archives/61/${ARCHIVE_DB_CODE_FILENAME}`)).toBe(PYTHON_SOURCE);
  });

  it('leaves no staging residue when publication is refused', () => {
    const fs = memoryFs();
    archiveLegacyStrategyRecord(
      archiveInput(entryFor(LEGACY_RECORD), { currentVersion: 99 }),
      fs,
      sha256,
    );
    const staged = [...fs.files.keys()].filter((k) => k.includes('.staging'));
    expect(staged).toEqual([]);
  });

  it('cleans up staging and rethrows when the filesystem fails mid-write', () => {
    const fs = memoryFs();
    const failing: ArchiveFileSystem = {
      ...fs,
      writeFile(path, contents) {
        if (path.endsWith(ARCHIVE_MANIFEST_FILENAME)) throw new Error('ENOSPC');
        fs.writeFile(path, contents);
      },
    };
    expect(() =>
      archiveLegacyStrategyRecord(archiveInput(entryFor(LEGACY_RECORD)), failing, sha256),
    ).toThrow(/ENOSPC/);
    // No partial archive, and no staging residue.
    expect(fs.exists('/archives/61')).toBe(false);
    expect([...fs.files.keys()].filter((k) => k.includes('.staging'))).toEqual([]);
  });
});
