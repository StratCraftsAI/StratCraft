/**
 * TICKET_661_1 AC-1 / AC-2 / AC-8: deterministic inventory and the section
 * 5.1.1 consistency snapshot.
 *
 * Coverage targets the shapes AC-8 names explicitly plus the section 3.2
 * capability split, because that split is the correction this change set
 * exists to make: the original design counted `nona_algorithms` only (65 rows)
 * when the executable surface is `v_algorithms_all` (23,291 rows, >99% Python
 * research artifacts owned by TICKET_1292_21).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildStrategyMigrationInventory,
  capabilityClassForParentKind,
  verifySnapshotEntryUnchanged,
  STRATEGY_MIGRATION_INVENTORY_VERSION,
  type StrategyInventoryRecordInput,
} from './strategy-migration-inventory';

const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf-8').digest('hex');

const OPTIONS = { snapshotId: 'snap-1', capturedAt: '2026-08-01T00:00:00Z', sha256 };

const CPP_SOURCE = `
#include <stratforge/strategy.hpp>
class MyStrategy : public stratforge::Strategy {};
QNX_STRATEGY_FACTORY_EXPORT(MyStrategy)
`;

const PYTHON_SOURCE = `
import backtrader as bt
class MyPyStrategy(bt.Strategy):
    def next(self):
        self.buy()
`;

function build(records: StrategyInventoryRecordInput[]) {
  return buildStrategyMigrationInventory(records, OPTIONS);
}

describe('AC-1: capability split by parent kind (section 3.2 / 5.1.1 / 7)', () => {
  it('maps parent kinds to capability classes', () => {
    expect(capabilityClassForParentKind('algorithm')).toBe('legacy_strategy');
    expect(capabilityClassForParentKind('signal')).toBe('research_artifact');
  });

  it('marks nona_signal research artifacts non-archivable even when Python', () => {
    // The 12,556-row shape: Python research artifacts reachable through
    // v_algorithms_all. This ticket accounts for them and must NOT archive them.
    const snapshot = build([
      {
        id: 8544,
        parentKind: 'signal',
        dbCode: PYTHON_SOURCE,
        classificationMetadata: '{"language":"python"}',
      },
    ]);

    const entry = snapshot.entries[0];
    expect(entry.capabilityClass).toBe('research_artifact');
    expect(entry.archivable).toBe(false);
    // Still classified and counted -- accounting is required, archiving is not.
    expect(entry.axes.resolvedLanguage).toBe('python');
    expect(snapshot.counts.archivable).toBe(0);
    expect(snapshot.counts.byCapabilityClass.research_artifact).toBe(1);
  });

  it('marks nona_algorithms legacy strategies archivable', () => {
    const snapshot = build([
      { id: 61, parentKind: 'algorithm', dbCode: PYTHON_SOURCE, filePath: '/s/a.py' },
    ]);
    expect(snapshot.entries[0].capabilityClass).toBe('legacy_strategy');
    expect(snapshot.entries[0].archivable).toBe(true);
    expect(snapshot.counts.archivable).toBe(1);
  });

  it('counts a mixed population the way the real view is shaped', () => {
    const snapshot = build([
      { id: 61, parentKind: 'algorithm', dbCode: CPP_SOURCE, filePath: '/s/a.cpp' },
      { id: 62, parentKind: 'algorithm', dbCode: PYTHON_SOURCE },
      { id: 8544, parentKind: 'signal', dbCode: PYTHON_SOURCE },
      { id: 8545, parentKind: 'signal', dbCode: PYTHON_SOURCE, deleted: true },
    ]);

    expect(snapshot.counts.total).toBe(4);
    expect(snapshot.counts.byCapabilityClass).toEqual({
      legacy_strategy: 2,
      research_artifact: 2,
    });
    expect(snapshot.counts.byResolvedLanguage.python).toBe(3);
    expect(snapshot.counts.byResolvedLanguage.cpp).toBe(1);
    // Only the two algorithm rows are this ticket's to archive.
    expect(snapshot.counts.archivable).toBe(2);
    expect(snapshot.counts.softDeleted).toBe(1);
  });

  it('inventories soft-deleted records rather than skipping them', () => {
    // AC-1 says "every active and soft-deleted saved strategy".
    const snapshot = build([
      { id: 61, parentKind: 'algorithm', dbCode: PYTHON_SOURCE, deleted: true },
    ]);
    expect(snapshot.counts.total).toBe(1);
    expect(snapshot.entries[0].deleted).toBe(true);
    expect(snapshot.entries[0].archivable).toBe(true);
  });
});

describe('AC-1: identity is the (parentKind, id) pair, and resolves exactly once', () => {
  it('accepts the same id from both tables as two distinct records', () => {
    // The two tables have independent id sequences; a bare id is not identity.
    const snapshot = build([
      { id: 100, parentKind: 'algorithm', dbCode: CPP_SOURCE },
      { id: 100, parentKind: 'signal', dbCode: PYTHON_SOURCE },
    ]);
    expect(snapshot.counts.total).toBe(2);
  });

  it('throws rather than silently de-duplicating a repeated record', () => {
    expect(() =>
      build([
        { id: 61, parentKind: 'algorithm', dbCode: CPP_SOURCE },
        { id: 61, parentKind: 'algorithm', dbCode: PYTHON_SOURCE },
      ]),
    ).toThrow(/supplied more than once/);
  });
});

describe('AC-8: the section 3.1 bypass shapes classify without a C++ default', () => {
  const BYPASS_METADATA: readonly (string | null)[] = [null, '', 'not json at all', '{oops'];

  for (const metadata of BYPASS_METADATA) {
    it(`resolves a code-only Python record to python with metadata=${JSON.stringify(metadata)}`, () => {
      // The exact shape section 3.1 traced: DB code only, no file_path, and
      // absent/empty/non-JSON classification_metadata. It must never resolve cpp.
      const snapshot = build([
        {
          id: 61,
          parentKind: 'algorithm',
          dbCode: PYTHON_SOURCE,
          filePath: null,
          classificationMetadata: metadata,
        },
      ]);
      expect(snapshot.entries[0].axes.resolvedLanguage).toBe('python');
      expect(snapshot.entries[0].axes.executionReadiness).toBe('blocked');
    });
  }

  it('resolves a .cpp-named attachment containing Python to ambiguous', () => {
    const snapshot = build([
      {
        id: 61,
        parentKind: 'algorithm',
        filePath: '/s/strategy.cpp',
        attachmentCode: PYTHON_SOURCE,
        attachmentReadable: true,
      },
    ]);
    expect(snapshot.entries[0].axes.resolvedLanguage).toBe('ambiguous');
    expect(snapshot.entries[0].classification.conflicts.length).toBeGreaterThan(0);
  });

  it('resolves a DB code column disagreeing with its attachment to ambiguous', () => {
    const snapshot = build([
      {
        id: 61,
        parentKind: 'algorithm',
        dbCode: CPP_SOURCE,
        filePath: '/s/strategy.py',
        attachmentCode: PYTHON_SOURCE,
        attachmentReadable: true,
      },
    ]);
    expect(snapshot.entries[0].axes.resolvedLanguage).toBe('ambiguous');
  });

  it('records a missing attachment as an explicit finding', () => {
    const snapshot = build([
      {
        id: 61,
        parentKind: 'algorithm',
        dbCode: PYTHON_SOURCE,
        filePath: '/s/gone.py',
        attachmentReadable: false,
      },
    ]);
    expect(snapshot.entries[0].hashes.attachmentMissing).toBe(true);
    expect(snapshot.entries[0].hashes.attachmentSha256).toBeNull();
    expect(snapshot.counts.missingAttachments).toBe(1);
  });

  it('resolves a record with no source at all to ambiguous, never cpp', () => {
    const snapshot = build([{ id: 61, parentKind: 'algorithm' }]);
    expect(snapshot.entries[0].axes.resolvedLanguage).toBe('ambiguous');
    expect(snapshot.counts.ambiguousLegacyStrategies).toBe(1);
  });
});

describe('section 5.1: the three axes stay independent', () => {
  it('never derives admitted from a cpp verdict', () => {
    // Only the shared admission operation may write `admitted` (section 5.3.1).
    const snapshot = build([{ id: 61, parentKind: 'algorithm', dbCode: CPP_SOURCE }]);
    expect(snapshot.entries[0].axes.resolvedLanguage).toBe('cpp');
    expect(snapshot.entries[0].axes.executionReadiness).toBe('unvalidated');
    expect(snapshot.entries[0].axes.executionReadiness).not.toBe('admitted');
  });

  it('blocks python and ambiguous records when no readiness is persisted', () => {
    const snapshot = build([
      { id: 61, parentKind: 'algorithm', dbCode: PYTHON_SOURCE },
      { id: 62, parentKind: 'algorithm' },
    ]);
    expect(snapshot.entries[0].axes.executionReadiness).toBe('blocked');
    expect(snapshot.entries[1].axes.executionReadiness).toBe('blocked');
  });

  it('prefers persisted axes over derived ones', () => {
    const snapshot = build([
      {
        id: 61,
        parentKind: 'algorithm',
        dbCode: CPP_SOURCE,
        executionReadiness: 'admitted',
        semanticEquivalence: 'accepted_without_parity',
      },
    ]);
    expect(snapshot.entries[0].axes.executionReadiness).toBe('admitted');
    expect(snapshot.entries[0].axes.semanticEquivalence).toBe('accepted_without_parity');
  });

  it('marks a legacy python record not_applicable for semantic equivalence', () => {
    const snapshot = build([{ id: 61, parentKind: 'algorithm', dbCode: PYTHON_SOURCE }]);
    expect(snapshot.entries[0].axes.semanticEquivalence).toBe('not_applicable');
  });
});

describe('AC-2 / section 5.1.1: DB code and attachment are pinned separately', () => {
  it('pins two independent digests', () => {
    const snapshot = build([
      {
        id: 61,
        parentKind: 'algorithm',
        dbCode: CPP_SOURCE,
        filePath: '/s/a.cpp',
        attachmentCode: CPP_SOURCE + '// attachment differs\n',
        attachmentReadable: true,
      },
    ]);
    const { hashes } = snapshot.entries[0];
    expect(hashes.dbCodeSha256).toBe(sha256(CPP_SOURCE));
    expect(hashes.attachmentSha256).not.toBe(hashes.dbCodeSha256);
  });

  it('records the inventory and classifier versions', () => {
    const snapshot = build([{ id: 61, parentKind: 'algorithm', dbCode: CPP_SOURCE }]);
    expect(snapshot.inventoryVersion).toBe(STRATEGY_MIGRATION_INVENTORY_VERSION);
    expect(snapshot.classifierVersion).toBe(snapshot.entries[0].classification.classifierVersion);
  });
});

describe('AC-2 / section 5.1.1: the pre-publish consistency recheck', () => {
  const pinned = () =>
    build([
      {
        id: 61,
        parentKind: 'algorithm',
        version: 3,
        dbCode: PYTHON_SOURCE,
        filePath: '/s/a.py',
        attachmentCode: PYTHON_SOURCE,
        attachmentReadable: true,
      },
    ]).entries[0];

  it('passes when nothing moved', () => {
    const result = verifySnapshotEntryUnchanged(
      pinned(),
      { version: 3, dbCode: PYTHON_SOURCE, attachmentCode: PYTHON_SOURCE },
      sha256,
    );
    expect(result.unchanged).toBe(true);
  });

  it('fails when the DB code changed', () => {
    const result = verifySnapshotEntryUnchanged(
      pinned(),
      { version: 3, dbCode: PYTHON_SOURCE + '# edited\n', attachmentCode: PYTHON_SOURCE },
      sha256,
    );
    expect(result.unchanged).toBe(false);
    if (result.unchanged) throw new Error('unreachable');
    expect(result.divergences.map((d) => d.reason)).toContain('db_code_changed');
  });

  it('fails when only the attachment changed', () => {
    // The reason the two digests are separate: a DB-only recheck would pass.
    const result = verifySnapshotEntryUnchanged(
      pinned(),
      { version: 3, dbCode: PYTHON_SOURCE, attachmentCode: PYTHON_SOURCE + '# edited\n' },
      sha256,
    );
    expect(result.unchanged).toBe(false);
    if (result.unchanged) throw new Error('unreachable');
    expect(result.divergences.map((d) => d.reason)).toContain('attachment_changed');
  });

  it('distinguishes a disappeared attachment from a mutated one', () => {
    const result = verifySnapshotEntryUnchanged(
      pinned(),
      { version: 3, dbCode: PYTHON_SOURCE, attachmentCode: null },
      sha256,
    );
    expect(result.unchanged).toBe(false);
    if (result.unchanged) throw new Error('unreachable');
    expect(result.divergences.map((d) => d.reason)).toContain('attachment_disappeared');
  });

  it('detects an attachment that appeared after inventory', () => {
    const entry = build([
      { id: 61, parentKind: 'algorithm', version: 1, dbCode: PYTHON_SOURCE },
    ]).entries[0];
    const result = verifySnapshotEntryUnchanged(
      entry,
      { version: 1, dbCode: PYTHON_SOURCE, attachmentCode: PYTHON_SOURCE },
      sha256,
    );
    expect(result.unchanged).toBe(false);
    if (result.unchanged) throw new Error('unreachable');
    expect(result.divergences.map((d) => d.reason)).toContain('attachment_appeared');
  });

  it('fails when the row version moved even with identical bytes', () => {
    const result = verifySnapshotEntryUnchanged(
      pinned(),
      { version: 4, dbCode: PYTHON_SOURCE, attachmentCode: PYTHON_SOURCE },
      sha256,
    );
    expect(result.unchanged).toBe(false);
    if (result.unchanged) throw new Error('unreachable');
    expect(result.divergences.map((d) => d.reason)).toContain('row_version_changed');
  });

  it('reports every divergence in one pass rather than only the first', () => {
    const result = verifySnapshotEntryUnchanged(
      pinned(),
      { version: 9, dbCode: 'x', attachmentCode: 'y' },
      sha256,
    );
    expect(result.unchanged).toBe(false);
    if (result.unchanged) throw new Error('unreachable');
    expect(result.divergences.map((d) => d.reason).sort()).toEqual([
      'attachment_changed',
      'db_code_changed',
      'row_version_changed',
    ]);
  });
});
