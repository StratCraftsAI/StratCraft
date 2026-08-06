/**
 * TICKET_1277_3: Tier 0 shared LSTM snapshot store -- behavioural tests.
 *
 * Covers the state/operation contract that BOTH Alpha Factory and Training
 * Monitor consume: typed results, error propagation, invalidation after every
 * mutation, stale-response ordering, and degraded-refresh handling.
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  getLstmSnapshotState,
  refreshSnapshots,
  saveSnapshot,
  restoreSnapshot,
  renameSnapshot,
  deleteSnapshot,
  startFresh,
  getSnapshotVersions,
  importVersionFromSnapshot,
  clearSnapshotError,
  __resetLstmSnapshotStoreForTests,
} from '../useLstmSnapshotStore';
import type { LstmSnapshotEntryUI } from '../../types/combinator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(overrides: Partial<LstmSnapshotEntryUI> = {}): LstmSnapshotEntryUI {
  return {
    id: 'snap-1',
    name: 'LSTM_Snapshot_2026-07-29',
    createdAt: 1_753_000_000_000,
    versionCount: 10,
    activeVersionId: 'v011_20260727T233448_n57',
    meanValSharpe: 1.2345,
    signalCount: 57,
    totalSizeBytes: 2048,
    ...overrides,
  };
}

interface MockApi {
  listSnapshots: ReturnType<typeof vi.fn>;
  saveSnapshot: ReturnType<typeof vi.fn>;
  restoreSnapshot: ReturnType<typeof vi.fn>;
  renameSnapshot: ReturnType<typeof vi.fn>;
  deleteSnapshot: ReturnType<typeof vi.fn>;
  startFresh: ReturnType<typeof vi.fn>;
  getSnapshotVersions: ReturnType<typeof vi.fn>;
  importVersionFromSnapshot: ReturnType<typeof vi.fn>;
}

let api: MockApi;

function installApi(): void {
  api = {
    listSnapshots: vi.fn().mockResolvedValue({ success: true, snapshots: [entry()] }),
    saveSnapshot: vi.fn().mockResolvedValue({ success: true, snapshot: entry(), warning: null }),
    restoreSnapshot: vi.fn().mockResolvedValue({ success: true, manifest: {} }),
    renameSnapshot: vi.fn().mockResolvedValue({ success: true, snapshot: entry() }),
    deleteSnapshot: vi.fn().mockResolvedValue({ success: true }),
    startFresh: vi.fn().mockResolvedValue({ success: true, manifest: {} }),
    getSnapshotVersions: vi.fn().mockResolvedValue({ success: true, versions: [{ id: 'v1' }] }),
    importVersionFromSnapshot: vi.fn().mockResolvedValue({ success: true, version: { id: 'v1' } }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { electronAPI: { lstmModel: api } };
}

beforeEach(() => {
  __resetLstmSnapshotStoreForTests();
  installApi();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
});

// ---------------------------------------------------------------------------
// List / empty / populated
// ---------------------------------------------------------------------------

describe('TICKET_1277_3: list contract', () => {
  it('AC1: empty state resolves to an empty list without a false error', async () => {
    api.listSnapshots.mockResolvedValue({ success: true, snapshots: [] });
    const result = await refreshSnapshots();

    expect(result.ok).toBe(true);
    const state = getLstmSnapshotState();
    expect(state.snapshots).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.isDegraded).toBe(false);
  });

  it('AC3/AC10: a populated snapshot exposes every summary field from ONE list call', async () => {
    await refreshSnapshots();

    const [row] = getLstmSnapshotState().snapshots ?? [];
    expect(row.name).toBe('LSTM_Snapshot_2026-07-29');
    expect(row.createdAt).toBe(1_753_000_000_000);
    expect(row.versionCount).toBe(10);
    expect(row.signalCount).toBe(57);
    expect(row.activeVersionId).toBe('v011_20260727T233448_n57');
    expect(row.meanValSharpe).toBeCloseTo(1.2345);

    // AC10: no per-row detail fanout to build the summary.
    expect(api.listSnapshots).toHaveBeenCalledTimes(1);
    expect(api.getSnapshotVersions).not.toHaveBeenCalled();
  });

  it('AC10: rendering N rows still performs exactly one list request', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => entry({ id: `snap-${i}`, versionCount: i + 1 }));
    api.listSnapshots.mockResolvedValue({ success: true, snapshots: rows });

    await refreshSnapshots();

    expect(getLstmSnapshotState().snapshots).toHaveLength(5);
    expect(api.listSnapshots).toHaveBeenCalledTimes(1);
    expect(api.getSnapshotVersions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error propagation (AC7)
// ---------------------------------------------------------------------------

describe('TICKET_1277_3 AC7: error propagation', () => {
  it('surfaces a resolved { success: false } restore failure with the Main error text', async () => {
    api.restoreSnapshot.mockResolvedValue({ success: false, error: 'Snapshot manifest missing: snap-1' });
    await refreshSnapshots();

    const result = await restoreSnapshot('snap-1');

    expect(result.ok).toBe(false);
    expect(result.error?.operation).toBe('restore');
    expect(result.error?.message).toBe('Snapshot manifest missing: snap-1');
    expect(result.error?.action).toBeTruthy();
    expect(getLstmSnapshotState().error?.message).toBe('Snapshot manifest missing: snap-1');
  });

  it('surfaces an IPC rejection through the same typed channel', async () => {
    api.restoreSnapshot.mockRejectedValue(new Error('IPC channel closed'));

    const result = await restoreSnapshot('snap-1');

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('IPC channel closed');
    expect(getLstmSnapshotState().error?.operation).toBe('restore');
  });

  it('a failed mutation preserves the last authoritative snapshot list', async () => {
    await refreshSnapshots();
    const before = getLstmSnapshotState().snapshots;

    api.deleteSnapshot.mockResolvedValue({ success: false, error: 'Snapshot not found: snap-1' });
    await deleteSnapshot('snap-1');

    expect(getLstmSnapshotState().snapshots).toEqual(before);
    expect(getLstmSnapshotState().error?.message).toBe('Snapshot not found: snap-1');
  });

  it('a failed BACKGROUND refresh retains last-known-good rows and flags degraded', async () => {
    await refreshSnapshots();
    const good = getLstmSnapshotState().snapshots;

    api.listSnapshots.mockRejectedValue(new Error('transient IPC failure'));
    await refreshSnapshots({ isBackground: true });

    const state = getLstmSnapshotState();
    // Never a false empty collection.
    expect(state.snapshots).toEqual(good);
    expect(state.isDegraded).toBe(true);
  });

  it('a failed FOREGROUND refresh exposes the error to the initiating surface', async () => {
    api.listSnapshots.mockResolvedValue({ success: false, error: 'index unreadable' });

    await refreshSnapshots();

    expect(getLstmSnapshotState().error?.message).toBe('index unreadable');
    expect(getLstmSnapshotState().isDegraded).toBe(true);
  });

  it('reports a missing electronAPI instead of silently degrading', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;

    const result = await saveSnapshot('x');

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('unavailable');
  });

  it('clearError resets the channel', async () => {
    api.startFresh.mockResolvedValue({ success: false, error: 'boom' });
    await startFresh();
    expect(getLstmSnapshotState().error).not.toBeNull();

    clearSnapshotError();
    expect(getLstmSnapshotState().error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invalidation after every mutation (AC6)
// ---------------------------------------------------------------------------

describe('TICKET_1277_3 AC6: every successful mutation invalidates and refreshes', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['save', () => saveSnapshot('n', 'd')],
    ['restore', () => restoreSnapshot('snap-1')],
    ['rename', () => renameSnapshot('snap-1', 'new')],
    ['delete', () => deleteSnapshot('snap-1')],
    ['startFresh', () => startFresh()],
    ['importVersion', () => importVersionFromSnapshot('snap-1', 'v1')],
  ];

  for (const [label, run] of cases) {
    it(`${label} refreshes the shared list and bumps the generation`, async () => {
      const before = getLstmSnapshotState().generation;
      api.listSnapshots.mockClear();

      const result = await run();

      expect((result as { ok: boolean }).ok).toBe(true);
      // Refresh happens without waiting for the poll interval.
      expect(api.listSnapshots).toHaveBeenCalledTimes(1);
      expect(getLstmSnapshotState().generation).toBe(before + 1);
    });
  }

  it('a FAILED mutation does not bump the generation', async () => {
    const before = getLstmSnapshotState().generation;
    api.renameSnapshot.mockResolvedValue({ success: false, error: 'duplicate name' });

    await renameSnapshot('snap-1', 'dup');

    expect(getLstmSnapshotState().generation).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Stale-response ordering (AC11)
// ---------------------------------------------------------------------------

describe('TICKET_1277_3 AC11: request ordering', () => {
  it('a slower OLDER list response cannot overwrite a newer list response', async () => {
    const oldRows = [entry({ id: 'old', name: 'OLD' })];
    const newRows = [entry({ id: 'new', name: 'NEW' })];

    let releaseOld: (v: unknown) => void = () => {};
    const slowOld = new Promise(res => { releaseOld = res; });

    api.listSnapshots
      .mockImplementationOnce(() => slowOld.then(() => ({ success: true, snapshots: oldRows })))
      .mockImplementationOnce(() => Promise.resolve({ success: true, snapshots: newRows }));

    const oldCall = refreshSnapshots();
    const newCall = refreshSnapshots();

    await newCall;
    expect(getLstmSnapshotState().snapshots?.[0].name).toBe('NEW');

    // The stale response lands last but must be discarded.
    releaseOld(undefined);
    await oldCall;
    expect(getLstmSnapshotState().snapshots?.[0].name).toBe('NEW');
  });

  it('a PRE-MUTATION list response cannot overwrite post-mutation state', async () => {
    const preRows = [entry({ id: 'pre', name: 'PRE_MUTATION' })];
    const postRows = [entry({ id: 'post', name: 'POST_MUTATION' })];

    let releasePre: (v: unknown) => void = () => {};
    const slowPre = new Promise(res => { releasePre = res; });

    api.listSnapshots
      // in-flight refresh started BEFORE the delete
      .mockImplementationOnce(() => slowPre.then(() => ({ success: true, snapshots: preRows })))
      // the delete's own post-mutation refresh
      .mockImplementationOnce(() => Promise.resolve({ success: true, snapshots: postRows }));

    const inFlight = refreshSnapshots();
    await deleteSnapshot('snap-1');

    expect(getLstmSnapshotState().snapshots?.[0].name).toBe('POST_MUTATION');

    releasePre(undefined);
    await inFlight;

    // The pre-mutation view must not resurrect the deleted row.
    expect(getLstmSnapshotState().snapshots?.[0].name).toBe('POST_MUTATION');
  });
});

// ---------------------------------------------------------------------------
// Operation payload parity (AC4/AC5)
// ---------------------------------------------------------------------------

describe('TICKET_1277_3 AC4/AC5: preload operation and payload', () => {
  it('restore emits the existing preload operation with { snapshotId }', async () => {
    await restoreSnapshot('snap-42');
    expect(api.restoreSnapshot).toHaveBeenCalledWith({ snapshotId: 'snap-42' });
  });

  it('getSnapshotVersions and importVersionFromSnapshot use the existing operations', async () => {
    await getSnapshotVersions('snap-42');
    expect(api.getSnapshotVersions).toHaveBeenCalledWith({ snapshotId: 'snap-42' });

    await importVersionFromSnapshot('snap-42', 'v007');
    expect(api.importVersionFromSnapshot).toHaveBeenCalledWith({ snapshotId: 'snap-42', versionId: 'v007' });
  });

  it('save / rename / delete forward their documented payloads', async () => {
    await saveSnapshot('My Snap', 'desc');
    expect(api.saveSnapshot).toHaveBeenCalledWith({ name: 'My Snap', description: 'desc' });

    await renameSnapshot('snap-1', 'Renamed');
    expect(api.renameSnapshot).toHaveBeenCalledWith({ snapshotId: 'snap-1', newName: 'Renamed' });

    await deleteSnapshot('snap-1');
    expect(api.deleteSnapshot).toHaveBeenCalledWith({ snapshotId: 'snap-1' });
  });

  it('getSnapshotVersions failure publishes an error and returns a typed failure', async () => {
    api.getSnapshotVersions.mockResolvedValue({ success: false, error: 'snapshot manifest missing' });

    const result = await getSnapshotVersions('snap-1');

    expect(result.ok).toBe(false);
    expect(getLstmSnapshotState().error?.operation).toBe('getVersions');
  });

  it('saveSnapshot surfaces the retention warning on success', async () => {
    api.saveSnapshot.mockResolvedValue({ success: true, snapshot: entry(), warning: 'exceeds maximum' });

    const result = await saveSnapshot('n');

    expect(result.ok).toBe(true);
    expect(result.value?.warning).toBe('exceeds maximum');
  });
});
