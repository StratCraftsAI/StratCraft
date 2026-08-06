/**
 * FRED Macro Data Provider
 *
 * TICKET_568_5_1 Phase 3: First concrete IAlternativeDataProvider. Sources
 * macro time series from the St. Louis Fed FRED + ALFRED archives:
 *
 *   - ALFRED (Archival FRED) -- vintage-aware. Returns the value the
 *     investor would have actually seen at `vintage_as_of`. This is the
 *     ONLY honest source for backtests because macro series are revised
 *     after first publication (GDP first-release vs. 1-month vs. annual
 *     benchmark, etc.).
 *   - FRED (latest revision) -- explicitly NOT used in this provider. The
 *     latest-revision endpoint would silently leak future information into
 *     historical joins (the "first reported X at time T" is the only honest
 *     value at T; ALFRED gives us that, FRED does not).
 *
 * Auth: BYOK pass-through per TICKET_435. Reads `fred.apiKey` from the
 * SecureCredentialService under the back-test plugin namespace -- same
 * pattern as alpaca-provider. Free FRED tier requires registration; the
 * key is never persisted server-side.
 *
 * Provider contract:
 *   source: 'macro'
 *   vintage_supported: true   -- ALFRED is the vintage archive
 *   live_streaming_supported: true -- polling at FRED publication cadence;
 *     the in-process live loop lives in this file (no scheduler dep).
 *
 * @see docs/design/TICKET_568_5_1_SIGNAL_DISCOVERY_LAYER3_ALTERNATIVE_DATA_FACTORS.md
 */

import type {
  AlternativeDataRequest,
  AlternativeFactorRow,
} from '../../../../shared/types/signal-discovery';
import type { IAlternativeDataProvider } from './types';
import { DATA_CREDENTIAL_KEYS, DATA_API_BASE_FRED } from '@StratCraft/types';
import { getSecureCredentialService } from '../../secure-credential-service';
import { appLog } from '../../../utils/logger';

// =============================================================================
// Constants
// =============================================================================

/**
 * BYOK plugin namespace. Mirrors alpaca-provider.ts (which uses the same
 * back-test plugin namespace for non-LLM API keys). FRED is a back-test data
 * source from the user's perspective, even though Phase 3 wires it through
 * Signal Discovery first.
 */
const PLUGIN_ID = 'com.stratcraft.back-test-nexus';
const API_KEY_SECRET = DATA_CREDENTIAL_KEYS.FRED_API_KEY;

/**
 * ALFRED vintage-aware endpoint. Returns the series_observations as they
 * were known at `realtime_start`/`realtime_end`. See:
 *   https://fred.stlouisfed.org/docs/api/fred/series_observations.html
 *
 * Key query params:
 *   series_id        -- FRED series code (e.g. 'GDP', 'VIXCLS', 'T10Y2Y')
 *   api_key          -- BYOK
 *   file_type=json
 *   observation_start / observation_end -- inclusive event_time bounds
 *   realtime_start / realtime_end       -- ALFRED knowledge_time bounds.
 *                                          Setting realtime_start = realtime_end
 *                                          returns the as-of snapshot.
 */
const ALFRED_BASE_URL = DATA_API_BASE_FRED;

/**
 * Default HTTP request timeout. FRED responds in well under 5 s in practice;
 * 30 s gives plenty of headroom for cold-cache series without papering over
 * a real outage.
 */
const FRED_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Default live-polling cadence. FRED publishes most macro series on a daily
 * schedule (typically 08:30 ET for major releases). Polling once an hour
 * during US business hours is the conservative shape recommended by the
 * ticket. The cadence is configurable per `startLiveStream()` call so a
 * caller that knows the exact release schedule can override.
 */
const DEFAULT_LIVE_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// =============================================================================
// ALFRED response shape
// =============================================================================

/**
 * Single observation row in the ALFRED `series_observations` JSON response.
 * `realtime_start`/`realtime_end` define the knowledge-time interval over
 * which `value` was the prevailing observation. `value` is a string because
 * ALFRED uses `'.'` to denote a missing observation.
 */
interface AlfredObservation {
  realtime_start: string; // 'YYYY-MM-DD'
  realtime_end: string;   // 'YYYY-MM-DD'
  date: string;           // 'YYYY-MM-DD' -- observation event_time
  value: string;          // numeric string, or '.' for missing
}

interface AlfredResponse {
  observations: AlfredObservation[];
}

// =============================================================================
// Injection seam for tests
// =============================================================================

/**
 * Fetch function injectable for tests. Production uses Node 18+ global
 * `fetch`; tests override with a stub.
 */
export type FredFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface FredProviderOptions {
  /** Override fetch for tests; defaults to global fetch. */
  fetchFn?: FredFetchFn;
  /** Override request timeout (ms). */
  requestTimeoutMs?: number;
  /** Override the secret read; defaults to SecureCredentialService. */
  apiKeyResolver?: () => Promise<string | null>;
}

