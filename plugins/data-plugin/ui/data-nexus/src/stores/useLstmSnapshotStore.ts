/**
 * useLstmSnapshotStore -- TICKET_1277_3
 *
 * Tier 0 authoritative owner of LSTM combinator snapshot catalog state and the
 * snapshot lifecycle operations.
 *
 * Before this store, Alpha Factory (via `useLstmCombinatorData`) and Training
 * Monitor (via a page-local `SnapshotPanel`) each owned their own snapshot
 * list, IPC calls, refresh rules and silent error handling. Two owners cannot
 * offer immediate cross-view refresh or one error contract, so both surfaces
 * now consume this single Zustand store.
 *
 * Both surfaces are presentation layers (CLAUDE.md "Electron / Guide WebUI are
 * surface layers"): the shared operation lives here, and Tier 1
 * `quant-lab-nexus` depends downward on Tier 0 `data-plugin`
 * (PLUGIN_TICKET_009). No filesystem, lineage, retention or Restore decision
 * is reconstructed here -- every operation delegates to the existing Main
 * process owner through the existing preload API, which keeps the
 * TICKET_1277_2 filesystem/DB reconciliation on its owning path.
 *
 * Snapshot catalog state is durable-history state under TICKET_367, so it
 * lives in a shared Layer 2 Zustand store rather than component `useState`.
 * The owning Tier 0 package declares Zustand directly; no Vite package-
 * directory alias is involved (TICKET_1211).
 *
 * Coherence contract (AC6/AC11):
 *   - every successful mutation bumps `_generation` and refreshes the list, so
 *     all mounted consumers update without waiting for a poll;
 *   - each list request carries a monotonic token; a response is discarded if
 *     a newer request has since started OR if a successful mutation landed
 *     after the request began. A slow pre-mutation response can therefore
 *     never overwrite post-mutation state;
 *   - the poll in `useLstmCombinatorData` remains only as recovery.
 *
 * Error contract (AC7, TICKET_858):
 *   - an IPC rejection and a resolved `{ success: false, error }` are both
 *     surfaced through the same typed result and the observable error channel;
 *   - a failed mutation preserves the last authoritative list;
 *   - a failed background refresh keeps last-known-good rows but sets
 *     `isDegraded`, so it can never render as a successful empty collection.
 */

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { LstmSnapshotEntryUI, LstmModelVersionUI } from '../types/combinator';

// ---------------------------------------------------------------------------
// Public result / state types
// ---------------------------------------------------------------------------

export type LstmSnapshotOperation =
  | 'save'
  | 'list'
  | 'restore'
  | 'getVersions'
  | 'importVersion'
  | 'rename'
  | 'delete'
  | 'startFresh';

export interface LstmSnapshotError {
  operation: LstmSnapshotOperation;
  message: string;
  /** Actionable next step shown alongside the message. */
  action: string;
}

/**
 * Both arms declare both keys (one as `?: undefined`) so TypeScript narrows the
 * union reliably even when `T` is generic or `void` -- a bare
 * `{ok:true;value:T} | {ok:false;error:E}` fails to narrow in generic position.
 */
export type LstmSnapshotResult<T> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; value?: undefined; error: LstmSnapshotError };

export interface LstmSnapshotState {
  /** null until the first list response resolves; never null-on-error. */
  snapshots: LstmSnapshotEntryUI[] | null;
  isLoading: boolean;
  /** A refresh failed; rows (if any) are last-known-good, not authoritative. */
  isDegraded: boolean;
  /** Last operation error, cleared by `clearError` or the next success. */
  error: LstmSnapshotError | null;
  /** Bumped on every successful mutation; consumers may use it to re-derive. */
  generation: number;
}

// ---------------------------------------------------------------------------
// Actionable guidance per operation (AC7: "actionable error message + action")
// ---------------------------------------------------------------------------

const OPERATION_ACTIONS: Record<LstmSnapshotOperation, string> = {
  save: 'Train at least one model version, then retry saving the snapshot.',
  list: 'Retry, or reopen the panel to reload the snapshot list.',
  restore: 'Retry the restore, or pick a different snapshot.',
  getVersions: 'Retry, or verify the snapshot files still exist on disk.',
  importVersion: 'Retry the import, or pick a different version.',
  rename: 'Pick a different name and retry.',
  delete: 'Retry the delete, or reload the snapshot list.',
  startFresh: 'Save a snapshot first if you need to keep the current model.',
};

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

const initialState: LstmSnapshotState = {
  snapshots: null,
  isLoading: false,
  isDegraded: false,
  error: null,
  generation: 0,
};

