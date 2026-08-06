/**
 * TICKET_1280 P2: contract tests for the shared mutation-result derivation.
 *
 * The whole point of `deriveMutationCounters` is that a mutating tool's summary
 * counters are a PROJECTION of `results[]` and can never disagree with the
 * per-input outcomes. These tests pin that invariant.
 */
import { describe, it, expect } from 'vitest';
import { deriveMutationCounters, type MutationOutcome } from './mutation-result';

type AddOutcome =
  | 'added'
  | 'already_present_input_id'
  | 'already_present_resolved_id'
  | 'definition_not_persisted'
  | 'not_found';

function outcome(o: AddOutcome, detail?: string): MutationOutcome<number, AddOutcome> {
  return { input: 1, outcome: o, detail };
}

describe('deriveMutationCounters (TICKET_1280 P2)', () => {
  it('counts a single added outcome', () => {
    const c = deriveMutationCounters([outcome('added')], 'added');
    expect(c).toEqual({ added: 1, skipped: 0, errors: [] });
  });

  it('treats already_present_* as skipped, not error, not added', () => {
    const c = deriveMutationCounters(
      [outcome('already_present_input_id'), outcome('already_present_resolved_id')],
      'added',
    );
    expect(c).toEqual({ added: 0, skipped: 2, errors: [] });
  });

  it('routes not_found / *_not_* outcomes with detail into errors[]', () => {
    const c = deriveMutationCounters(
      [
        outcome('not_found', 'Signal 999: not found'),
        outcome('definition_not_persisted', 'Signal 5: definition exists but has no persisted signal'),
      ],
      'added',
    );
    expect(c.added).toBe(0);
    expect(c.skipped).toBe(0);
    expect(c.errors).toEqual([
      'Signal 999: not found',
      'Signal 5: definition exists but has no persisted signal',
    ]);
  });

  it('added + skipped + errors partition results[] exactly', () => {
    const results: MutationOutcome<number, AddOutcome>[] = [
      outcome('added'),
      outcome('added'),
      outcome('already_present_input_id'),
      outcome('not_found', 'x'),
    ];
    const c = deriveMutationCounters(results, 'added');
    expect(c.added + c.skipped + c.errors.length).toBe(results.length);
    expect(c).toEqual({ added: 2, skipped: 1, errors: ['x'] });
  });

  it('supports multiple added-outcome values', () => {
    type O = 'created' | 'updated' | 'noop';
    const results: MutationOutcome<string, O>[] = [
      { input: 'a', outcome: 'created' },
      { input: 'b', outcome: 'updated' },
      { input: 'c', outcome: 'noop' },
    ];
    const c = deriveMutationCounters(results, ['created', 'updated']);
    expect(c).toEqual({ added: 2, skipped: 1, errors: [] });
  });

  it('an error outcome is classified by its NAME alone, not by a non-empty detail (TICKET_1280 review Minor)', () => {
    // A not_found with an empty detail is STILL an error -- the "error outcome ->
    // error bucket" invariant must not depend on a non-empty detail string, or a
    // detail-less failure silently reads as a benign skip (a member of the same
    // erased-causality class this ticket closes). Missing detail falls back to
    // the outcome name so errors[] is never a phantom empty string.
    const c = deriveMutationCounters([outcome('not_found')], 'added');
    expect(c.skipped).toBe(0);
    expect(c.errors).toEqual(['not_found']);
  });
});
