/**
 * TICKET_077_31: Shared Combinator types (Tier 0).
 *
 * Data-only interfaces consumed by CombinatorSection and its sub-components.
 * No IPC, no Electron, no side effects.
 */

// ---------------------------------------------------------------------------
// Combinator mode & method
// ---------------------------------------------------------------------------

export type CombinatorMode = 'statistical' | 'deep_learning';

export interface CombinatorMethodOption {
  id: string;
  nameKey: string;
  descriptionKey: string;
}

export interface CombinatorConfigType {
  method: string;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LSTM training status snapshot (props-only, no IPC)
// ---------------------------------------------------------------------------

export interface LstmLiveProgress {
  currentFold: number;
  currentEpoch: number;
  totalFolds: number;
  totalEpochs: number;
  lastLoss: number | null;
  perFoldSharpes: number[];
  startedAt: number;
}

export interface LstmCompletedRun {
  meanValSharpe: number | null;
  perFoldSharpes: number[] | null;
  signalIds: number[];
  completedAt: number | null;
  sampleCount: number | null;
  modelParamCount: number | null;
}

export interface LstmActiveRun {
  modelType: string;
  signalIds: number[];
  sampleCount: number | null;
  modelParamCount: number | null;
}

export interface LstmTrainingStatusSnapshot {
  isTraining: boolean;
  activeRun: LstmActiveRun | null;
  liveProgress: LstmLiveProgress | null;
  lastCompleted: LstmCompletedRun | null;
  queuedCount: number;
}

// ---------------------------------------------------------------------------
// LSTM signal selection (TICKET_1000_1)
// ---------------------------------------------------------------------------

export interface LstmTrainingCandidateUI {
  signalId: number;
  displayName: string;
  compositionTier: 'lifting' | 'neutral' | 'dragging' | 'unmeasured';
  stabilityVerdict: string;
  ic: number | null;
  meanForwardReturn: number | null;
  defaultSelected: boolean;
}

export interface ConfirmSignalsPayload {
  candidates: LstmTrainingCandidateUI[];
  source: 'sweep' | 'backtest' | 'manual';
  sourceRunIds?: number[];
}

// ---------------------------------------------------------------------------
// TICKET_1015: LSTM model version (Tier 0 UI subset)
// ---------------------------------------------------------------------------

export interface LstmModelVersionUI {
  id: string;
  trainedAt: number;
  modelType: string;
  signalCount: number;
  meanValSharpe: number;
  compatible: boolean;
  /**
   * Main-process registration-gate outcome. Manifests created before
   * TICKET_1277 omit this field and are authoritatively interpreted as
   * registered, matching the model-store retention contract.
   */
  registration?: 'registered' | 'held';
}

export interface LstmModelManifestUI {
  activeVersion: string | null;
  versions: LstmModelVersionUI[];
}

// ---------------------------------------------------------------------------
// TICKET_1015 Part E: Snapshot entry for backtest model picker
// ---------------------------------------------------------------------------

export interface LstmSnapshotEntryUI {
  id: string;
  name: string;
  createdAt: number;
  // TICKET_1277_3 AC3/AC10: the persistent SAVED SNAPSHOTS row summarises a
  // frozen collection, so the count arrives with the list response -- never
  // via a per-row getSnapshotVersions call.
  versionCount: number;
  activeVersionId: string | null;
  meanValSharpe: number | null;
  signalCount: number;
  totalSizeBytes: number;
}
