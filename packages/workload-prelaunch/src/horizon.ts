/**
 * TICKET_1370 R11/AC33: the single owner of the factor-mining forecast horizon.
 *
 * Before R11 the horizon was one required global scalar in the review while
 * Python applied a timeframe-dependent rule (`5m`/`15m`/`30m` -> 5, everything
 * slower -> 1). A mixed-timeframe batch therefore had two possible answers: the
 * user's single reviewed number, and Python's per-cell derivation. Confirming a
 * plan with `horizon: 5` and four timeframes silently forced the `1h` cells off
 * their own rule.
 *
 * This module normalizes the selected timeframes into one `horizonByTimeframe`
 * map. Review, fingerprint, confirmation, admission, command construction,
 * Python execution, persistence, and status all consume that exact map; no
 * layer re-derives it, and no scalar can flatten it.
 */

import type {
  FactorMiningHorizonMap,
  StructuredWorkloadValidationError,
  WorkloadJsonValue,
} from '@StratCraft/types';
import {
  FACTOR_MINING_INTRADAY_HORIZON,
  FACTOR_MINING_INTRADAY_TIMEFRAMES,
  FACTOR_MINING_SLOW_HORIZON,
  FACTOR_MINING_TIMEFRAMES,
} from '@StratCraft/types';

export const HORIZON_ERROR_CODE = 'MINING_HORIZON_INVALID';

/** The repository rule for one timeframe. Mirrors `universe.py:get_horizon`. */
export function horizonForTimeframe(timeframe: string): number {
  return (FACTOR_MINING_INTRADAY_TIMEFRAMES as readonly string[]).includes(timeframe)
    ? FACTOR_MINING_INTRADAY_HORIZON
    : FACTOR_MINING_SLOW_HORIZON;
}

export interface HorizonResolution {
  readonly horizonByTimeframe?: FactorMiningHorizonMap;
  readonly errors: readonly StructuredWorkloadValidationError[];
}

function invalid(message: string, remediation: string): HorizonResolution {
  return {
    errors: [{
      code: HORIZON_ERROR_CODE,
      parameterIds: ['horizonByTimeframe'],
      message,
      remediation,
    }],
  };
}

/**
 * Derive the map for the selected timeframes, honouring an explicit
 * per-timeframe override where one is supplied.
 *
 * The result covers exactly the selected timeframes: adding a timeframe adds an
 * assignment, removing one drops it, and either change alters the fingerprint
 * (AC35). An override naming a timeframe that is not selected is refused rather
 * than silently ignored, because a plan cannot be confirmed against an
 * assignment that will never execute.
 */
export function resolveHorizonByTimeframe(
  timeframes: WorkloadJsonValue | undefined,
  override?: WorkloadJsonValue,
): HorizonResolution {
  if (!Array.isArray(timeframes) || timeframes.length === 0
    || timeframes.some(value => typeof value !== 'string')) {
    return invalid(
      'Select at least one timeframe before the forecast horizon can be derived.',
      'Choose the timeframes to mine; the horizon for each is derived from the repository rule.',
    );
  }
  const selected = timeframes as readonly string[];
  const unsupported = selected.filter(
    timeframe => !(FACTOR_MINING_TIMEFRAMES as readonly string[]).includes(timeframe),
  );
  if (unsupported.length > 0) {
    return invalid(
      `Unsupported timeframe(s): ${unsupported.join(', ')}.`,
      `Choose from: ${FACTOR_MINING_TIMEFRAMES.join(', ')}.`,
    );
  }
  const explicit: Record<string, number> = {};
  if (override !== undefined && override !== null) {
    if (typeof override !== 'object' || Array.isArray(override)) {
      return invalid(
        'The forecast horizon override must be a per-timeframe map.',
        'Supply one positive integer horizon per selected timeframe, or omit the override entirely.',
      );
    }
    const entries = Object.entries(override as Readonly<Record<string, WorkloadJsonValue>>);
    for (const [timeframe, value] of entries) {
      if (!selected.includes(timeframe)) {
        return invalid(
          `The horizon override names timeframe '${timeframe}', which is not selected.`,
          'Override only the timeframes this plan will execute, or remove the extra entry.',
        );
      }
      if (!Number.isInteger(value) || Number(value) < 1) {
        return invalid(
          `The horizon for '${timeframe}' must be a positive integer.`,
          'Supply a whole number of forecast bars, or remove the override to use the repository rule.',
        );
      }
      explicit[timeframe] = Number(value);
    }
  }
  const resolved: Record<string, number> = {};
  // Canonical key order, so the fingerprint of a plan does not depend on the
  // order the user happened to click the timeframe buttons in.
  for (const timeframe of [...new Set(selected)].sort((left, right) => left.localeCompare(right))) {
    resolved[timeframe] = explicit[timeframe] ?? horizonForTimeframe(timeframe);
  }
  return { horizonByTimeframe: resolved, errors: [] };
}

/** Serialize the confirmed map for the Python CLI: `5m=5,15m=5,1h=1`. */
export function serializeHorizonMap(map: FactorMiningHorizonMap): string {
  return Object.keys(map)
    .sort((left, right) => left.localeCompare(right))
    .map(timeframe => `${timeframe}=${map[timeframe]}`)
    .join(',');
}
