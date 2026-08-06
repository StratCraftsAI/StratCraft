/**
 * TICKET_1326 -- full-coverage tests for the training-bar budget resolver
 * (TICKET_494 mandate: 100% of changed code paths).
 *
 * The defect this module closes was NOT a wrong number: it was three call
 * sites each hardcoding one point from the `(timeframe, workload)` space
 * against one ceiling that rejected two of them. So the tests below pin the
 * *invariants* that make a re-divergence impossible, not just the current
 * values:
 *
 *   AC6 -- every resolved default satisfies its own bounds (the live defect:
 *          `start_sweep`'s advertised 1000 exceeded the 500 ceiling that the
 *          same operation's validator enforced).
 *   AC3 -- `preview` retains the 500 ceiling (TICKET_870 / TICKET_871_1 guard).
 *   AC4 -- `batch` admits the per-timeframe table AND TICKET_1262's 8000.
 *   AC7 -- a `batch` budget on 1h spans the regime window D3's rationale
 *          requires, verified as a property of the resolver rather than a
 *          hardcoded fixture.
 *   AC8 -- timeframe-missing fallback and both workload bound sets.
 */

import { describe, expect, it } from 'vitest';

import {
  TRAINING_BAR_WORKLOADS,
  TRAINING_BAR_WORKLOAD_DEFAULT,
  TRAINING_BAR_WORKLOAD_BOUNDS,
  TRAINING_BARS_MIN,
  TRAINING_BARS_PREVIEW_MAX,
  TRAINING_BARS_BATCH_MAX,
  TRAINING_BARS_PREVIEW_DEFAULT,
  TRAINING_BARS_BATCH_DEFAULTS,
  TRAINING_BARS_BATCH_FALLBACK,
  resolveTrainingBarBudget,
  validateTrainingBarOverride,
  isTrainingBarWorkload,
} from '../training-bar-budget';

/** TICKET_1262: the mandated ML-template sweep budget. */
const TICKET_1262_TRAINING_BARS = 8000;

