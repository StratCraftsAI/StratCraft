/**
 * SavedSnapshotsSection -- TICKET_1277_3
 *
 * The persistent, discoverable `SAVED SNAPSHOTS (N)` section of the Alpha
 * Factory Deep Learning model-management panel.
 *
 * Before this component the snapshot collection was already wired to Alpha
 * Factory, but rendered ONLY inside `BacktestModelPicker` behind a small
 * add-model icon. The resting panel showed just `MODEL VERSIONS (N)`, so a
 * user who had just saved a snapshot saw no evidence it existed and reasonably
 * read that as a failed save. This section is the fix for that visibility
 * gating (TICKET_1277_3 root cause / AC1).
 *
 * Type distinction (AC2): snapshot rows are NEVER merged into `MODEL VERSIONS`.
 * A model-version row means "activate this one ONNX version in the current
 * manifest"; a snapshot row means "inspect or restore a frozen collection of
 * versions". They are separate sections with separate affordances.
 *
 * All state and mutations come from the Tier 0 `useLstmSnapshotStore`, the same
 * owner Training Monitor consumes, so a mutation from either surface converges
 * both (AC6/AC8). This component owns only ephemeral UI state.
 */

import React, { useState } from 'react';
import type { LstmSnapshotEntryUI } from '../types/combinator';
import { useLstmSnapshotStore } from '../stores/useLstmSnapshotStore';

// ---------------------------------------------------------------------------
// Inline SVG icons (no lucide-react at Tier 0)
// ---------------------------------------------------------------------------

function HardDriveIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" x2="2" y1="12" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" x2="6.01" y1="16" y2="16" />
      <line x1="10" x2="10.01" y1="16" y2="16" />
    </svg>
  );
}

function RotateCcwIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function LayersIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

function PenLineIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function Trash2Icon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SavedSnapshotsSectionProps {
  /**
   * Opens the existing `BacktestModelPicker` snapshot-version flow for detailed
   * inspection and import (AC5). This component provides the discoverable entry
   * point into that flow rather than replacing it.
   */
  onViewVersions: (snapshotId: string) => void;
  /** Translation function supplied by the consuming surface. */
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Collapsed by default when vertical space is constrained; heading + count stay visible. */
  defaultExpanded?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SavedSnapshotsSection: React.FC<SavedSnapshotsSectionProps> = ({
  onViewVersions,
  t,
  defaultExpanded = true,
}) => {
  const {
    snapshots: snapshotList,
    isDegraded,
    error,
    restoreSnapshot,
    renameSnapshot,
    deleteSnapshot,
    clearError,
  } = useLstmSnapshotStore();

  // Ephemeral UI state only (TICKET_367) -- the catalog itself is Layer 2.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const snapshots: LstmSnapshotEntryUI[] = snapshotList ?? [];

  const handleRestore = async (snapshotId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      // Delegates to the shared Tier 0 operation, which calls the same preload
      // `restoreSnapshot` Training Monitor uses (AC4). Main keeps ownership of
      // the TICKET_1277_2 filesystem/DB reconciliation and lineageEpoch advance.
      const result = await restoreSnapshot(snapshotId);
      if (result.ok) setConfirmRestoreId(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (snapshotId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await deleteSnapshot(snapshotId);
      if (result.ok) setConfirmDeleteId(null);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (): Promise<void> => {
    if (!renamingId || !renameValue.trim() || busy) return;
    setBusy(true);
    try {
      const result = await renameSnapshot(renamingId, renameValue.trim());
      if (result.ok) {
        setRenamingId(null);
        setRenameValue('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-3 pt-3 border-t border-color-terminal-border/30"
      data-testid="lstm-snapshot-section"
    >
      {/* AC1: heading + saved count remain visible even when collapsed. */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
        className="w-full flex items-center gap-1.5 mb-1.5 text-left"
        aria-expanded={expanded}
      >
        <ChevronIcon expanded={expanded} />
        <span
          className="text-[9px] font-semibold uppercase tracking-widest text-color-terminal-text-muted"
          data-testid="lstm-snapshot-heading"
        >
          {t('signalFactory.savedSnapshots', { count: snapshots.length })}
        </span>
      </button>

      {/* AC7: failures reach this surface with an actionable message. */}
      {error && (
        <div
          role="alert"
          data-testid="lstm-snapshot-error"
          className="flex items-start gap-2 mb-2 p-2 rounded border border-red-500/40 bg-red-500/10"
        >
          <AlertTriangleIcon className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-red-300 break-words">{error.message}</div>
            <div className="text-[9px] text-color-terminal-text-muted mt-0.5">{error.action}</div>
          </div>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); clearError(); }}
            className="text-[10px] text-color-terminal-text-muted hover:text-white px-1"
          >
            {t('signalFactory.dismiss')}
          </button>
        </div>
      )}

      {/* A failed refresh must never render as a successful empty collection. */}
      {isDegraded && !error && (
        <div
          data-testid="lstm-snapshot-degraded"
          className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10"
        >
          <AlertTriangleIcon className="text-amber-400 flex-shrink-0" />
          <span className="text-[9px] text-amber-300">{t('signalFactory.snapshotsDegraded')}</span>
        </div>
      )}

      {expanded && (
        snapshots.length === 0 ? (
          <div
            className="text-[10px] text-color-terminal-text-muted py-2"
            data-testid="lstm-snapshot-empty"
          >
            {t('signalFactory.noSnapshots')}
          </div>
        ) : (
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {snapshots.map(snap => (
              <div
                key={snap.id}
                data-testid="lstm-snapshot-row"
                className="px-2 py-1.5 rounded border border-color-terminal-border/30 bg-transparent"
              >
                {renamingId === snap.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') void handleRename();
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      }}
                      className="flex-1 px-2 py-1 rounded border border-color-terminal-accent-teal bg-black/40 text-white text-[10px] font-mono focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); void handleRename(); }}
                      disabled={busy}
                      className="text-[10px] text-green-400 hover:text-green-300 px-1"
                    >
                      {t('signalFactory.confirm')}
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setRenamingId(null); setRenameValue(''); }}
                      className="text-[10px] text-color-terminal-text-muted hover:text-white px-1"
                    >
                      {t('signalFactory.cancel')}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* AC3: name, created, version count, signal count, frozen
                        active id, and mean val Sharpe when available. */}
                    <div className="flex items-center gap-2">
                      <HardDriveIcon className="text-color-terminal-text-muted flex-shrink-0" />
                      <span className="text-[10px] font-mono text-color-terminal-text truncate flex-1">
                        {snap.name}
                      </span>
                      {snap.meanValSharpe != null && (
                        <span className={[
                          'text-[10px] font-mono flex-shrink-0',
                          snap.meanValSharpe >= 0 ? 'text-green-300' : 'text-red-300',
                        ].join(' ')}>
                          {snap.meanValSharpe.toFixed(4)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 pl-5 text-[9px] font-mono text-color-terminal-text-muted flex-wrap">
                      <span>
                        {new Date(snap.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span data-testid="lstm-snapshot-version-count">
                        {t('signalFactory.snapshotVersions', { count: snap.versionCount })}
                      </span>
                      <span>{t('signalFactory.snapshotSignals', { count: snap.signalCount })}</span>
                      {snap.activeVersionId && (
                        <span className="truncate" title={snap.activeVersionId}>
                          {t('signalFactory.snapshotFrozenActive', { id: snap.activeVersionId })}
                        </span>
                      )}
                      <span>{formatSize(snap.totalSizeBytes)}</span>
                    </div>

                    <div className="flex items-center gap-1 mt-1 pl-5">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setConfirmRestoreId(snap.id); }}
                        disabled={busy}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px]
                                   text-color-terminal-accent-teal border border-color-terminal-accent-teal/30
                                   hover:bg-color-terminal-accent-teal/10 transition-colors disabled:opacity-50"
                      >
                        <RotateCcwIcon />
                        {t('signalFactory.restore')}
                      </button>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onViewVersions(snap.id); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px]
                                   text-color-terminal-text-muted border border-color-terminal-border/40
                                   hover:text-color-terminal-text-secondary hover:border-color-terminal-border transition-colors"
                      >
                        <LayersIcon />
                        {t('signalFactory.viewVersions')}
                      </button>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setRenamingId(snap.id); setRenameValue(snap.name); }}
                        disabled={busy}
                        title={t('signalFactory.rename')}
                        className="p-1 rounded text-color-terminal-text-muted hover:text-color-terminal-accent-teal disabled:opacity-50"
                      >
                        <PenLineIcon />
                      </button>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(snap.id); }}
                        disabled={busy}
                        title={t('signalFactory.delete')}
                        className="p-1 rounded text-color-terminal-text-muted hover:text-red-400 disabled:opacity-50"
                      >
                        <Trash2Icon />
                      </button>
                    </div>

                    {/* AC4: Restore uses the same confirmation semantics as
                        Training Monitor -- cancelling performs no mutation. */}
                    {confirmRestoreId === snap.id && (
                      <div
                        data-testid="lstm-snapshot-restore-confirm"
                        className="mt-1.5 ml-5 p-2 rounded border border-color-terminal-accent-teal/30 bg-black/30"
                      >
                        <div className="text-[9px] text-color-terminal-text-secondary leading-relaxed">
                          {t('signalFactory.restoreConfirmMessage')}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void handleRestore(snap.id); }}
                            disabled={busy}
                            className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase
                                       border border-color-terminal-accent-gold text-color-terminal-accent-gold
                                       bg-color-terminal-accent-gold/20 disabled:opacity-50"
                          >
                            {t('signalFactory.confirmRestore')}
                          </button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setConfirmRestoreId(null); }}
                            className="px-2 py-0.5 rounded text-[9px] uppercase
                                       border border-color-terminal-border text-color-terminal-text-secondary"
                          >
                            {t('signalFactory.cancel')}
                          </button>
                        </div>
                      </div>
                    )}

                    {confirmDeleteId === snap.id && (
                      <div
                        data-testid="lstm-snapshot-delete-confirm"
                        className="mt-1.5 ml-5 p-2 rounded border border-red-500/30 bg-black/30"
                      >
                        <div className="text-[9px] text-color-terminal-text-secondary leading-relaxed">
                          {t('signalFactory.deleteConfirmMessage')}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void handleDelete(snap.id); }}
                            disabled={busy}
                            className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase
                                       border border-red-500 text-red-300 bg-red-500/20 disabled:opacity-50"
                          >
                            {t('signalFactory.confirmDelete')}
                          </button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            className="px-2 py-0.5 rounded text-[9px] uppercase
                                       border border-color-terminal-border text-color-terminal-text-secondary"
                          >
                            {t('signalFactory.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};
