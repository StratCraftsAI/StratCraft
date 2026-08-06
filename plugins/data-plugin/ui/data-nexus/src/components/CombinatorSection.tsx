/**
 * TICKET_077_31: Full Combinator Section (Tier 0 shared).
 *
 * Two-block mutual-exclusion layout matching Alpha Factory:
 * - Block A: Linear Ensemble (header, lookback, feedLstm toggle, method grid)
 * - Block B: Deep Learning (header, fit-quality gauge, training status, buttons)
 *
 * Pure presentation -- all IPC data arrives via props, all mutations via callbacks.
 * Consumers: Alpha Factory (interactive), Signal Generator (readOnly).
 *
 * TICKET_1045_2: readOnly locks Block A only (method/lookback/feedLstm are
 * pipeline-fixed). Block B stays interactive (LSTM version switching is a
 * runtime decision).
 */

import React from 'react';
import type {
  CombinatorMode,
  CombinatorMethodOption,
  LstmTrainingStatusSnapshot,
  LstmModelManifestUI,
  LstmModelVersionUI,
  LstmSnapshotEntryUI,
  ConfirmSignalsPayload,
} from '../types/combinator';
import { CombinatorConfig } from './CombinatorConfig';
import { FitQualityGauge } from './FitQualityGauge';
import { MiniProgressBar } from './MiniProgressBar';
import { LstmSignalSelectionPanel } from './LstmSignalSelectionPanel';
import { BacktestModelPicker } from './BacktestModelPicker';
import { SavedSnapshotsSection } from './SavedSnapshotsSection';
import { ModelVersionHistory } from './ModelVersionHistory';
import {
  activateModelVersion,
} from './combinator-interactions';

// ---------------------------------------------------------------------------
// Inline SVG icons (no lucide-react at Tier 0)
// ---------------------------------------------------------------------------