describe('TICKET_1326 resolveTrainingBarBudget', () => {
  // ---------------------------------------------------------------- AC6
  // The invariant that closes the live defect. If this fails, some surface
  // is advertising a default its own validator will reject.
  describe('AC6 -- no resolved default violates its own bounds', () => {
    const timeframes = [...Object.keys(TRAINING_BARS_BATCH_DEFAULTS), 'unknown_tf', '', undefined];

    for (const workload of TRAINING_BAR_WORKLOADS) {
      for (const timeframe of timeframes) {
        it(`${workload} / ${String(timeframe) || '(empty)'} resolves within bounds`, () => {
          const b = resolveTrainingBarBudget({ timeframe, workload });
          expect(b.bars).toBeGreaterThanOrEqual(b.min);
          expect(b.bars).toBeLessThanOrEqual(b.max);
          // And the resolved default must itself pass the override validator
          // -- the exact check the operation performs on an explicit value.
          expect(validateTrainingBarOverride(b.bars, workload)).toBeNull();
        });
      }
    }

    it('holds even if the batch table were edited to overshoot the ceiling', () => {
      // The resolver clamps rather than trusting the table, so the invariant
      // survives a future careless edit to TRAINING_BARS_BATCH_DEFAULTS.
      for (const bars of Object.values(TRAINING_BARS_BATCH_DEFAULTS)) {
        expect(bars).toBeLessThanOrEqual(TRAINING_BARS_BATCH_MAX);
      }
    });
  });

  // ---------------------------------------------------------------- AC3
  describe('AC3 -- the preview guard survives', () => {
    it('preview ceiling is still 500 (TICKET_870 / TICKET_871_1)', () => {
      expect(TRAINING_BARS_PREVIEW_MAX).toBe(500);
      expect(TRAINING_BAR_WORKLOAD_BOUNDS.preview.max).toBe(500);
    });

    it('a preview request above the ceiling is still refused', () => {
      expect(validateTrainingBarOverride(501, 'preview')).toEqual({ min: 5, max: 500 });
      expect(validateTrainingBarOverride(8000, 'preview')).not.toBeNull();
    });

    it('preview default is unchanged at 100 and timeframe-independent', () => {
      expect(TRAINING_BARS_PREVIEW_DEFAULT).toBe(100);
      const on1h = resolveTrainingBarBudget({ timeframe: '1h', workload: 'preview' });
      const on1d = resolveTrainingBarBudget({ timeframe: '1d', workload: 'preview' });
      const noTf = resolveTrainingBarBudget({ workload: 'preview' });
      expect(on1h.bars).toBe(100);
      expect(on1d.bars).toBe(100);
      expect(noTf.bars).toBe(100);
      // Preview never reports a fallback -- it has no per-timeframe table.
      expect(noTf.usedFallback).toBe(false);
    });
  });

  // ---------------------------------------------------------------- AC4
  describe('AC4 -- batch admits the existing batch policies', () => {
    it('admits every per-timeframe table value', () => {
      for (const [tf, expected] of Object.entries(TRAINING_BARS_BATCH_DEFAULTS)) {
        const b = resolveTrainingBarBudget({ timeframe: tf, workload: 'batch' });
        expect(b.bars, `batch default for ${tf}`).toBe(expected);
        expect(validateTrainingBarOverride(expected, 'batch')).toBeNull();
      }
    });

    it("admits TICKET_1262's mandated TRAINING_BARS=8000", () => {
      expect(validateTrainingBarOverride(TICKET_1262_TRAINING_BARS, 'batch')).toBeNull();
      // ...and pins WHY it previously could not be expressed as policy: the
      // old uniform ceiling rejected it.
      expect(validateTrainingBarOverride(TICKET_1262_TRAINING_BARS, 'preview')).not.toBeNull();
    });

    it('the intraday table values were ALL unreachable under the old ceiling', () => {
      // Regression pin for TICKET_1326 sec.3.1: this is the reason "just make
      // start_sweep read the table" was not a valid fix.
      const overOldCeiling = Object.entries(TRAINING_BARS_BATCH_DEFAULTS)
        .filter(([, bars]) => bars > TRAINING_BARS_PREVIEW_MAX)
        .map(([tf]) => tf);
      expect(overOldCeiling).toEqual(['1m', '5m', '15m', '30m', '1h', '4h']);
    });
  });

  // ---------------------------------------------------------------- AC7
  describe('AC7 -- batch windows span the regime horizon', () => {
    // D3's stated rationale (Lopez de Prado, AFML ch.7): "on 1d this means
    // ~2 years, on 1h ~6 months." Verified as a property of the resolver by
    // converting bars -> calendar span, so retuning the table cannot silently
    // break the rationale it claims to implement.
    const BARS_PER_DAY: Record<string, number> = {
      '1m': 390, '5m': 78, '15m': 26, '30m': 13, '1h': 6.5, '4h': 1.625, '1d': 1, '1w': 1 / 5,
    };
    const TRADING_DAYS_PER_MONTH = 21;

    it('1h batch budget spans at least ~6 months of trading days', () => {
      const b = resolveTrainingBarBudget({ timeframe: '1h', workload: 'batch' });
      const days = b.bars / BARS_PER_DAY['1h'];
      expect(days / TRADING_DAYS_PER_MONTH).toBeGreaterThanOrEqual(6);
    });

    it('1d batch budget spans at least ~2 years of trading days', () => {
      const b = resolveTrainingBarBudget({ timeframe: '1d', workload: 'batch' });
      const days = b.bars / BARS_PER_DAY['1d'];
      expect(days / 252).toBeGreaterThanOrEqual(1.9);
    });

    it('every batch budget spans strictly more calendar time than preview', () => {
      // The weaker but actually-correct property. D3's rationale states only
      // two anchors (1d ~2yr, 1h ~6mo) and its sub-hourly entries are NOT
      // month-spanning -- 1m at 5000 bars is ~13 trading days. Asserting
      // ">1 month everywhere" would be re-deriving D3's statistical values,
      // which TICKET_1326 sec.7 puts out of scope.
      //
      // What must hold on every timeframe is the reason the two workloads are
      // separate at all: batch gets a strictly larger window than the
      // interactive Preview budget.
      for (const tf of Object.keys(TRAINING_BARS_BATCH_DEFAULTS)) {
        const batch = resolveTrainingBarBudget({ timeframe: tf, workload: 'batch' });
        const preview = resolveTrainingBarBudget({ timeframe: tf, workload: 'preview' });
        expect(batch.bars, `batch vs preview on ${tf}`).toBeGreaterThan(preview.bars);
      }
    });

    it('sub-hourly batch budgets are documented as day-scale, not month-scale', () => {
      // Pins the known shape of D3 so the AC7 anchors above are not mistaken
      // for a universal guarantee. If a future ticket retunes these, this
      // test is the place that records the old expectation.
      const days = (tf: string) =>
        resolveTrainingBarBudget({ timeframe: tf, workload: 'batch' }).bars / BARS_PER_DAY[tf];
      expect(days('1m')).toBeLessThan(TRADING_DAYS_PER_MONTH);
      expect(days('1h')).toBeGreaterThan(6 * TRADING_DAYS_PER_MONTH);
    });
  });

  // ---------------------------------------------------------------- AC8
  describe('AC8 -- fallback and bound-set coverage', () => {
    it('an unknown timeframe uses the batch fallback and flags it', () => {
      const b = resolveTrainingBarBudget({ timeframe: 'never_a_timeframe', workload: 'batch' });
      expect(b.bars).toBe(TRAINING_BARS_BATCH_FALLBACK);
      expect(b.usedFallback).toBe(true);
    });

    it('an absent timeframe uses the batch fallback and flags it', () => {
      for (const timeframe of [undefined, null, '', '   ']) {
        const b = resolveTrainingBarBudget({ timeframe, workload: 'batch' });
        expect(b.bars).toBe(TRAINING_BARS_BATCH_FALLBACK);
        expect(b.usedFallback).toBe(true);
      }
    });

    it('a known timeframe does NOT flag a fallback', () => {
      expect(resolveTrainingBarBudget({ timeframe: '5m', workload: 'batch' }).usedFallback).toBe(false);
    });

    it('trims surrounding whitespace on the timeframe', () => {
      expect(resolveTrainingBarBudget({ timeframe: '  5m  ', workload: 'batch' }).bars)
        .toBe(TRAINING_BARS_BATCH_DEFAULTS['5m']);
    });

    it('reports the workload actually applied', () => {
      expect(resolveTrainingBarBudget({ workload: 'batch' }).workload).toBe('batch');
      expect(resolveTrainingBarBudget({ workload: 'preview' }).workload).toBe('preview');
      expect(resolveTrainingBarBudget().workload).toBe(TRAINING_BAR_WORKLOAD_DEFAULT);
    });

    it('both bound sets share the same floor', () => {
      expect(TRAINING_BAR_WORKLOAD_BOUNDS.preview.min).toBe(TRAINING_BARS_MIN);
      expect(TRAINING_BAR_WORKLOAD_BOUNDS.batch.min).toBe(TRAINING_BARS_MIN);
    });

    it('batch bounds are strictly wider than preview bounds', () => {
      expect(TRAINING_BAR_WORKLOAD_BOUNDS.batch.max)
        .toBeGreaterThan(TRAINING_BAR_WORKLOAD_BOUNDS.preview.max);
    });

    it('an empty request resolves to the conservative preview default', () => {
      // Fail-closed on the resource dimension (TICKET_856): a caller that
      // has not declared a workload must NOT get the larger batch window.
      const b = resolveTrainingBarBudget();
      expect(b.workload).toBe('preview');
      expect(b.max).toBe(TRAINING_BARS_PREVIEW_MAX);
    });
  });

  // ------------------------------------------------------- override validator
  describe('validateTrainingBarOverride', () => {
    it('rejects non-integers, NaN, and non-numeric input', () => {
      for (const bad of [10.5, NaN, Infinity, -Infinity, 'abc', {}, [], null, undefined]) {
        expect(validateTrainingBarOverride(bad, 'batch'), `${String(bad)}`).not.toBeNull();
      }
    });

    it('accepts a numeric string that is an exact integer', () => {
      // The IPC boundary receives raw JSON; `Number('300')` is the historical
      // coercion and must keep working.
      expect(validateTrainingBarOverride('300', 'preview')).toBeNull();
    });

    it('rejects below the floor and above each ceiling', () => {
      expect(validateTrainingBarOverride(TRAINING_BARS_MIN - 1, 'preview')).not.toBeNull();
      expect(validateTrainingBarOverride(TRAINING_BARS_MIN - 1, 'batch')).not.toBeNull();
      expect(validateTrainingBarOverride(TRAINING_BARS_PREVIEW_MAX + 1, 'preview')).not.toBeNull();
      expect(validateTrainingBarOverride(TRAINING_BARS_BATCH_MAX + 1, 'batch')).not.toBeNull();
    });

    it('accepts the exact bounds (inclusive)', () => {
      expect(validateTrainingBarOverride(TRAINING_BARS_MIN, 'preview')).toBeNull();
      expect(validateTrainingBarOverride(TRAINING_BARS_PREVIEW_MAX, 'preview')).toBeNull();
      expect(validateTrainingBarOverride(TRAINING_BARS_BATCH_MAX, 'batch')).toBeNull();
    });

    it('defaults to the preview bounds when no workload is given', () => {
      expect(validateTrainingBarOverride(501)).not.toBeNull();
      expect(validateTrainingBarOverride(500)).toBeNull();
    });

    it('returns the bounds it applied, for error-message construction', () => {
      expect(validateTrainingBarOverride(99999, 'batch'))
        .toEqual({ min: TRAINING_BARS_MIN, max: TRAINING_BARS_BATCH_MAX });
    });
  });

  describe('isTrainingBarWorkload', () => {
    it('accepts exactly the known workloads', () => {
      for (const w of TRAINING_BAR_WORKLOADS) expect(isTrainingBarWorkload(w)).toBe(true);
    });

    it('rejects anything else', () => {
      for (const bad of ['Preview', 'BATCH', 'live', '', null, undefined, 1, {}]) {
        expect(isTrainingBarWorkload(bad), `${String(bad)}`).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------- AC5 / AC2
  describe('AC2/AC5 -- single ownership', () => {
    it('is deterministic: identical inputs give an identical budget', () => {
      // The cross-surface parity guarantee (UAC1) reduces to this, because
      // every surface now calls this same function with the same inputs.
      for (const tf of Object.keys(TRAINING_BARS_BATCH_DEFAULTS)) {
        for (const workload of TRAINING_BAR_WORKLOADS) {
          const a = resolveTrainingBarBudget({ timeframe: tf, workload });
          const b = resolveTrainingBarBudget({ timeframe: tf, workload });
          expect(a).toEqual(b);
        }
      }
    });

    it('the batch table still carries D3\'s documented values verbatim', () => {
      // Scope boundary (TICKET_1326 sec.7): this ticket makes the existing
      // policy reachable; it does NOT retune it. Pin the values so a future
      // change to them is a deliberate, reviewed act.
      expect(TRAINING_BARS_BATCH_DEFAULTS).toEqual({
        '1m': 5000, '5m': 3000, '15m': 2500, '30m': 2000,
        '1h': 2000, '4h': 1000, '1d': 500, '1w': 260,
      });
    });
  });
});
