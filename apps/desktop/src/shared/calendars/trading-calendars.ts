/**
 * TICKET_958_4 -- Trading calendars (static data, not a runtime signal)
 *
 * Provides `enumerateTradingDays(calendar, startMs, endMs)` -- the day-set
 * truth the cache write-boundary invariant (`assertNoMissingTradingDays`) and
 * the read-path lazy-heal probe (`assessTradingDayGap`) both consume.
 *
 * Calendars are checked-in JSON (`./data/<id>-trading-days.json`) covering
 * 2020-01-01 .. 2030-12-31. The JSONs are generated from
 * `pandas_market_calendars` by
 * `apps/desktop/scripts/958_4_refresh_market_calendars.ts` -- run once a year
 * to extend coverage. There is no runtime Python dependency; the JSON is
 * loaded eagerly at module import.
 *
 * Synthetic calendars (`CRYPTO_24_7`, `FX_5_24`, `NONE`) are computed from
 * weekday rules and need no JSON.
 *
 * Querying a date outside the JSON coverage window throws -- silent
 * truncation would let the day-set invariant pass when it should fail
 * (TICKET_858).
 */

import nyseDays from './data/nyse-trading-days.json';
import xshgDays from './data/xshg-xshe-trading-days.json';

/**
 * Closed set of trading-calendar identifiers. Every `IDataProvider` declares
 * exactly one via `capabilities.tradingCalendar`. Unknown values throw at
 * provider registration time -- unknown calendar must NOT silently disable
 * the day-set invariant.
 *
 * - `NYSE`         -- US equities (NYSE + Nasdaq trading sessions are
 *                     calendar-identical; one entry covers both)
 * - `XSHG_XSHE`    -- China A-shares (Shanghai + Shenzhen exchanges share
 *                     the same calendar)
 * - `CRYPTO_24_7`  -- All days are trading days (24/7 markets)
 * - `FX_5_24`      -- Mon-Fri minus global FX closures (Jan 1, Dec 25,
 *                     Dec 26 Boxing Day)
 * - `NONE`         -- No day-set invariant. Used by imported-package
 *                     providers where the user's file is authoritative,
 *                     and by future providers with non-standard calendars
 *                     that have not yet been added to this enum.
 */
export type TradingCalendarId =
  | 'NYSE'
  | 'XSHG_XSHE'
  | 'CRYPTO_24_7'
  | 'FX_5_24'
  | 'NONE';

const KNOWN_CALENDARS: ReadonlySet<TradingCalendarId> = new Set([
  'NYSE',
  'XSHG_XSHE',
  'CRYPTO_24_7',
  'FX_5_24',
  'NONE',
]);

/**
 * Coverage bounds for the checked-in JSON calendars. Querying outside this
 * window throws (see `enumerateTradingDays`).
 */
interface CalendarJson {
  calendar: string;
  coverage: { start: string; end: string };
  tradingDayCount: number;
  tradingDays: string[];
}

interface ResolvedJsonCalendar {
  daySet: Set<string>; // 'YYYY-MM-DD'
  coverageStartMs: number; // inclusive
  coverageEndMs: number; // inclusive (last covered day, 00:00 UTC)
}

function loadJsonCalendar(json: CalendarJson): ResolvedJsonCalendar {
  return {
    daySet: new Set(json.tradingDays),
    coverageStartMs: Date.UTC(
      Number(json.coverage.start.slice(0, 4)),
      Number(json.coverage.start.slice(5, 7)) - 1,
      Number(json.coverage.start.slice(8, 10)),
    ),
    coverageEndMs: Date.UTC(
      Number(json.coverage.end.slice(0, 4)),
      Number(json.coverage.end.slice(5, 7)) - 1,
      Number(json.coverage.end.slice(8, 10)),
    ),
  };
}

const NYSE = loadJsonCalendar(nyseDays as CalendarJson);
const XSHG_XSHE = loadJsonCalendar(xshgDays as CalendarJson);

const MS_PER_DAY = 86_400_000;

/**
 * FX markets are closed globally on Jan 1 and Dec 25; London (the largest
 * FX center by volume) also closes Dec 26 (Boxing Day), killing liquidity
 * for most pairs. Dukascopy and other providers return zero bars on these
 * dates when they fall on weekdays.
 */