function BarChart3Icon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M13 17V9" />
      <path d="M18 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function BrainIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function AlertCircleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CombinatorSectionProps {
  method: string;
  onMethodChange: (method: string) => void;
  lookback: number;
  onLookbackChange: (days: number) => void;
  feedLstm: boolean;
  onFeedLstmChange: (value: boolean) => void;

  signalCount: number;
  lstmStatus: LstmTrainingStatusSnapshot | null;
  onTrainClick: () => void;
  onDashboardClick: () => void;

  combinatorMode: CombinatorMode;
  onCombinatorModeChange: (mode: CombinatorMode) => void;

  selectionPayload: ConfirmSignalsPayload | null;
  onSelectionConfirm: (selectedIds: number[]) => void;
  onSelectionCancel: () => void;

  modelManifest?: LstmModelManifestUI | null;
  onActiveVersionChange?: (versionId: string) => void;

  snapshotList?: LstmSnapshotEntryUI[] | null;
  onImportVersionFromSnapshot?: (snapshotId: string, versionId: string) => void;
  getSnapshotVersions?: (snapshotId: string) => Promise<LstmModelVersionUI[]>;

  t: (key: string, opts?: Record<string, unknown>) => string;
  readOnly?: boolean;
  methods?: CombinatorMethodOption[];

  regimeBasedGuardFailed?: boolean;
  correlationAdjustedGuardFailed?: boolean;
  correlationAdjustedDisabled?: boolean;
  maxCorrelationEntries?: number;
  entryChipCount?: number;

  nowMs?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CombinatorSection: React.FC<CombinatorSectionProps> = ({
  method,
  onMethodChange,
  lookback,
  onLookbackChange,
  feedLstm,
  onFeedLstmChange,
  signalCount,
  lstmStatus,
  onTrainClick,
  onDashboardClick,
  combinatorMode,
  onCombinatorModeChange,
  selectionPayload,
  onSelectionConfirm,
  onSelectionCancel,
  modelManifest,
  onActiveVersionChange,
  snapshotList,
  onImportVersionFromSnapshot,
  getSnapshotVersions,
  t,
  readOnly = false,
  methods,
  regimeBasedGuardFailed = false,
  correlationAdjustedGuardFailed = false,
  nowMs,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // TICKET_1277_3 AC5: when the picker is opened from a SAVED SNAPSHOTS row's
  // `View Versions`, deep-link straight to that snapshot's frozen version list.
  const [pickerSnapshotId, setPickerSnapshotId] = React.useState<string | null>(null);
  const lstmEnabled = combinatorMode === 'deep_learning';

  const ipcLog = React.useCallback((msg: string) => {
    try { (window as any).electronAPI?.log?.('warn', 'CombinatorSection', msg); } catch (_) { /* noop */ }
    console.warn('[W:COMBINATOR_SECTION:IPC_LOG]', msg);
  }, []);

  React.useEffect(() => {
    ipcLog(`render combinatorMode=${combinatorMode} lstmEnabled=${lstmEnabled} readOnly=${readOnly}`);
  }, [combinatorMode, lstmEnabled, readOnly, ipcLog]);

  // Resolve gauge data from snapshot
  const snap = lstmStatus;
  const isTraining = snap?.isTraining ?? false;
  const active = snap?.activeRun ?? null;
  const live = snap?.liveProgress ?? null;
  const lastCompleted = snap?.lastCompleted ?? null;
  const queuedCount = snap?.queuedCount ?? 0;
  const hasHistory = lastCompleted != null;

  const gaugeSharpes = isTraining && live ? live.perFoldSharpes : lastCompleted?.perFoldSharpes ?? null;
  const gaugeMean = isTraining && live
    ? (live.perFoldSharpes.length > 0 ? live.perFoldSharpes.reduce((a, b) => a + b, 0) / live.perFoldSharpes.length : null)
    : lastCompleted?.meanValSharpe ?? null;
  const gaugeSource = isTraining ? active : lastCompleted;
  const gaugeSampleCount = gaugeSource?.sampleCount ?? null;
  const gaugeModelParamCount = gaugeSource?.modelParamCount ?? null;

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-color-terminal-text-muted px-1">
        {t('signalFactory.combinator')}
      </label>

      {/* Block A: Linear Ensemble */}
      <div
        data-testid="combinator-block-statistical"
        className={[
          'p-4 rounded-lg border transition-all',
          combinatorMode === 'statistical'
            ? 'border-color-terminal-accent-primary bg-color-terminal-surface/10'
            : readOnly
              ? 'border-color-terminal-border/30 bg-color-terminal-surface/5 opacity-40'
              : 'border-color-terminal-border/30 bg-color-terminal-surface/5 opacity-40 cursor-pointer',
        ].join(' ')}
        onClick={() => {
          ipcLog(`Block A clicked readOnly=${readOnly} combinatorMode=${combinatorMode}`);
          if (readOnly) return;
          if (combinatorMode !== 'statistical') onCombinatorModeChange('statistical');
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={[
              'inline-block w-3 h-3 rounded-full border-2 transition-colors',
              combinatorMode === 'statistical'
                ? 'border-color-terminal-accent-primary bg-color-terminal-accent-primary'
                : 'border-color-terminal-text-muted bg-transparent',
            ].join(' ')} />
            <BarChart3Icon className="text-white" />
            <span className="text-xs font-semibold uppercase tracking-wider text-white">
              {t('signalFactory.linearEnsemble')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-white">{t('signalFactory.lookback')}</label>
            <input
              type="number"
              min={1}
              max={500}
              value={lookback}
              disabled={readOnly}
              onChange={e => {
                if (readOnly) return;
                if (combinatorMode !== 'statistical') onCombinatorModeChange('statistical');
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) onLookbackChange(Math.max(1, Math.min(500, v)));
              }}
              onBlur={e => {
                if (readOnly) return;
                const v = parseInt(e.target.value, 10);
                onLookbackChange(Number.isFinite(v) ? Math.max(1, Math.min(500, v)) : 60);
              }}
              className={[
                'w-16 px-2 py-1 rounded bg-color-terminal-surface border border-color-terminal-border text-color-terminal-text-primary text-xs focus:outline-none focus:border-color-terminal-accent-primary',
                readOnly ? 'cursor-default opacity-70' : '',
              ].join(' ')}
            />
            <span className="text-xs text-white">{t('signalFactory.days')}</span>
          </div>
        </div>

        {/* Feed LSTM toggle */}
        <div className="flex items-center gap-2 mb-3 pl-5">
          <button
            type="button"
            role="switch"
            aria-checked={feedLstm}
            aria-label={t('signalFactory.feedLstmLabel')}
            disabled={readOnly}
            onClick={(e) => {
              e.stopPropagation();
              if (readOnly) return;
              if (combinatorMode !== 'statistical') onCombinatorModeChange('statistical');
              onFeedLstmChange(!feedLstm);
            }}
            className={[
              'relative inline-flex h-4 w-8 items-center rounded-full transition-colors flex-shrink-0',
              feedLstm
                ? 'bg-color-terminal-accent-teal'
                : 'bg-color-terminal-text-muted/30',
              readOnly ? 'cursor-default' : '',
            ].join(' ')}
          >
            <span className={[
              'inline-block h-3 w-3 rounded-full bg-white transition-transform',
              feedLstm ? 'translate-x-4' : 'translate-x-0.5',
            ].join(' ')} />
          </button>
          <span className={[
            'text-[11px] transition-colors',
            feedLstm
              ? 'text-color-terminal-accent-teal'
              : 'text-color-terminal-text-muted',
          ].join(' ')}>
            {t('signalFactory.feedLstmLabel')}
          </span>
        </div>

        {/* Method grid */}
        <div className={combinatorMode === 'statistical' ? '' : 'opacity-40 pointer-events-none'}>
          <CombinatorConfig
            config={{ method, params: {} }}
            onChange={c => {
              if (readOnly) return;
              if (combinatorMode !== 'statistical') onCombinatorModeChange('statistical');
              onMethodChange(c.method);
            }}
            t={t}
            readOnly={readOnly || combinatorMode !== 'statistical'}
            methods={methods}
          />
        </div>
      </div>

      {/* Block B: Deep Learning */}
      <div
        data-testid="combinator-block-deep-learning"
        onClick={() => {
          ipcLog(`Block B clicked readOnly=${readOnly} combinatorMode=${combinatorMode}`);
          if (combinatorMode !== 'deep_learning') {
            ipcLog('switching to deep_learning');
            onCombinatorModeChange('deep_learning');
          }
        }}
        className={[
          'p-4 rounded-lg border transition-all',
          lstmEnabled
            ? 'border-color-terminal-accent-teal/30 bg-black/30'
            : 'border-color-terminal-border/30 bg-black/20 opacity-40 cursor-pointer',
        ].join(' ')}
      >
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <span className={[
              'inline-block w-3 h-3 rounded-full border-2 transition-colors',
              lstmEnabled
                ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal'
                : 'border-color-terminal-text-muted bg-transparent',
            ].join(' ')} />
            <BrainIcon className={lstmEnabled ? 'text-color-terminal-accent-teal' : 'text-color-terminal-text-muted'} />
            <span className={[
              'text-xs font-semibold uppercase tracking-wider transition-colors',
              lstmEnabled ? 'text-color-terminal-accent-teal' : 'text-white',
            ].join(' ')}>
              {t('signalFactory.deepLearning')}
            </span>
            <span className="ml-auto text-[10px] text-color-terminal-text-muted">
              {signalCount} {t('signalFactory.signals')}
            </span>
            {lstmEnabled && (
              <button
                type="button"
                data-testid="lstm-add-model-button"
                onClick={e => { e.stopPropagation(); setPickerOpen(true); }}
                className="ml-1 p-0.5 rounded border border-color-terminal-accent-teal/30
                           text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/15
                           transition-colors"
                title={t('signalFactory.addBacktestModel')}
              >
                <PlusIcon />
              </button>
            )}
          </div>

          {/* Content */}
          <div>
            {/* Fit-quality gauge */}
            {(gaugeSharpes && gaugeSharpes.length >= 2) && (
              <div className="mb-3">
                <FitQualityGauge
                  perFoldSharpes={gaugeSharpes}
                  meanValSharpe={gaugeMean}
                  sampleCount={gaugeSampleCount}
                  modelParamCount={gaugeModelParamCount}
                  live={isTraining}
                />
              </div>
            )}

            {/* Training status */}
            {isTraining && live && active ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <SpinnerIcon className="animate-spin text-color-terminal-accent-teal" />
                  <span className="text-white font-mono text-[11px]">
                    {active.modelType.toUpperCase()} &middot; {active.signalIds.length} {t('signalFactory.signals')}
                  </span>
                  <span className="text-[10px] text-color-terminal-text-muted ml-auto">
                    {formatElapsed((nowMs ?? Date.now()) - live.startedAt)}
                  </span>
                </div>
                <MiniProgressBar
                  current={live.currentFold * live.totalEpochs + live.currentEpoch}
                  total={live.totalFolds * live.totalEpochs}
                  label={t('combinator.foldProgress', { current: live.currentFold + 1, total: live.totalFolds })}
                />
                <MiniProgressBar
                  current={live.currentEpoch}
                  total={live.totalEpochs}
                  label={t('combinator.epochProgress', { current: live.currentEpoch, total: live.totalEpochs })}
                />
                <div className="flex gap-3 text-[10px] text-color-terminal-text-muted">
                  {live.lastLoss != null && <span>{t('combinator.loss')}: {live.lastLoss.toFixed(4)}</span>}
                </div>
                {queuedCount > 0 && (
                  <div className="text-[10px] text-color-terminal-text-muted flex items-center gap-1">
                    <ClockIcon className="w-3 h-3" />
                    {t('combinator.queued', { count: queuedCount })}
                  </div>
                )}
              </div>
            ) : hasHistory && lastCompleted ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <CheckCircleIcon className="text-green-400" />
                  <span className="text-white font-mono text-[11px]">{t('signalFactory.lastTrainedReady')}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-[9px] text-color-terminal-text-muted uppercase">{t('signalFactory.meanValSharpe')}</div>
                    <div className={`text-sm font-mono ${(lastCompleted.meanValSharpe ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                      {lastCompleted.meanValSharpe?.toFixed(4) ?? '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-color-terminal-text-muted uppercase">{t('signalFactory.signals')}</div>
                    <div className="text-sm font-mono text-white">{lastCompleted.signalIds.length}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-color-terminal-text-muted uppercase">{t('signalFactory.completed')}</div>
                    <div className="text-[11px] font-mono text-color-terminal-text-muted">
                      {lastCompleted.completedAt
                        ? new Date(lastCompleted.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : '--'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-color-terminal-text-muted">
                <ClockIcon className="w-3.5 h-3.5" />
                <span>{t('signalFactory.noLstmYet')}</span>
              </div>
            )}

            {/* TICKET_1321: active model first; retained history on demand. */}
            {modelManifest && modelManifest.versions.length > 0 && (
              <ModelVersionHistory
                manifest={modelManifest}
                onSelectVersion={version => {
                  activateModelVersion({
                    combinatorMode,
                    canSelectVersion: version.compatible
                      && version.id !== modelManifest.activeVersion,
                    versionId: version.id,
                    onCombinatorModeChange,
                    onActiveVersionChange,
                  });
                }}
                t={t}
              />
            )}

            {/* TICKET_1277_3 AC1/AC2: the saved snapshot collection is a
                PERSISTENT, distinct section -- no longer visible only inside
                the BacktestModelPicker modal. Snapshot rows are deliberately
                kept out of MODEL VERSIONS above: a version row activates one
                ONNX model, a snapshot row inspects or restores a frozen
                collection. */}
            {getSnapshotVersions && (
              <SavedSnapshotsSection
                onViewVersions={snapshotId => {
                  setPickerSnapshotId(snapshotId);
                  setPickerOpen(true);
                }}
                t={t}
              />
            )}

            {/* Action buttons */}
            {(
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-color-terminal-border/30">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onTrainClick(); }}
                  disabled={isTraining || !lstmEnabled}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium',
                    'bg-color-terminal-accent-teal/15 text-color-terminal-accent-teal',
                    'border border-color-terminal-accent-teal/30',
                    (isTraining || !lstmEnabled)
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-color-terminal-accent-teal/25 transition-colors',
                  ].join(' ')}
                >
                  <ActivityIcon />
                  {t('signalFactory.train')}
                </button>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onDashboardClick(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px]
                             text-color-terminal-text-muted hover:text-color-terminal-text-secondary
                             border border-color-terminal-border/40
                             hover:border-color-terminal-border transition-colors"
                >
                  <ExternalLinkIcon />
                  {t('signalFactory.trainingDashboard')}
                </button>
              </div>
            )}
          </div>

          {/* Signal selection modal */}
          {selectionPayload && (
            <LstmSignalSelectionPanel
              payload={selectionPayload}
              onConfirm={onSelectionConfirm}
              onCancel={onSelectionCancel}
              t={t}
            />
          )}

          {/* TICKET_1015 Part E: Backtest model picker */}
          {pickerOpen && getSnapshotVersions && (
            <BacktestModelPicker
              manifest={modelManifest ?? null}
              snapshotList={snapshotList ?? null}
              onSelectVersion={vId => {
                onActiveVersionChange?.(vId);
                setPickerOpen(false);
                setPickerSnapshotId(null);
              }}
              onImportFromSnapshot={(sId, vId) => {
                onImportVersionFromSnapshot?.(sId, vId);
                setPickerOpen(false);
                setPickerSnapshotId(null);
              }}
              getSnapshotVersions={getSnapshotVersions}
              onClose={() => { setPickerOpen(false); setPickerSnapshotId(null); }}
              t={t}
              initialTab={pickerSnapshotId ? 'snapshots' : 'versions'}
              initialExpandedSnapshotId={pickerSnapshotId}
            />
          )}
      </div>

      {/* Picker guard warnings */}
      {regimeBasedGuardFailed && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200"
        >
          <AlertCircleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-xs leading-relaxed">
            {t('signalFactory.errors.regimeBasedRequiresAnalysis')}
          </p>
        </div>
      )}
      {correlationAdjustedGuardFailed && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200"
        >
          <AlertCircleIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-xs leading-relaxed">
            {t('signalFactory.errors.correlationAdjustedExceedsCap', {
              max: 20,
              count: 0,
            })}
          </p>
        </div>
      )}
    </div>
  );
};
