/**
 * DataDownloadProgress - Inline progress strip for data download phases
 *
 * TICKET_077_P1: Reusable progress bar component for displaying data download
 * status during backtest execution. Positioned between chart content and footer.
 * TICKET_1070: Pipeline mode for multi-symbol downloads (>1 symbol).
 *
 * Phases: idle | downloading | caching | multi_timeframe_loading | complete | error
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_1070 - OHLCV Download Pipeline Progress
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PipelineProgress } from './PipelineProgress';
import type { PipelinePhaseConfig } from './PipelineProgress';

export type DownloadPhase = 'idle' | 'downloading' | 'caching' | 'multi_timeframe_loading' | 'complete' | 'error';

// =============================================================================
// TICKET_1070 AC1-AC6: Pipeline mode types for multi-symbol downloads
// =============================================================================

export interface SymbolDownloadState {
  symbol: string;
  status: 'pending' | 'downloading' | 'complete' | 'error';
  progress: number;
  currentChunkStart?: string;
  currentChunkEnd?: string;
  completedChunks?: number;
  totalChunks?: number;
  barCount?: number;
}

export interface DataDownloadPipelineProps {
  /** Ordered list of symbols being downloaded */
  symbols: SymbolDownloadState[];
  /** Currently active symbol key */
  activeSymbol: string | null;
  /** Whether download was cancelled */
  isCancelled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Single-symbol inline strip props (original)
// =============================================================================

export interface DataDownloadProgressProps {
  /** Current phase */
  phase: DownloadPhase;
  /** Progress value 0.0 ~ 1.0 */
  progress: number;
  /** Status message */
  message: string;
  /** Symbol being downloaded */
  symbol?: string;
  /** Multi-timeframe chunk info */
  currentChunk?: number;
  totalChunks?: number;
  /** Additional CSS classes */
  className?: string;
}

/** Phase-specific color classes */
const PHASE_COLORS: Record<DownloadPhase, { bar: string; text: string }> = {
  idle: { bar: '', text: '' },
  downloading: {
    bar: 'bg-color-terminal-accent-teal',
    text: 'text-color-terminal-accent-teal',
  },
  multi_timeframe_loading: {
    bar: 'bg-color-terminal-accent-teal',
    text: 'text-color-terminal-accent-teal',
  },
  caching: {
    bar: 'bg-color-terminal-accent-gold',
    text: 'text-color-terminal-accent-gold',
  },
  complete: {
    bar: 'bg-green-500',
    text: 'text-green-500',
  },
  error: {
    bar: 'bg-red-500',
    text: 'text-red-400',
  },
};

/** Phase label i18n keys */
const PHASE_LABEL_KEYS: Record<DownloadPhase, string> = {
  idle: '',
  downloading: 'dataDownload.downloading',
  multi_timeframe_loading: 'dataDownload.loading',
  caching: 'dataDownload.caching',
  complete: 'dataDownload.complete',
  error: 'dataDownload.error',
};

