/**
 * Branded epoch types -- compile-time guard against unit
 * confusion on the OHLCV / orchestrator data path (TICKET_813).
 *
 * Background
 * ----------
 * Two units coexist on this pipeline today:
 *
 *   EpochSeconds  Every IDataProvider implementation emits this
 *                 (contract pinned in
 *                 apps/desktop/src/main/services/data-providers/
 *                 types.ts: "timestamp MUST be Unix seconds (not
 *                 milliseconds)"). ParquetCacheService stores it
 *                 verbatim. ParquetCacheService.timestampToDateStr
 *                 multiplies by MS_PER_SECOND to construct a JS Date,
 *                 confirming the in-code unit.
 *
 *   EpochMs       The signal_run table pins is_window_start /
 *                 is_window_end / oos_window_start / oos_window_end
 *                 as INTEGER milliseconds (matching JS
 *                 Date.getTime() interop). The orchestrator's IS/OOS
 *                 walk-forward planner and the fit_universe.py
 *                 slicer both operate in ms space.
 *
 * Both are `number` at runtime. Without a brand the type system
 * cannot tell them apart, and a function that takes the wrong unit
 * will silently produce a 1970 (seconds-as-ms) or 50000 AD
 * (ms-as-seconds) date that no downstream check catches. TICKET_812
 * R1 hit exactly this failure mode -- the loader called
 * `pd.to_datetime(unit='ms')` against a seconds column and produced
 * a 1970 DatetimeIndex that never intersected any IS/OOS window.
 *
 * Usage
 * -----
 * Replace bare `number` on any field that represents an epoch
 * timestamp on this data path:
 *
 *   interface OHLCVRow { timestamp: EpochSeconds; ... }
 *   interface FoldWindowSpec { isWindowStart: EpochMs; ... }
 *
 * Construct branded values via the `asEpoch...` helpers when you
 * know the unit from context (a provider's response, a SQL column,
 * or a parsed CLI arg). Cross between units only via the explicit
 * `epoch...To...` converters; bare arithmetic (`x * 1000`) does NOT
 * produce a branded value and will fail at the assignment site.
 *
 * Runtime cost: zero. Branded types erase to `number` at the JS
 * layer; the constraint exists only during typechecking.
 *
 * Scope: the brand applies to OHLCV pipeline + orchestrator IS/OOS
 * fields only. Telemetry timestamps, credential expiries, and other
 * epoch-shaped fields stay as `number` -- they live on independent
 * data paths and the unit-mixing risk does not apply there.
 */

declare const __epoch_seconds: unique symbol;
declare const __epoch_ms: unique symbol;

/** Unix epoch seconds (1716681600 = 2024-05-26T00:00:00Z). */
export type EpochSeconds = number & { readonly [__epoch_seconds]: true };

/** Unix epoch milliseconds (1716681600000 = 2024-05-26T00:00:00Z). */
export type EpochMs = number & { readonly [__epoch_ms]: true };

/**
 * Tag a raw `number` as `EpochSeconds`. Use only when the unit is
 * known from context (e.g. a provider's API response is documented
 * as seconds). Does not validate the value -- caller asserts.
 */
export const asEpochSeconds = (n: number): EpochSeconds =>
  n as EpochSeconds;

/**
 * Tag a raw `number` as `EpochMs`. Use only when the unit is known
 * from context (e.g. `Date.now()`, a SQL column documented as
 * INTEGER ms). Does not validate the value -- caller asserts.
 */
export const asEpochMs = (n: number): EpochMs =>
  n as EpochMs;

/** Convert seconds -> milliseconds. The ONLY legal seconds->ms path. */
export const epochSecondsToMs = (s: EpochSeconds): EpochMs =>
  ((s as unknown as number) * 1000) as unknown as EpochMs;

/**
 * Convert milliseconds -> seconds (floor). The ONLY legal ms->seconds
 * path. Floors to match the existing provider convention
 * (AlpacaProvider, DukascopyProvider both use `Math.floor(.../1000)`).
 */
export const epochMsToSeconds = (ms: EpochMs): EpochSeconds =>
  Math.floor((ms as unknown as number) / 1000) as unknown as EpochSeconds;
