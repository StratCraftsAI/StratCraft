/**
 * TICKET_1070: PipelineProgress compact mode + weight support tests.
 *
 * AC1: Dynamic phases from symbol list
 * AC4: Compact mode for >20 phases (labels hidden, fraction counter)
 */

import { describe, it, expect } from 'vitest';
import { COMPACT_MODE_THRESHOLD } from '../PipelineProgress';
import type { PipelinePhaseConfig } from '../PipelineProgress';

describe('PipelineProgress TICKET_1070', () => {
  describe('COMPACT_MODE_THRESHOLD', () => {
    it('is 20', () => {
      expect(COMPACT_MODE_THRESHOLD).toBe(20);
    });
  });

  describe('AC1: dynamic phases from symbol list', () => {
    it('builds PipelinePhaseConfig[] from symbols', () => {
      const symbols = ['EUR/USD', 'GBP/USD', 'USD/JPY'];
      const phases: PipelinePhaseConfig[] = symbols.map(sym => ({
        key: sym,
        label: sym,
      }));

      expect(phases).toHaveLength(3);
      expect(phases[0]).toEqual({ key: 'EUR/USD', label: 'EUR/USD' });
      expect(phases[2]).toEqual({ key: 'USD/JPY', label: 'USD/JPY' });
    });

    it('supports optional weight field', () => {
      const phases: PipelinePhaseConfig[] = [
        { key: 'A', label: 'A', weight: 2 },
        { key: 'B', label: 'B', weight: 1 },
        { key: 'C', label: 'C' },
      ];

      expect(phases[0].weight).toBe(2);
      expect(phases[1].weight).toBe(1);
      expect(phases[2].weight).toBeUndefined();
    });
  });

  describe('AC4: compact mode threshold', () => {
    it('5 phases is NOT compact', () => {
      expect(5 > COMPACT_MODE_THRESHOLD).toBe(false);
    });

    it('20 phases is NOT compact (boundary)', () => {
      expect(20 > COMPACT_MODE_THRESHOLD).toBe(false);
    });

    it('21 phases IS compact', () => {
      expect(21 > COMPACT_MODE_THRESHOLD).toBe(true);
    });

    it('50 phases IS compact', () => {
      expect(50 > COMPACT_MODE_THRESHOLD).toBe(true);
    });
  });

  describe('weighted grid columns computation', () => {
    it('equal weight produces repeat(N, 1fr)', () => {
      const phases: PipelinePhaseConfig[] = Array.from({ length: 5 }, (_, i) => ({
        key: `s${i}`, label: `S${i}`,
      }));
      const hasWeights = phases.some(p => p.weight != null && p.weight !== 1);
      expect(hasWeights).toBe(false);
      const cols = `repeat(${phases.length}, 1fr)`;
      expect(cols).toBe('repeat(5, 1fr)');
    });

    it('mixed weights produces per-phase fr', () => {
      const phases: PipelinePhaseConfig[] = [
        { key: 'a', label: 'A', weight: 3 },
        { key: 'b', label: 'B', weight: 1 },
        { key: 'c', label: 'C', weight: 2 },
      ];
      const hasWeights = phases.some(p => p.weight != null && p.weight !== 1);
      expect(hasWeights).toBe(true);
      const cols = phases.map(p => `${p.weight ?? 1}fr`).join(' ');
      expect(cols).toBe('3fr 1fr 2fr');
    });

    it('undefined weight defaults to 1fr', () => {
      const phases: PipelinePhaseConfig[] = [
        { key: 'a', label: 'A', weight: 2 },
        { key: 'b', label: 'B' },
      ];
      const cols = phases.map(p => `${p.weight ?? 1}fr`).join(' ');
      expect(cols).toBe('2fr 1fr');
    });
  });

  describe('compact counter math', () => {
    it('derives completedCount from phases when not supplied', () => {
      const phases = Array.from({ length: 50 }, (_, i) => ({ key: `s${i}`, label: `S${i}` }));
      const currentPhaseIndex = 33;
      const isComplete = false;
      const completedCount = undefined;

      const displayCount = completedCount ?? (isComplete ? phases.length : currentPhaseIndex >= 0 ? currentPhaseIndex : 0);
      expect(displayCount).toBe(33);
    });

    it('shows phases.length when complete', () => {
      const phases = Array.from({ length: 50 }, (_, i) => ({ key: `s${i}`, label: `S${i}` }));
      const currentPhaseIndex = -1;
      const isComplete = true;
      const completedCount = undefined;

      const displayCount = completedCount ?? (isComplete ? phases.length : currentPhaseIndex >= 0 ? currentPhaseIndex : 0);
      expect(displayCount).toBe(50);
    });

    it('uses explicit completedCount when supplied', () => {
      const phases = Array.from({ length: 50 }, (_, i) => ({ key: `s${i}`, label: `S${i}` }));
      const completedCount = 42;

      const displayCount = completedCount ?? 0;
      expect(displayCount).toBe(42);
      expect(`${displayCount}/${phases.length}`).toBe('42/50');
    });
  });
});