/** Spinner SVG icon */
const SpinnerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`w-3.5 h-3.5 animate-spin ${className || ''}`} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/** Check SVG icon */
const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`w-3.5 h-3.5 ${className || ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** Error SVG icon */
const ErrorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`w-3.5 h-3.5 ${className || ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/** Get phase icon */
function PhaseIcon({ phase }: { phase: DownloadPhase }) {
  const colors = PHASE_COLORS[phase];
  switch (phase) {
    case 'downloading':
    case 'multi_timeframe_loading':
    case 'caching':
      return <SpinnerIcon className={colors.text} />;
    case 'complete':
      return <CheckIcon className={colors.text} />;
    case 'error':
      return <ErrorIcon className={colors.text} />;
    default:
      return null;
  }
}

// =============================================================================
// TICKET_1070 AC1-AC6: Pipeline mode for multi-symbol downloads
// =============================================================================

function formatChunkRange(start?: string, end?: string): string {
  if (!start || !end) return '';
  const s = start.slice(0, 7);
  const e = end.slice(0, 7);
  return s === e ? s : `${s} ~ ${e}`;
}

export const DataDownloadPipeline: React.FC<DataDownloadPipelineProps> = ({
  symbols,
  activeSymbol,
  isCancelled = false,
  className,
}) => {
  const { t } = useTranslation('ui');
  const phases: PipelinePhaseConfig[] = useMemo(
    () => symbols.map(s => ({ key: s.symbol, label: s.symbol })),
    [symbols],
  );

  const activeState = symbols.find(s => s.symbol === activeSymbol);
  const chunkProgress = activeState
    ? (activeState.totalChunks && activeState.totalChunks > 0
        ? activeState.completedChunks! / activeState.totalChunks
        : activeState.progress)
    : 0;

  const completedCount = symbols.filter(s => s.status === 'complete').length;

  const currentPhase = (() => {
    if (symbols.every(s => s.status === 'complete')) return 'complete';
    if (!activeSymbol) return 'idle';
    return activeSymbol;
  })();

  const tooltipMessage = (() => {
    if (!activeState) return undefined;
    const range = formatChunkRange(activeState.currentChunkStart, activeState.currentChunkEnd);
    const chunks = activeState.totalChunks
      ? t('dataDownload.chunkProgress', { completed: activeState.completedChunks ?? 0, total: activeState.totalChunks })
      : '';
    const bars = activeState.barCount ? t('dataDownload.barCount', { count: activeState.barCount }) : '';
    return [activeState.symbol, range, chunks, bars].filter(Boolean).join(' — ');
  })();

  return (
    <PipelineProgress
      phases={phases}
      currentPhase={currentPhase}
      progress={chunkProgress}
      visible={true}
      message={tooltipMessage}
      isCancelled={isCancelled}
      completedCount={completedCount}
      className={className}
    />
  );
};

// =============================================================================
// Single-symbol inline strip (original component)
// =============================================================================

export const DataDownloadProgress: React.FC<DataDownloadProgressProps> = ({
  phase,
  progress,
  message,
  symbol,
  currentChunk,
  totalChunks,
  className,
}) => {
  const { t } = useTranslation('ui');
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-show/hide logic
  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (phase === 'idle') {
      setVisible(false);
      return;
    }

    if (phase === 'complete') {
      setVisible(true);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
      }, 2000);
      return;
    }

    // downloading, caching, multi_timeframe_loading, error
    setVisible(true);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [phase]);

  if (!visible) return null;

  const colors = PHASE_COLORS[phase];
  const percent = Math.round(progress * 100);
  const labelKey = PHASE_LABEL_KEYS[phase];
  const label = labelKey ? t(labelKey) : '';

  // Build display message
  const chunkInfo = currentChunk && totalChunks ? ` (${currentChunk}/${totalChunks})` : '';
  const displayMessage = symbol
    ? `${symbol} - ${message}${chunkInfo}`
    : `${message}${chunkInfo}`;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 border-t border-color-terminal-border bg-color-terminal-surface/50 ${className || ''}`}
    >
      {/* Phase icon */}
      <div className="flex-shrink-0">
        <PhaseIcon phase={phase} />
      </div>

      {/* Phase label */}
      <span
        className={`flex-shrink-0 font-mono text-[10px] font-bold uppercase tracking-widest ${colors.text}`}
      >
        {label}
      </span>

      {/* Message */}
      <span className="flex-shrink-0 font-mono text-[11px] text-color-terminal-text-muted truncate max-w-[300px]">
        {displayMessage}
      </span>

      {/* Progress bar */}
      <div className="flex-1 h-1 rounded-full bg-color-terminal-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${colors.bar}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Percentage */}
      <span
        className={`flex-shrink-0 w-8 font-mono text-[11px] font-bold text-right ${colors.text}`}
      >
        {phase !== 'error' ? `${percent}%` : ''}
      </span>
    </div>
  );
};

export default DataDownloadProgress;
