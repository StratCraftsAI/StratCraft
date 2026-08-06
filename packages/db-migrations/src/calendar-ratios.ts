/**
 * Calendar-padding ratio computation, shared by Electron main and the standalone
 * MCP server (TICKET_1289_1 F1, TICKET_854 single source of truth).
 *
 * The v-imported-packages backfill migration computes, per imported package, a
 * per-interval "calendar padding ratio" (how much of the wall-clock span the
 * package's bars actually cover). Because that math runs INSIDE a migration
 * body, and the standalone MCP is a separate npm package that cannot import
 * apps/desktop source, the function lives here -- the one place both migration
 * hosts already depend on.
 *
 * Ported verbatim (behaviour-identical) from the original
 * apps/desktop/.../imported-package-ratio.ts; the Electron copy re-exports from
 * here so there is exactly one implementation.
 */
import {
  INTERVAL_1m,
  INTERVAL_5m,
  INTERVAL_15m,
  INTERVAL_30m,
  INTERVAL_1h,
  INTERVAL_4h,
  INTERVAL_1d,
  INTERVAL_1w,
} from '@StratCraft/types';

/**
 * Seconds per bar, keyed on the canonical interval ids from @StratCraft/types.
 * Mirrors the app-side `BAR_SECONDS` (shared/constants/signal-discovery.ts) for
 * exactly the intervals the ratio math needs -- both derive from the same
 * Tier-0 interval constants, so they cannot drift on the id set.
 */
const BAR_SECONDS: Record<string, number> = {
  [INTERVAL_1m]: 60,
  [INTERVAL_5m]: 300,
  [INTERVAL_15m]: 900,
  [INTERVAL_30m]: 1800,
  [INTERVAL_1h]: 3600,
  [INTERVAL_4h]: 4 * 3600,
  [INTERVAL_1d]: 86400,
  [INTERVAL_1w]: 7 * 86400,
};

export interface PackageRatioInputRow {
  readonly interval: string;
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
  readonly rowCount: number;
}

/**
 * Median of a non-empty numeric array. For even-length arrays, returns the
 * lower of the two middle values -- NOT the mean of them. This matters when the
 * two centre values straddle 1.0 vs 1.4: averaging would invent a third ratio
 * that no symbol actually exhibits, which is exactly the kind of silent
 * fabrication TICKET_919_9 exists to prevent.
 */
function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Compute the per-interval calendar-padding ratio for an imported package's
 * files. Behaviour-identical to the original app-side implementation.
 */
export function computePackageCalendarRatios(
  rows: ReadonlyArray<PackageRatioInputRow>,
): Record<string, number> {
  const byInterval = new Map<string, number[]>();
  for (const row of rows) {
    const barSec = BAR_SECONDS[row.interval];
    if (!barSec) continue;
    if (!Number.isFinite(row.firstTimestamp) || !Number.isFinite(row.lastTimestamp)) continue;
    if (!Number.isInteger(row.rowCount) || row.rowCount <= 1) continue;
    const spanSec = row.lastTimestamp - row.firstTimestamp + barSec;
    if (!(spanSec > 0)) continue;
    const ratio = spanSec / (barSec * row.rowCount);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const list = byInterval.get(row.interval);
    if (list) list.push(ratio);
    else byInterval.set(row.interval, [ratio]);
  }

  const out: Record<string, number> = {};
  for (const [interval, ratios] of byInterval) {
    out[interval] = lowerMedian(ratios);
  }
  return out;
}
