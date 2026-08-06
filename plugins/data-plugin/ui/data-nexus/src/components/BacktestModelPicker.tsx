/**
 * TICKET_1015 Part E: Backtest Model Picker (Tier 0).
 *
 * Two-tab overlay: Versions (current manifest) and Snapshots (saved checkpoints).
 * Allows importing a backtest-trained LSTM model into the live pipeline.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { LstmModelVersionUI, LstmModelManifestUI, LstmSnapshotEntryUI } from '../types/combinator';
import { ModelVersionRow } from './ModelVersionHistory';

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function CloseIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BacktestModelPickerProps {
  manifest: LstmModelManifestUI | null;
  snapshotList: LstmSnapshotEntryUI[] | null;
  onSelectVersion: (versionId: string) => void;
  onImportFromSnapshot: (snapshotId: string, versionId: string) => void;
  getSnapshotVersions: (snapshotId: string) => Promise<LstmModelVersionUI[]>;
  onClose: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /**
   * TICKET_1277_3 AC5: the persistent SAVED SNAPSHOTS section deep-links into
   * this existing flow rather than reimplementing it. `View Versions` opens the
   * picker already on the Snapshots tab with that snapshot expanded.
   */
  initialTab?: Tab;
  initialExpandedSnapshotId?: string | null;
}

type Tab = 'versions' | 'snapshots';

// ---------------------------------------------------------------------------
// Version row (shared between tabs)
// ---------------------------------------------------------------------------

function VersionRow({
  version,
  isActive,
  currentSignalCount,
  onSelect,
  t,
}: {
  version: LstmModelVersionUI;
  isActive: boolean;
  currentSignalCount: number | null;
  onSelect: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  return (
    <ModelVersionRow
      version={version}
      isActive={isActive}
      currentSignalCount={currentSignalCount}
      onSelect={version.compatible && !isActive ? onSelect : undefined}
      t={t}
    />
  );
}

// ---------------------------------------------------------------------------
// Snapshot expandable row
// ---------------------------------------------------------------------------

function SnapshotRow({
  snapshot,
  getVersions,
  onImport,
  t,
  initiallyExpanded = false,
}: {
  snapshot: LstmSnapshotEntryUI;
  getVersions: (snapshotId: string) => Promise<LstmModelVersionUI[]>;
  onImport: (snapshotId: string, versionId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** TICKET_1277_3 AC5: set when `View Versions` deep-linked to this snapshot. */
  initiallyExpanded?: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [versions, setVersions] = useState<LstmModelVersionUI[] | null>(null);
  const [loading, setLoading] = useState(false);

  // A deep-linked row opens already expanded, so its versions must be fetched
  // without waiting for the user to click the toggle.
  useEffect(() => {
    if (!initiallyExpanded || versions !== null || loading) return;
    let cancelled = false;
    setLoading(true);
    void getVersions(snapshot.id).then(vs => {
      if (cancelled) return;
      setVersions(vs);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiallyExpanded, snapshot.id]);

  const toggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (versions === null) {
      setLoading(true);
      const vs = await getVersions(snapshot.id);
      setVersions(vs);
      setLoading(false);
    }
  }, [expanded, versions, getVersions, snapshot.id]);

  return (
    <div className="border border-color-terminal-border/30 rounded overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-color-terminal-accent-teal/5 transition-colors"
      >
        <ChevronRightIcon className={[
          'transition-transform flex-shrink-0 text-color-terminal-text-muted',
          expanded ? 'rotate-90' : '',
        ].join(' ')} />
        <ArchiveIcon className="text-color-terminal-text-muted flex-shrink-0" />
        <span className="text-[11px] font-mono text-color-terminal-text truncate flex-1">
          {snapshot.name}
        </span>
        {snapshot.meanValSharpe != null && (
          <span className={[
            'text-[10px] font-mono flex-shrink-0',
            snapshot.meanValSharpe >= 0 ? 'text-green-300' : 'text-red-300',
          ].join(' ')}>
            {snapshot.meanValSharpe.toFixed(4)}
          </span>
        )}
        <span className="text-[10px] font-mono text-color-terminal-text-muted flex-shrink-0">
          {snapshot.signalCount}s
        </span>
        <span className="text-[10px] font-mono text-color-terminal-text-muted flex-shrink-0">
          {new Date(snapshot.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1 bg-black/20">
          {loading && (
            <div className="text-[10px] text-color-terminal-text-muted py-2 text-center">
              Loading versions...
            </div>
          )}
          {versions && versions.length === 0 && (
            <div className="text-[10px] text-color-terminal-text-muted py-2 text-center">
              No versions in this snapshot
            </div>
          )}
          {versions?.map(v => (
            <VersionRow
              key={v.id}
              version={v}
              isActive={false}
              currentSignalCount={null}
              onSelect={() => onImport(snapshot.id, v.id)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const BacktestModelPicker: React.FC<BacktestModelPickerProps> = ({
  manifest,
  snapshotList,
  onSelectVersion,
  onImportFromSnapshot,
  getSnapshotVersions,
  onClose,
  t,
  initialTab = 'versions',
  initialExpandedSnapshotId = null,
}) => {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const versions = manifest?.versions ?? [];
  const activeVersion = manifest?.activeVersion ?? null;
  const activeSignalCount = versions.find(version => version.id === activeVersion)?.signalCount ?? null;
  const hasSnapshots = snapshotList != null && snapshotList.length > 0;

  return (
    <div
      className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-color-terminal-bg border border-color-terminal-border rounded-lg shadow-xl w-[420px] max-h-[480px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-color-terminal-border/40">
          <span className="text-xs font-semibold uppercase tracking-wider text-color-terminal-text">
            {t('signalFactory.backtestModelPicker')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-color-terminal-text-muted hover:text-color-terminal-text transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-color-terminal-border/30">
          <button
            type="button"
            onClick={() => setTab('versions')}
            className={[
              'flex-1 px-4 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors',
              tab === 'versions'
                ? 'text-color-terminal-accent-teal border-b-2 border-color-terminal-accent-teal'
                : 'text-color-terminal-text-muted hover:text-color-terminal-text',
            ].join(' ')}
          >
            {t('signalFactory.pickerTabVersions')} ({versions.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('snapshots')}
            className={[
              'flex-1 px-4 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors',
              tab === 'snapshots'
                ? 'text-color-terminal-accent-teal border-b-2 border-color-terminal-accent-teal'
                : 'text-color-terminal-text-muted hover:text-color-terminal-text',
            ].join(' ')}
          >
            {t('signalFactory.pickerTabSnapshots')} ({snapshotList?.length ?? 0})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {tab === 'versions' && (
            <>
              {versions.length === 0 && (
                <div className="text-[11px] text-color-terminal-text-muted text-center py-6">
                  {t('signalFactory.noVersionsYet')}
                </div>
              )}
              {versions.map(v => (
                <VersionRow
                  key={v.id}
                  version={v}
                  isActive={v.id === activeVersion}
                  currentSignalCount={activeSignalCount}
                  onSelect={() => onSelectVersion(v.id)}
                  t={t}
                />
              ))}
            </>
          )}

          {tab === 'snapshots' && (
            <>
              {!hasSnapshots && (
                <div className="text-[11px] text-color-terminal-text-muted text-center py-6">
                  {t('signalFactory.noSnapshotsYet')}
                </div>
              )}
              {snapshotList?.map(snap => (
                <SnapshotRow
                  key={snap.id}
                  snapshot={snap}
                  getVersions={getSnapshotVersions}
                  onImport={onImportFromSnapshot}
                  t={t}
                  initiallyExpanded={snap.id === initialExpandedSnapshotId}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