// =============================================================================
// FredProvider
// =============================================================================

export class FredProvider implements IAlternativeDataProvider {
  readonly id = 'fred';
  readonly name = 'FRED Macro (ALFRED vintage)';
  readonly source = 'macro' as const;
  readonly vintage_supported = true;
  readonly live_streaming_supported = true;

  private readonly fetchFn: FredFetchFn;
  private readonly requestTimeoutMs: number;
  private readonly apiKeyResolver: () => Promise<string | null>;

  constructor(opts: FredProviderOptions = {}) {
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.requestTimeoutMs = opts.requestTimeoutMs ?? FRED_REQUEST_TIMEOUT_MS;
    this.apiKeyResolver = opts.apiKeyResolver ?? defaultApiKeyResolver;
  }

  /**
   * Historical (vintage-aware) fetch. The ALFRED contract:
   *
   *   - When `params.vintage_as_of` is omitted, we ask ALFRED for the full
   *     vintage tape (realtime_start = '1776-07-04' sentinel, realtime_end =
   *     '9999-12-31'). For each event_time `date` we keep the row whose
   *     `realtime_start` is the smallest >= `date` -- i.e. the FIRST
   *     value the investor saw for that event. `knowledge_time` = that
   *     `realtime_start`. This is the honest historical contract.
   *
   *   - When `params.vintage_as_of` IS set, we pass it as both
   *     `realtime_start` and `realtime_end`. ALFRED then returns the
   *     as-of snapshot for that knowledge time. We map `knowledge_time`
   *     to `vintage_as_of` for every emitted row (that IS the
   *     knowledge time by request construction).
   *
   * In both cases `event_time` = ALFRED `date` field.
   *
   * Rows with ALFRED value `'.'` (missing) are dropped, not emitted as
   * NaN -- a missing observation is not the same as a numeric zero, and
   * downstream factor reducers do not have a uniform NaN contract.
   */
  async fetchFactorData(params: AlternativeDataRequest): Promise<AlternativeFactorRow[]> {
    if (params.category !== 'macro') {
      throw new Error(
        `[FredProvider] fetchFactorData: category must be 'macro' (got '${params.category}')`,
      );
    }
    if (!params.factor_name) {
      throw new Error(`[FredProvider] fetchFactorData: factor_name required (FRED series_id)`);
    }
    const apiKey = await this.apiKeyResolver();
    if (!apiKey) {
      throw new Error(
        `[FredProvider] FRED API key not configured. Go to Settings > Credentials ` +
          `and add '${API_KEY_SECRET}' under plugin '${PLUGIN_ID}'. ` +
          `Register for a free key at https://fred.stlouisfed.org/docs/api/api_key.html`,
      );
    }

    const url = this.buildAlfredUrl({
      seriesId: params.factor_name,
      observationStart: toDateOnly(params.start_time),
      observationEnd: toDateOnly(params.end_time),
      vintageAsOf: params.vintage_as_of ? toDateOnly(params.vintage_as_of) : undefined,
      apiKey,
    });

    const resp = await this.fetchWithTimeout(url);
    if (!resp.ok) {
      throw new Error(
        `[FredProvider] ALFRED HTTP ${resp.status} for series '${params.factor_name}': ${resp.statusText}`,
      );
    }
    const body = (await resp.json()) as AlfredResponse;
    if (!body || !Array.isArray(body.observations)) {
      throw new Error(
        `[FredProvider] ALFRED returned malformed payload for series '${params.factor_name}'`,
      );
    }

    return this.mapObservations(body.observations, params);
  }

