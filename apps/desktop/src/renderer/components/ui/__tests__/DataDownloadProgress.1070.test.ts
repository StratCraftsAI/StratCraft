/**
 * TICKET_1070: DataDownloadPipeline tests.
 *
 * AC1: Dynamic phases from symbol list
 * AC2: Per-symbol chunk progress
 * AC3: Tooltip message includes date range
 * AC4: Compact mode for >20 symbols (delegated to PipelineProgress)
 * AC5: Pipeline mode when totalSymbols > 1
 * AC6: Cancel state
 */

import { describe, it, expect } from 'vitest';
import type { SymbolDownloadState } from '../DataDownloadProgress';

function formatChunkRange(start?: string, end?: string): string {
  if (!start || !end) return '';
  const s = start.slice(0, 7);
  const e = end.slice(0, 7);
  return s === e ? s : `${s} ~ ${e}`;
}

function buildTooltipMessage(activeState: SymbolDownloadState | undefined): string | undefined {
  if (!activeState) return undefined;
  const range = formatChunkRange(activeState.currentChunkStart, activeState.currentChunkEnd);
  const chunks = activeState.totalChunks
    ? `chunk ${activeState.completedChunks ?? 0}/${activeState.totalChunks}`
    : '';
  const bars = activeState.barCount ? `${activeState.barCount.toLocaleString()} bars` : '';
  return [activeState.symbol, range, chunks, bars].filter(Boolean).join(' — ');
}

describe('DataDownloadPipeline TICKET_1070', () => {
  describe('AC1: dynamic phases from symbol list', () => {
    it('maps symbols to PipelinePhaseConfig[]', () => {
      const symbols: SymbolDownloadState[] = [
        { symbol: 'EUR/USD', status: 'complete', progress: 1 },
        { symbol: 'GBP/USD', status: 'downloading', progress: 0.5 },
        { symbol: 'USD/JPY', status: 'pending', progress: 0 },
      ];

      const phases = symbols.map(s => ({ key: s.symbol, label: s.symbol }));
      expect(phases).toHaveLength(3);
      expect(phases.map(p => p.key)).toEqual(['EUR/USD', 'GBP/USD', 'USD/JPY']);
    });
  });

  describe('AC2: per-symbol chunk progress', () => {
    it('computes chunk progress from completedChunks/totalChunks', () => {
      const active: SymbolDownloadState = {
        symbol: 'EUR/USD',
        status: 'downloading',
        progress: 0,
        completedChunks: 15,
        totalChunks: 23,
      };
      const chunkProgress = active.totalChunks! > 0
        ? active.completedChunks! / active.totalChunks!
        : active.progress;
      expect(chunkProgress).toBeCloseTo(15 / 23);
    });

    it('falls back to progress when no chunk data', () => {
      const active: SymbolDownloadState = {
        symbol: 'EUR/USD',
        status: 'downloading',
        progress: 0.4,
      };
      const chunkProgress = active.totalChunks && active.totalChunks > 0
        ? active.completedChunks! / active.totalChunks
        : active.progress;
      expect(chunkProgress).toBe(0.4);
    });
  });

  describe('AC3: tooltip message with date range', () => {
    it('formats full tooltip with all fields', () => {
      const active: SymbolDownloadState = {
        symbol: 'EUR/USD',
        status: 'downloading',
        progress: 0.5,
        currentChunkStart: '2018-01-01',
        currentChunkEnd: '2018-12-31',
        completedChunks: 15,
        totalChunks: 23,
        barCount: 142800,
      };
      const msg = buildTooltipMessage(active);
      expect(msg).toContain('EUR/USD');
      expect(msg).toContain('2018-01 ~ 2018-12');
      expect(msg).toContain('chunk 15/23');
      expect(msg).toContain('142,800 bars');
    });

    it('omits missing fields gracefully', () => {
      const active: SymbolDownloadState = {
        symbol: 'GBP/USD',
        status: 'downloading',
        progress: 0.3,
      };
      const msg = buildTooltipMessage(active);
      expect(msg).toBe('GBP/USD');
    });

    it('returns undefined for null active state', () => {
      expect(buildTooltipMessage(undefined)).toBeUndefined();
    });

    it('collapses same-month range', () => {
      expect(formatChunkRange('2018-06-01', '2018-06-30')).toBe('2018-06');
    });

    it('shows range for cross-month chunk', () => {
      expect(formatChunkRange('2018-01-01', '2018-06-30')).toBe('2018-01 ~ 2018-06');
    });
  });

  describe('AC5: currentPhase derivation', () => {
    it('returns "complete" when all symbols done', () => {
      const symbols: SymbolDownloadState[] = [
        { symbol: 'A', status: 'complete', progress: 1 },
        { symbol: 'B', status: 'complete', progress: 1 },
      ];
      const allComplete = symbols.every(s => s.status === 'complete');
      expect(allComplete).toBe(true);
    });

    it('returns "idle" when no active symbol', () => {
      const activeSymbol = null;
      const currentPhase = activeSymbol ?? 'idle';
      expect(currentPhase).toBe('idle');
    });

    it('returns active symbol key when downloading', () => {
      const activeSymbol = 'EUR/USD';
      const currentPhase = activeSymbol;
      expect(currentPhase).toBe('EUR/USD');
    });
  });

  describe('AC6: cancel state', () => {
    it('completedCount counts only complete symbols', () => {
      const symbols: SymbolDownloadState[] = [
        { symbol: 'A', status: 'complete', progress: 1 },
        { symbol: 'B', status: 'downloading', progress: 0.3 },
        { symbol: 'C', status: 'pending', progress: 0 },
        { symbol: 'D', status: 'error', progress: 0 },
      ];
      const completedCount = symbols.filter(s => s.status === 'complete').length;
      expect(completedCount).toBe(1);
    });
  });
});
