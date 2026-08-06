/**
 * TICKET_077_31 / TICKET_1000_1: LSTM Signal Selection Panel (Tier 0 shared).
 *
 * Modal overlay for selecting signals before LSTM training.
 * Pure presentation -- receives data via props and fires callbacks.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { ConfirmSignalsPayload } from '../types/combinator';

const COMP_TIER_COLORS: Record<string, string> = {
  lifting: 'text-green-400',
  neutral: 'text-color-terminal-text-muted',
  dragging: 'text-red-400',
  unmeasured: 'text-yellow-400/60',
};

const STAT_TIER_COLORS: Record<string, string> = {
  confirmed: 'text-green-400',
  weak_researchable: 'text-yellow-400',
  stability_compromised: 'text-orange-400',
  noise_shaped: 'text-red-400',
  unverified: 'text-color-terminal-text-muted',
};

// Inline SVG icons (no lucide-react at Tier 0)
function BrainIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function CheckIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export const LstmSignalSelectionPanel: React.FC<{
  payload: ConfirmSignalsPayload;
  onConfirm: (selectedIds: number[]) => void;
  onCancel: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}> = ({ payload, onConfirm, onCancel, t }) => {
  const [selected, setSelected] = useState<Set<number>>(() => {
    const s = new Set<number>();
    for (const c of payload.candidates) {
      if (c.defaultSelected) s.add(c.signalId);
    }
    return s;
  });

  const toggle = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      if (prev.size === payload.candidates.length) return new Set();
      return new Set(payload.candidates.map(c => c.signalId));
    });
  }, [payload.candidates]);

  const selectedCount = selected.size;
  const canTrain = selectedCount >= 2;

  const handleConfirm = useCallback(() => {
    if (!canTrain) return;
    onConfirm([...selected].sort((a, b) => a - b));
  }, [canTrain, selected, onConfirm]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && !e.shiftKey && canTrain) {
        e.preventDefault();
        handleConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, handleConfirm, canTrain]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[4px]"
      onClick={onCancel}
    >
      <div
        className="min-w-[520px] max-w-[640px] max-h-[80vh] flex flex-col rounded-lg border border-color-terminal-border bg-color-terminal-surface shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-color-terminal-border border-l-[3px] border-l-color-terminal-accent-teal bg-color-terminal-panel rounded-t-lg">
          <BrainIcon className="text-color-terminal-accent-teal" />
          <span className="flex-1 font-mono text-xs font-semibold text-color-terminal-text uppercase tracking-wider">
            {t('lstmSelection.title')}
          </span>
          <span className="text-[10px] text-color-terminal-text-muted uppercase">
            {payload.source}
          </span>
          <button
            onClick={onCancel}
            className="p-1 text-color-terminal-text-muted hover:text-color-terminal-text transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[28px_1fr_80px_100px_60px] gap-1 px-4 py-2 border-b border-color-terminal-border/50 text-[9px] text-color-terminal-text-muted uppercase tracking-wider">
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={toggleAll}
              className="w-4 h-4 rounded border border-color-terminal-border hover:border-color-terminal-accent-teal flex items-center justify-center transition-colors"
            >
              {selected.size === payload.candidates.length && <CheckIcon className="text-color-terminal-accent-teal" />}
            </button>
          </div>
          <div>{t('lstmSelection.colSignal')}</div>
          <div>{t('lstmSelection.colTier')}</div>
          <div>{t('lstmSelection.colStability')}</div>
          <div className="text-right">{t('lstmSelection.colIC')}</div>
        </div>

        {/* Signal list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {payload.candidates.map(c => {
            const isSelected = selected.has(c.signalId);
            return (
              <button
                key={c.signalId}
                type="button"
                onClick={() => toggle(c.signalId)}
                className={[
                  'w-full grid grid-cols-[28px_1fr_80px_100px_60px] gap-1 px-4 py-2 text-left transition-colors',
                  isSelected
                    ? 'bg-color-terminal-accent-teal/5 hover:bg-color-terminal-accent-teal/10'
                    : 'bg-transparent hover:bg-white/[0.02] opacity-60',
                ].join(' ')}
              >
                <div className="flex items-center justify-center">
                  <div className={[
                    'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                    isSelected
                      ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/20'
                      : 'border-color-terminal-border',
                  ].join(' ')}>
                    {isSelected && <CheckIcon className="text-color-terminal-accent-teal" />}
                  </div>
                </div>
                <div className="font-mono text-[11px] text-color-terminal-text truncate">
                  {c.displayName}
                </div>
                <div className={`text-[10px] capitalize ${COMP_TIER_COLORS[c.compositionTier] ?? 'text-color-terminal-text-muted'}`}>
                  {c.compositionTier}
                </div>
                <div className={`text-[10px] ${STAT_TIER_COLORS[c.stabilityVerdict] ?? 'text-color-terminal-text-muted'}`}>
                  {c.stabilityVerdict.replace(/_/g, ' ')}
                </div>
                <div className="text-[10px] font-mono text-right text-color-terminal-text-secondary">
                  {c.ic != null ? c.ic.toFixed(3) : '--'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-color-terminal-border">
          <div className="text-[11px] text-color-terminal-text-muted">
            {t('lstmSelection.selected', { count: selectedCount, total: payload.candidates.length })}
            {!canTrain && (
              <span className="ml-2 text-red-400">{t('lstmSelection.minRequired')}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider rounded border border-color-terminal-border bg-transparent text-color-terminal-text-secondary hover:border-color-terminal-text-muted hover:text-color-terminal-text transition-all"
            >
              {t('lstmSelection.cancel')}
            </button>
            <button
              type="button"
              disabled={!canTrain}
              onClick={handleConfirm}
              className={[
                'px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider rounded border transition-all',
                canTrain
                  ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/30'
                  : 'border-color-terminal-border bg-transparent text-color-terminal-text-muted cursor-not-allowed opacity-50',
              ].join(' ')}
            >
              {t('lstmSelection.trainN', { count: selectedCount })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