  /**
   * Start a live polling loop for one (series, optional symbol) pair. On each
   * tick, fetches the latest ALFRED observation and forwards new rows to
   * `onRow`. Returns a stop() function that cancels the timer.
   *
   * "Live" here means "polled at publication cadence", not "tick streaming"
   * -- macro data has no concept of a tick. The contract for downstream
   * consumers (TICKET_196_7_7) is `AlternativeFactorRow` with `knowledge_time`
   * equal to the moment the row first became fetchable. We approximate that
   * with the ALFRED `realtime_start` for newly-appearing observations.
   */
  startLiveStream(
    params: AlternativeDataRequest,
    onRow: (row: AlternativeFactorRow) => void,
    onError: (err: Error) => void,
    pollIntervalMs: number = DEFAULT_LIVE_POLL_INTERVAL_MS,
  ): () => void {
    if (pollIntervalMs < 60_000) {
      // FRED rate-limits at 120 requests/min; even 1/min is conservative
      // here we floor at 60 s to prevent accidental hammering.
      throw new Error(
        `[FredProvider] startLiveStream: pollIntervalMs must be >= 60000 ` +
          `(FRED publication cadence is hourly at fastest)`,
      );
    }

    let lastSeenEventTime: string | null = null;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const rows = await this.fetchFactorData({
          ...params,
          // Live mode -- always ask for the latest knowledge snapshot.
          vintage_as_of: undefined,
        });
        for (const row of rows) {
          if (lastSeenEventTime !== null && row.event_time <= lastSeenEventTime) {
            continue;
          }
          onRow(row);
        }
        if (rows.length > 0) {
          lastSeenEventTime = rows[rows.length - 1].event_time;
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    // Fire once immediately so the consumer gets a baseline snapshot.
    void tick();
    const timer = setInterval(() => void tick(), pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildAlfredUrl(args: {
    seriesId: string;
    observationStart: string;
    observationEnd: string;
    vintageAsOf?: string;
    apiKey: string;
  }): string {
    const qs = new URLSearchParams({
      series_id: args.seriesId,
      api_key: args.apiKey,
      file_type: 'json',
      observation_start: args.observationStart,
      observation_end: args.observationEnd,
    });
    if (args.vintageAsOf) {
      qs.set('realtime_start', args.vintageAsOf);
      qs.set('realtime_end', args.vintageAsOf);
    } else {
      // Full vintage tape -- ALFRED's documented sentinels for "all known
      // revisions of every observation in the requested event window".
      qs.set('realtime_start', '1776-07-04');
      qs.set('realtime_end', '9999-12-31');
    }
    return `${ALFRED_BASE_URL}?${qs.toString()}`;
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchFn(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Map ALFRED observations to AlternativeFactorRow. Behavior depends on
   * whether the caller pinned `vintage_as_of`:
   *
   * - `vintage_as_of` set: the response is already an as-of snapshot. One
   *   row per ALFRED observation, `knowledge_time = vintage_as_of`.
   *
   * - `vintage_as_of` unset: the response is the full vintage tape. We
   *   collapse to FIRST-RELEASE: for each `date`, keep the row with the
   *   smallest `realtime_start`. That `realtime_start` IS the
   *   knowledge_time (the day the value first became knowable).
   *
   * Sorted ASC by `event_time` to honor the IAlternativeDataProvider
   * contract.
   */
  private mapObservations(
    observations: AlfredObservation[],
    params: AlternativeDataRequest,
  ): AlternativeFactorRow[] {
    const firstRelease = new Map<string, AlfredObservation>();

    if (params.vintage_as_of) {
      // As-of snapshot: trust ALFRED's filtering, emit every numeric row.
      for (const obs of observations) {
        if (obs.value === '.' || obs.value === '') continue;
        firstRelease.set(obs.date, obs);
      }
    } else {
      // Full tape: keep the FIRST `realtime_start` per `date`.
      for (const obs of observations) {
        if (obs.value === '.' || obs.value === '') continue;
        const existing = firstRelease.get(obs.date);
        if (!existing || obs.realtime_start < existing.realtime_start) {
          firstRelease.set(obs.date, obs);
        }
      }
    }

    const rows: AlternativeFactorRow[] = [];
    for (const obs of firstRelease.values()) {
      const value = Number(obs.value);
      if (!Number.isFinite(value)) continue;
      const knowledgeDate = params.vintage_as_of
        ? toDateOnly(params.vintage_as_of)
        : obs.realtime_start;
      rows.push({
        category: 'macro',
        factor_name: params.factor_name,
        symbol: params.symbol,
        // event_time + knowledge_time emitted as midnight UTC for date-only
        // values; downstream join keys are bar timestamps which already
        // carry a time-of-day component, so the contract is
        // `knowledge_time <= bar_time` either way.
        event_time: `${obs.date}T00:00:00Z`,
        knowledge_time: `${knowledgeDate}T00:00:00Z`,
        value,
        vintage_id: `${obs.realtime_start}_${obs.realtime_end}`,
        source_provider: this.id,
      });
    }
    rows.sort((a, b) => (a.event_time < b.event_time ? -1 : a.event_time > b.event_time ? 1 : 0));
    return rows;
  }
}

// =============================================================================
// Default API-key resolver
// =============================================================================

async function defaultApiKeyResolver(): Promise<string | null> {
  try {
    const credService = getSecureCredentialService();
    const result = await credService.getSecret(PLUGIN_ID, API_KEY_SECRET);
    return result.success && result.value ? result.value : null;
  } catch (err) {
    appLog.error('[FredProvider] credential read failed:', err);
    return null;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Reduce an ISO8601 timestamp to its date-only (`YYYY-MM-DD`) component.
 * ALFRED only accepts date-resolution timestamps in its observation/realtime
 * query parameters; passing a full ISO string returns HTTP 400.
 */
function toDateOnly(iso: string): string {
  const idx = iso.indexOf('T');
  return idx === -1 ? iso : iso.slice(0, idx);
}