const lstmSnapshotStore = createStore<LstmSnapshotState>(() => initialState);

/**
 * Monotonic list-request token. Every refresh takes the next value; only a
 * response whose token is still the newest may commit (AC11).
 */
let _requestToken = 0;

/**
 * Bumped by every successful mutation. A list response that started before a
 * mutation landed is stale even if it is the newest outstanding request, so
 * responses also compare the mutation counter they were issued under.
 */
let _mutationCounter = 0;

function setState(patch: Partial<LstmSnapshotState>): void {
  lstmSnapshotStore.setState(patch);
}

export function getLstmSnapshotState(): LstmSnapshotState {
  return lstmSnapshotStore.getState();
}

// ---------------------------------------------------------------------------
// IPC access -- the Main process stays the owner of every operation
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSnapshotApi(): any {
  return typeof window !== 'undefined'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (window as any).electronAPI?.lstmModel
    : undefined;
}

function toError(operation: LstmSnapshotOperation, message: string): LstmSnapshotError {
  return { operation, message, action: OPERATION_ACTIONS[operation] };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * Runs one Main-process call and normalises BOTH failure shapes -- a thrown /
 * rejected IPC call and a resolved `{ success: false, error }` -- into one
 * typed error result. Nothing is swallowed (TICKET_858).
 */
async function invoke<T>(
  operation: LstmSnapshotOperation,
  call: (api: NonNullable<ReturnType<typeof getSnapshotApi>>) => Promise<{ success: boolean; error?: string } & Record<string, unknown>>,
  extract: (response: Record<string, unknown>) => T,
): Promise<LstmSnapshotResult<T>> {
  const api = getSnapshotApi();
  if (!api) {
    return { ok: false, error: toError(operation, 'LSTM model API is unavailable in this window.') };
  }
  try {
    const response = await call(api);
    if (!response?.success) {
      return { ok: false, error: toError(operation, response?.error ?? `Operation "${operation}" failed.`) };
    }
    return { ok: true, value: extract(response) };
  } catch (err) {
    return { ok: false, error: toError(operation, describe(err)) };
  }
}

// ---------------------------------------------------------------------------
// List / refresh
// ---------------------------------------------------------------------------

/**
 * Refreshes the authoritative snapshot list.
 *
 * `isBackground` distinguishes the recovery poll from a user-visible load: a
 * failed background refresh keeps last-known-good rows and flags `isDegraded`
 * instead of raising a modal-worthy error, but it still never presents itself
 * as a successful empty list.
 */
export async function refreshSnapshots(
  options: { isBackground?: boolean } = {},
): Promise<LstmSnapshotResult<LstmSnapshotEntryUI[]>> {
  const token = ++_requestToken;
  const issuedUnderMutation = _mutationCounter;

  if (!options.isBackground) {
    setState({ isLoading: true });
  }

  const result = await invoke(
    'list',
    api => api.listSnapshots(),
    resp => (resp.snapshots ?? []) as LstmSnapshotEntryUI[],
  );

  // AC11: discard if a newer request started, or if a successful mutation
  // landed after this request was issued.
  const superseded = token !== _requestToken || issuedUnderMutation !== _mutationCounter;
  if (superseded) {
    return result;
  }

  if (result.ok) {
    setState({
      snapshots: result.value,
      isLoading: false,
      isDegraded: false,
      error: null,
    });
  } else if (options.isBackground) {
    // Retain last-known-good rows, but mark them non-authoritative.
    setState({ isLoading: false, isDegraded: true });
  } else {
    setState({ isLoading: false, isDegraded: true, error: result.error });
  }
  return result;
}

/**
 * Applies a successful mutation: invalidate, then refresh so every mounted
 * consumer converges immediately rather than at the next poll (AC6).
 */
async function afterMutation(): Promise<void> {
  _mutationCounter++;
  setState({ generation: lstmSnapshotStore.getState().generation + 1, error: null });
  // The refresh is issued AFTER the counter bump, so it is not self-superseded.
  await refreshSnapshots({ isBackground: true });
}

function publishError(error: LstmSnapshotError): void {
  setState({ error });
}

// ---------------------------------------------------------------------------
// Mutations -- every one delegates to the existing Main-process owner
// ---------------------------------------------------------------------------

export async function saveSnapshot(
  name: string,
  description?: string,
): Promise<LstmSnapshotResult<{ warning: string | null }>> {
  const result = await invoke(
    'save',
    api => api.saveSnapshot({ name, description }),
    resp => ({ warning: (resp.warning as string | undefined) ?? null }),
  );
  if (result.ok) await afterMutation();
  else if (!result.ok) publishError(result.error);
  return result;
}

/**
 * Restore delegates to the Main-process operation that owns the TICKET_1277_2
 * filesystem restore, `lineageEpoch` advance and DB reconciliation. No part of
 * that decision is duplicated here.
 */
export async function restoreSnapshot(snapshotId: string): Promise<LstmSnapshotResult<void>> {
  const result = await invoke(
    'restore',
    api => api.restoreSnapshot({ snapshotId }),
    () => undefined as void,
  );
  if (result.ok) await afterMutation();
  else if (!result.ok) publishError(result.error);
  return result;
}

export async function renameSnapshot(
  snapshotId: string,
  newName: string,
): Promise<LstmSnapshotResult<void>> {
  const result = await invoke(
    'rename',
    api => api.renameSnapshot({ snapshotId, newName }),
    () => undefined as void,
  );
  if (result.ok) await afterMutation();
  else if (!result.ok) publishError(result.error);
  return result;
}

export async function deleteSnapshot(snapshotId: string): Promise<LstmSnapshotResult<void>> {
  const result = await invoke(
    'delete',
    api => api.deleteSnapshot({ snapshotId }),
    () => undefined as void,
  );
  if (result.ok) await afterMutation();
  else if (!result.ok) publishError(result.error);
  return result;
}

export async function startFresh(): Promise<LstmSnapshotResult<void>> {
  const result = await invoke(
    'startFresh',
    api => api.startFresh(),
    () => undefined as void,
  );
  if (result.ok) await afterMutation();
  else if (!result.ok) publishError(result.error);
  return result;
}

/**
 * Reads the frozen version list of one snapshot. This is a detail-view read
 * for `View Versions` / `Import Version`; it is NOT used to build summary rows
 * (AC10 prohibits the per-row N+1 fanout -- `versionCount` arrives with the
 * list response).
 */
export async function getSnapshotVersions(
  snapshotId: string,
): Promise<LstmSnapshotResult<LstmModelVersionUI[]>> {
  const result = await invoke(
    'getVersions',
    api => api.getSnapshotVersions({ snapshotId }),
    resp => (resp.versions ?? []) as LstmModelVersionUI[],
  );
  if (!result.ok) publishError(result.error);
  return result;
}

/**
 * Imports one version out of a snapshot into the live manifest. This mutates
 * the manifest, so both surfaces must refresh (AC6/AC8).
 */
export async function importVersionFromSnapshot(
  snapshotId: string,
  versionId: string,
): Promise<LstmSnapshotResult<void>> {
  const result = await invoke(
    'importVersion',
    api => api.importVersionFromSnapshot({ snapshotId, versionId }),
    () => undefined as void,
  );
  if (result.ok) await afterMutation();
  else if (!result.ok) publishError(result.error);
  return result;
}

export function clearSnapshotError(): void {
  if (lstmSnapshotStore.getState().error === null) return;
  setState({ error: null });
}

/**
 * Test-only reset. Production code never calls this -- the singleton is
 * intentionally process-lived so unmount/remount cannot create a second
 * authoritative catalog (AC11).
 */
export function __resetLstmSnapshotStoreForTests(): void {
  lstmSnapshotStore.setState(initialState, true);
  _requestToken = 0;
  _mutationCounter = 0;
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export interface UseLstmSnapshotStoreResult extends LstmSnapshotState {
  refreshSnapshots: typeof refreshSnapshots;
  saveSnapshot: typeof saveSnapshot;
  restoreSnapshot: typeof restoreSnapshot;
  renameSnapshot: typeof renameSnapshot;
  deleteSnapshot: typeof deleteSnapshot;
  startFresh: typeof startFresh;
  getSnapshotVersions: typeof getSnapshotVersions;
  importVersionFromSnapshot: typeof importVersionFromSnapshot;
  clearError: typeof clearSnapshotError;
}

/**
 * The single snapshot state/operation contract consumed by BOTH Alpha Factory
 * and Training Monitor.
 */
export function useLstmSnapshotStore(): UseLstmSnapshotStoreResult {
  const state = useStore(lstmSnapshotStore);
  return {
    ...state,
    refreshSnapshots,
    saveSnapshot,
    restoreSnapshot,
    renameSnapshot,
    deleteSnapshot,
    startFresh,
    getSnapshotVersions,
    importVersionFromSnapshot,
    clearError: clearSnapshotError,
  };
}