function isFxHoliday(d: Date): boolean {
  const m = d.getUTCMonth(); // 0-indexed
  const day = d.getUTCDate();
  return (m === 0 && day === 1)    // Jan 1
      || (m === 11 && day === 25)  // Dec 25
      || (m === 11 && day === 26); // Dec 26 (Boxing Day)
}

function formatDayUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfUtcDay(epochMs: number): number {
  return Math.floor(epochMs / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * TICKET_958_4 -- public API used by both the write-boundary invariant and
 * the read-path lazy-heal probe.
 *
 * Returns the inclusive set of trading-day epoch-ms (UTC midnight of each
 * trading day) for the given calendar between `startMs` and `endMs`
 * (both inclusive at calendar-day granularity).
 *
 * Throws `RangeError` if the requested window extends outside a JSON
 * calendar's coverage window -- silent truncation would let the invariant
 * pass when it should fail. The 2020-2030 JSON gives the desktop app ~5
 * years of headroom; the refresh script is the maintenance path
 * (`apps/desktop/scripts/958_4_refresh_market_calendars.ts`).
 *
 * Throws `Error` if `calendar === 'NONE'` -- callers must short-circuit
 * the invariant when the provider declares NONE rather than asking for
 * a day set that does not exist.
 */
export function enumerateTradingDays(
  calendar: TradingCalendarId,
  startMs: number,
  endMs: number,
): number[] {
  if (calendar === 'NONE') {
    throw new Error(
      `enumerateTradingDays called with calendar='NONE'; callers must ` +
      `short-circuit the invariant when the provider declares NONE.`,
    );
  }
  if (!KNOWN_CALENDARS.has(calendar)) {
    throw new Error(`Unknown trading calendar: ${calendar}`);
  }
  if (endMs < startMs) return [];

  const startDayMs = startOfUtcDay(startMs);
  const endDayMs = startOfUtcDay(endMs);

  if (calendar === 'CRYPTO_24_7') {
    const out: number[] = [];
    for (let d = startDayMs; d <= endDayMs; d += MS_PER_DAY) out.push(d);
    return out;
  }
  if (calendar === 'FX_5_24') {
    const out: number[] = [];
    for (let d = startDayMs; d <= endDayMs; d += MS_PER_DAY) {
      const dt = new Date(d);
      const dow = dt.getUTCDay();
      if (dow !== 0 && dow !== 6 && !isFxHoliday(dt)) out.push(d);
    }
    return out;
  }

  // JSON-backed calendars: NYSE, XSHG_XSHE
  const cal = calendar === 'NYSE' ? NYSE : XSHG_XSHE;
  if (startDayMs < cal.coverageStartMs || endDayMs > cal.coverageEndMs) {
    throw new RangeError(
      `enumerateTradingDays: requested window [${formatDayUtc(startMs)}, ${formatDayUtc(endMs)}] ` +
      `for calendar=${calendar} extends outside JSON coverage ` +
      `[${formatDayUtc(cal.coverageStartMs)}, ${formatDayUtc(cal.coverageEndMs)}]. ` +
      `Run apps/desktop/scripts/958_4_refresh_market_calendars.ts to extend coverage.`,
    );
  }
  const out: number[] = [];
  for (let d = startDayMs; d <= endDayMs; d += MS_PER_DAY) {
    if (cal.daySet.has(formatDayUtc(d))) out.push(d);
  }
  return out;
}

/**
 * Validate a TradingCalendarId at provider-registration time. Throws if
 * the value is not in the closed enum (TICKET_857 fail-fast).
 */
export function assertKnownTradingCalendar(
  calendar: string,
  providerId: string,
): asserts calendar is TradingCalendarId {
  if (!KNOWN_CALENDARS.has(calendar as TradingCalendarId)) {
    throw new Error(
      `Provider '${providerId}' declares tradingCalendar='${calendar}' ` +
      `which is not a known value. Known: ${Array.from(KNOWN_CALENDARS).join(', ')}. ` +
      `Adding a new calendar requires extending TradingCalendarId and ` +
      `(for JSON-backed calendars) adding the data file.`,
    );
  }
}

/**
 * Format an epoch-ms (assumed to be UTC midnight) as `YYYY-MM-DD`. Exposed for
 * error-message formatting in `CacheWriteIntegrityError`.
 */
export const formatTradingDay = formatDayUtc;
