/**
 * Session-anchored bucket alignment for intraday aggregation.
 *
 * TICKET_196_12 Step 5: when a non-native intraday target (2h / 4h) is produced
 * by rolling up a finer native bar, the roll-up bucket boundary MUST land on the
 * same wall-clock instant an exchange-native bar would. For a 24/7 market (crypto
 * / FX) that is a plain UTC-epoch floor. For a Regular-Trading-Hours equity market
 * it is NOT: the US equity session opens 09:30 America/New_York, so a 4h equity
 * bucket must anchor to the session open, not UTC midnight. A UTC-floored 4h
 * bucket would split each session at 00:00/04:00/08:00/12:00/16:00/20:00 UTC --
 * boundaries that fall mid-session and systematically shift every aggregated bar.
 *
 * The anchor is a PROVIDER-LEVEL property derived from `capabilities.assetTypes`,
 * following the same provider-self-declaration convention the calendar-padding
 * ratio already uses (`pull-window.ts`, where yfinance is treated as equity).
 * A provider that serves any equity class (stock / etf / index) anchors to RTH;
 * a provider that serves only 24/7 classes (crypto / forex) stays UTC.
 *
 * DST is handled via `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })`
 * -- no external date library (none is bundled) and no hand-coded EST/EDT offset.
 *
 * @see TICKET_196_12_UNIFIED_ALL_TIMEFRAME_PROVIDER_SUPPORT.md Step 5
 */

import type { ProviderCapabilities } from '../types';

/** How intraday roll-up buckets are anchored. */
export type SessionAnchor = 'utc' | 'rth-equity';

/** Asset classes that trade a bounded daily session (Regular Trading Hours). */
const RTH_EQUITY_ASSET_TYPES: ReadonlySet<string> = new Set(['stock', 'etf', 'index']);

/** US equity Regular Trading Hours open, in America/New_York wall-clock. */
const RTH_OPEN_HOUR = 9;
const RTH_OPEN_MINUTE = 30;

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MINUTE = 60;

/**
 * Derive the bucket anchor for a provider from its declared asset classes.
 *
 * A provider that serves ANY Regular-Trading-Hours equity class anchors intraday
 * buckets to the session open; a provider that serves only 24/7 classes (crypto,
 * forex) floors by UTC epoch. This mirrors the existing calendar-padding
 * convention (yfinance, a mixed provider, is treated as equity).
 */
export function resolveSessionAnchor(
  assetTypes: ProviderCapabilities['assetTypes'],
): SessionAnchor {
  for (const t of assetTypes) {
    if (RTH_EQUITY_ASSET_TYPES.has(t)) return 'rth-equity';
  }
  return 'utc';
}

/**
 * The America/New_York wall-clock fields for a given UTC instant. Uses Intl so
 * the EST/EDT transition is handled by the platform tz database, never a
 * hand-coded offset.
 */
function nyParts(epochSeconds: number): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value ?? '0';
    // Intl emits hour '24' for midnight under hour12:false on some engines.
    return v === '24' ? 0 : Number(v);
  };
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  };
}

/**
 * The UTC epoch (seconds) of the America/New_York 09:30 session open for the
 * trading day that contains `epochSeconds`.
 *
 * Derived by computing the NY wall-clock seconds-since-midnight of the instant,
 * then subtracting that offset and adding the fixed 09:30 open offset. This
 * yields the same UTC instant regardless of whether the day is EST or EDT,
 * because both the instant and the open are expressed in the SAME NY day's
 * local frame.
 */
export function rthSessionOpenEpochSeconds(epochSeconds: number): number {
  const p = nyParts(epochSeconds);
  const nySecondsOfDay = p.hour * 3600 + p.minute * SECONDS_PER_MINUTE + p.second;
  const openSecondsOfDay = RTH_OPEN_HOUR * 3600 + RTH_OPEN_MINUTE * SECONDS_PER_MINUTE;
  return epochSeconds - nySecondsOfDay + openSecondsOfDay;
}

/**
 * Floor `timestamp` (epoch seconds) to the start of its intraday bucket of
 * `bucketSeconds`, anchored per `anchor`.
 *
 *  - `utc`        -> plain UTC-epoch floor (24/7 markets).
 *  - `rth-equity` -> floor relative to the trading day's 09:30 ET session open,
 *                    so the first bucket of every session starts exactly at the
 *                    open. A bar before the open (pre-market) floors into the
 *                    previous session's last bucket via the standard modular
 *                    arithmetic; downstream dedup keeps the canonical bar.
 */
export function bucketStartEpochSeconds(
  timestamp: number,
  bucketSeconds: number,
  anchor: SessionAnchor,
): number {
  if (anchor === 'utc') {
    return Math.floor(timestamp / bucketSeconds) * bucketSeconds;
  }
  // rth-equity: anchor to the session open of the timestamp's trading day.
  const sessionOpen = rthSessionOpenEpochSeconds(timestamp);
  const offset = timestamp - sessionOpen;
  // Math.floor handles negative offsets (pre-open bars) correctly: they floor
  // toward the previous bucket boundary rather than truncating toward zero.
  return sessionOpen + Math.floor(offset / bucketSeconds) * bucketSeconds;
}

export const __testing = {
  RTH_OPEN_HOUR,
  RTH_OPEN_MINUTE,
  SECONDS_PER_DAY,
};
