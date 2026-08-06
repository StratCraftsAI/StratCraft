/**
 * TICKET_1370 R10/AC26: the single owner of the calendar-date <-> canonical
 * UTC-instant conversion.
 *
 * The user-facing factor-mining window is date-granular and inclusive at both
 * ends; the execution window is the half-open interval
 * `[startUtc, endUtcExclusive)`. Keeping one adapter is what prevents the
 * mixed inclusive/exclusive meanings that R10 exists to remove: UI, MCP,
 * Service API, fingerprinting, command construction, Python filtering, and
 * status all derive from these functions rather than re-deriving a boundary.
 */

import type { FactorMiningExecutionWindow } from '@StratCraft/types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export class WorkloadDateWindowError extends Error {
  constructor(message: string, readonly remediation: string) {
    super(message);
    this.name = 'WorkloadDateWindowError';
  }
}

/**
 * Parse a `YYYY-MM-DD` calendar date to the UTC instant at its start.
 *
 * `Date.UTC` normalizes out-of-range components (month 13 becomes January of
 * the next year), which would silently accept `2025-02-30`. Re-serializing and
 * comparing rejects any date that does not exist on the calendar.
 */
export function parseCalendarDateUtc(value: string, field: string): number {
  if (!DATE_PATTERN.test(value)) {
    throw new WorkloadDateWindowError(
      `${field} must be a YYYY-MM-DD calendar date, received '${value}'.`,
      'Select the date with the date picker rather than typing a timestamp.',
    );
  }
  const [year, month, day] = value.split('-').map(Number);
  const instant = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(instant) || toCalendarDateUtc(instant) !== value) {
    throw new WorkloadDateWindowError(
      `${field} is not a real calendar date: '${value}'.`,
      'Select an existing calendar date.',
    );
  }
  return instant;
}

/** Serialize a UTC instant to its `YYYY-MM-DD` calendar date. */
export function toCalendarDateUtc(instantMs: number): string {
  return new Date(instantMs).toISOString().slice(0, 10);
}

/** Serialize a UTC instant to the canonical `YYYY-MM-DDTHH:mm:ssZ` form. */
export function toCanonicalUtcInstant(instantMs: number): string {
  return `${new Date(instantMs).toISOString().slice(0, 19)}Z`;
}

/**
 * Convert the inclusive user-selected calendar range to the canonical
 * half-open execution interval. The inclusive end date contributes its whole
 * day, so `endUtcExclusive` is the start of the following day.
 */
export function toExecutionWindow(
  selectedStartDate: string,
  selectedEndDate: string,
): FactorMiningExecutionWindow {
  const start = parseCalendarDateUtc(selectedStartDate, 'selectedStartDate');
  const endInclusive = parseCalendarDateUtc(selectedEndDate, 'selectedEndDate');
  if (endInclusive < start) {
    throw new WorkloadDateWindowError(
      `The selected window ends before it starts: '${selectedStartDate}' to '${selectedEndDate}'.`,
      'Select an end date on or after the start date.',
    );
  }
  return {
    selectedStartDate,
    selectedEndDate,
    startUtc: toCanonicalUtcInstant(start),
    endUtcExclusive: toCanonicalUtcInstant(endInclusive + MS_PER_DAY),
  };
}

/**
 * Recover the inclusive end date a user selected from a half-open execution
 * end. Used when projecting a stored window back into the date pickers.
 */
export function toSelectedEndDate(endUtcExclusive: string): string {
  const instant = Date.parse(endUtcExclusive);
  if (!Number.isFinite(instant)) {
    throw new WorkloadDateWindowError(
      `endUtcExclusive is not a valid UTC instant: '${endUtcExclusive}'.`,
      'Resolve a fresh review from the owning workload operation.',
    );
  }
  return toCalendarDateUtc(instant - MS_PER_DAY);
}
