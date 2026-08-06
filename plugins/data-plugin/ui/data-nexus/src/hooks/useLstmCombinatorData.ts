/**
 * TICKET_1015: Shared LSTM data-fetching hook (Tier 0).
 *
 * Consolidates training status polling, progress subscription, manifest
 * fetching, and signal-selection event handling that was previously
 * duplicated per consumer of CombinatorSection.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TRAINING_MONITOR_POLL_INTERVAL_MS } from '@shared/constants/timing';
import {
  useLstmSnapshotStore,
  refreshSnapshots as refreshSnapshotCatalog,
} from '../stores/useLstmSnapshotStore';
import type {
  LstmTrainingStatusSnapshot,
  LstmModelManifestUI,
  LstmModelVersionUI,
  LstmSnapshotEntryUI,
  ConfirmSignalsPayload,
} from '../types/combinator';

// ---------------------------------------------------------------------------
// Internal IPC types (decoding raw electronAPI responses)
// ---------------------------------------------------------------------------

interface LstmTrainingRun {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  signalIds: number[];
  modelType: string;
  sampleCount: number | null;
  modelParamCount: number | null;
  perFoldSharpes: number[] | null;
  meanValSharpe: number | null;
  completedAt: number | null;
}

interface LstmTrainingStatus {
  activeRun: LstmTrainingRun | null;
  queuedRuns: LstmTrainingRun[];
  liveProgress: {
    currentFold: number;
    currentEpoch: number;
    totalFolds: number;
    totalEpochs: number;
    lastLoss: number | null;
    perFoldSharpes: number[];
    startedAt: number;
  } | null;
}

interface LstmModelVersionRaw {
  id: string;
  trainedAt: number;
  modelType: string;
  signalCount: number;
  meanValSharpe: number;
  compatible: boolean;
  registration?: 'registered' | 'held';
}

interface LstmModelManifestRaw {
  activeVersion: string | null;
  versions: LstmModelVersionRaw[];
}

// ---------------------------------------------------------------------------
// Snapshot adapter (IPC -> Tier 0 prop type)
// ---------------------------------------------------------------------------

function buildLstmSnapshot(
  status: LstmTrainingStatus | null,
  lastCompleted: LstmTrainingRun | null,
): LstmTrainingStatusSnapshot | null {
  if (!status && !lastCompleted) return null;
  const active = status?.activeRun ?? null;
  const live = status?.liveProgress ?? null;
  const isTraining = active != null && live != null;
  return {
    isTraining,
    activeRun: active ? {
      modelType: active.modelType,
      signalIds: active.signalIds,
      sampleCount: active.sampleCount,
      modelParamCount: active.modelParamCount,
    } : null,
    liveProgress: live,
    lastCompleted: lastCompleted ? {
      meanValSharpe: lastCompleted.meanValSharpe,
      perFoldSharpes: lastCompleted.perFoldSharpes,
      signalIds: lastCompleted.signalIds,
      completedAt: lastCompleted.completedAt,
      sampleCount: lastCompleted.sampleCount,
      modelParamCount: lastCompleted.modelParamCount,
    } : null,
    queuedCount: status?.queuedRuns?.length ?? 0,
  };
}

function toManifestUI(raw: LstmModelManifestRaw): LstmModelManifestUI {
  return {
    activeVersion: raw.activeVersion,
    versions: raw.versions.map((v): LstmModelVersionUI => ({
      id: v.id,
      trainedAt: v.trainedAt,
      modelType: v.modelType,
      signalCount: v.signalCount,
      meanValSharpe: v.meanValSharpe,
      compatible: v.compatible,
      registration: v.registration,
    })),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseLstmCombinatorDataResult {
  lstmSnapshot: LstmTrainingStatusSnapshot | null;
  modelManifest: LstmModelManifestUI | null;
  snapshotList: LstmSnapshotEntryUI[] | null;
  selectionPayload: ConfirmSignalsPayload | null;
  train: () => Promise<void>;
  setActiveVersion: (versionId: string) => Promise<void>;
  getSnapshotVersions: (snapshotId: string) => Promise<LstmModelVersionUI[]>;
  importVersionFromSnapshot: (snapshotId: string, versionId: string) => Promise<void>;
  confirmSelection: (selectedIds: number[]) => Promise<void>;
  cancelSelection: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getApi(): any {
  return typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
}

export function useLstmCombinatorData(): UseLstmCombinatorDataResult {
  const [lstmStatus, setLstmStatus] = useState<LstmTrainingStatus | null>(null);
  const [lastCompleted, setLastCompleted] = useState<LstmTrainingRun | null>(null);
  const [manifest, setManifest] = useState<LstmModelManifestUI | null>(null);
  const [selectionPayload, setSelectionPayload] = useState<ConfirmSignalsPayload | null>(null);

  // TICKET_1277_3: the snapshot catalog is owned by the Tier 0 shared store,
  // not by this hook. Alpha Factory and Training Monitor therefore read one
  // authoritative list and one error channel.
  const snapshotStore = useLstmSnapshotStore();

  const selectionPayloadRef = useRef(selectionPayload);
  selectionPayloadRef.current = selectionPayload;

  const fetchAll = useCallback(async () => {
    try {
      const api = getApi();
      if (!api?.lstmTraining) return;
      const promises: Promise<unknown>[] = [
        api.lstmTraining.getStatus(),
        api.lstmTraining.getHistory(5),
      ];
      if (api.lstmModel?.getManifest) {
        promises.push(api.lstmModel.getManifest());
      }
      const results = await Promise.all(promises);
      setLstmStatus(results[0] as LstmTrainingStatus);
      const history = results[1] as LstmTrainingRun[];
      const completed = history.find(r => r.status === 'completed');
      if (completed) setLastCompleted(completed);
      if (results[2]) {
        const mResp = results[2] as { success: boolean; manifest: LstmModelManifestRaw | null };
        if (mResp.success && mResp.manifest) {
          setManifest(toManifestUI(mResp.manifest));
        }
      }
    } catch { /* graceful degrade */ }

    // TICKET_1277_3 AC6: the snapshot catalog refresh is delegated to the Tier 0
    // store. Marked background so a transient failure keeps last-known-good rows
    // and raises `isDegraded` instead of a user-facing error on a poll tick.
    await refreshSnapshotCatalog({ isBackground: true });
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, TRAINING_MONITOR_POLL_INTERVAL_MS);

    const api = getApi()?.lstmTraining;
    let unsubProgress: (() => void) | undefined;
    if (api?.onProgress) {
      unsubProgress = api.onProgress((data: LstmTrainingStatus) => setLstmStatus(data));
    }

    let unsubConfirm: (() => void) | undefined;
    if (api?.onConfirmSignals) {
      unsubConfirm = api.onConfirmSignals((data: unknown) => {
        const payload = data as ConfirmSignalsPayload;
        if (payload?.candidates?.length >= 2) {
          setSelectionPayload(payload);
        }
      });
    }

    return () => {
      clearInterval(interval);
      unsubProgress?.();
      unsubConfirm?.();
    };
  }, [fetchAll]);

  const train = useCallback(async () => {
    try {
      const api = getApi();
      if (!api?.lstmModel?.retrain) return;
      await api.lstmModel.retrain();
    } catch { /* graceful degrade */ }
  }, []);

  const setActiveVersion = useCallback(async (versionId: string) => {
    try {
      const api = getApi();
      if (!api?.lstmModel?.setActiveVersion) return;
      await api.lstmModel.setActiveVersion(versionId);
      await fetchAll();
    } catch { /* graceful degrade */ }
  }, [fetchAll]);

  const confirmSelection = useCallback(async (selectedIds: number[]) => {
    try {
      const api = getApi()?.lstmTraining;
      if (!api?.startWithSelection) return;
      await api.startWithSelection({
        signalIds: selectedIds,
        source: selectionPayloadRef.current?.source ?? 'manual',
        sourceRunIds: selectionPayloadRef.current?.sourceRunIds,
      });
    } catch { /* graceful degrade */ }
    setSelectionPayload(null);
  }, []);

  // TICKET_1277_3 AC5/AC8: both snapshot reads and the snapshot-version import
  // go through the Tier 0 shared operations, so Alpha Factory and Training
  // Monitor emit the same preload operation and payload and share one error
  // channel. The manifest refresh stays here because this hook owns manifest
  // state; the store owns the snapshot catalog refresh.
  const storeGetSnapshotVersions = snapshotStore.getSnapshotVersions;
  const storeImportVersion = snapshotStore.importVersionFromSnapshot;

  const getSnapshotVersionsFn = useCallback(async (snapshotId: string): Promise<LstmModelVersionUI[]> => {
    const result = await storeGetSnapshotVersions(snapshotId);
    return result.ok ? result.value : [];
  }, [storeGetSnapshotVersions]);

  const importVersionFromSnapshotFn = useCallback(async (snapshotId: string, versionId: string) => {
    const result = await storeImportVersion(snapshotId, versionId);
    if (result.ok) await fetchAll();
  }, [storeImportVersion, fetchAll]);

  const cancelSelection = useCallback(() => {
    setSelectionPayload(null);
  }, []);

  const lstmSnapshot = buildLstmSnapshot(lstmStatus, lastCompleted);

  return {
    lstmSnapshot,
    modelManifest: manifest,
    snapshotList: snapshotStore.snapshots,
    selectionPayload,
    train,
    setActiveVersion,
    getSnapshotVersions: getSnapshotVersionsFn,
    importVersionFromSnapshot: importVersionFromSnapshotFn,
    confirmSelection,
    cancelSelection,
  };
}
