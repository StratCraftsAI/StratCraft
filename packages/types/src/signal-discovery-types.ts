/**
 * TICKET_1308 7D: Public signal-discovery type primitives.
 *
 * Moved from `shared/constants/signal-discovery.ts` (commercial) so the
 * public `shared/types/signal-discovery.ts` can reference them without
 * pulling a commercial dependency.
 */

/**
 * Nominal/branded type for "training-bar count" (positive integer).
 * Runtime representation is `number`; the brand prevents arithmetic-with-
 * the-wrong-unit at compile time.
 */
export type TrainingBars = number & { readonly __brand: 'TrainingBars' };

export function asTrainingBars(n: number): TrainingBars {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid TrainingBars value: ${n} (must be a non-negative integer)`);
  }
  return n as TrainingBars;
}

export const FACTOR_COMBINATOR_METHODS = ['equal_weight', 'ic_weighted', 'ic_signed', 'regression', 'pca', 'handcraft', 'hrp', 'optimal', 'kelly', 'lstm'] as const;
