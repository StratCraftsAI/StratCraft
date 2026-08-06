/**
 * FredProvider Unit + Integration Tests
 *
 * TICKET_568_5_1 Phase 3 + TICKET_494: full coverage of the FRED Macro
 * provider, with particular emphasis on the ALFRED vintage contract
 * (the look-ahead-bias risk that gates Layer 3 backtest reopening).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// FredProvider transitively imports the logger which dereferences `app.isPackaged`
// at module load. Mock electron so the tests do not need the Electron runtime.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: (b: Buffer) => b.toString('utf-8'), encryptString: (s: string) => Buffer.from(s) },
}));

import { FredProvider } from '../fred-provider';
import type { AlternativeDataRequest } from '../../../../../shared/types/signal-discovery';

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Realistic ALFRED-style vintage tape for FRED series 'GDP'.
 *
 * Two event_times, each with revision sequence:
 *   2026-Q1 (event_date '2026-03-31'):
 *     - First-release on 2026-04-28  -> 27000.0
 *     - 1-month revision 2026-05-29  -> 27050.5
 *     - Annual benchmark 2027-07-29  -> 27123.4 (latest)
 *   2026-Q2 (event_date '2026-06-30'):
 *     - First-release on 2026-07-30  -> 27500.0
 *     - 1-month revision 2026-08-29  -> 27510.0
 *
 * realtime_end of the latest row for an event_time is the open-ended
 * sentinel '9999-12-31' (ALFRED convention).
 */
const ALFRED_FULL_TAPE_GDP = {
  observations: [
    { realtime_start: '2026-04-28', realtime_end: '2026-05-28', date: '2026-03-31', value: '27000.0' },
    { realtime_start: '2026-05-29', realtime_end: '2027-07-28', date: '2026-03-31', value: '27050.5' },
    { realtime_start: '2027-07-29', realtime_end: '9999-12-31', date: '2026-03-31', value: '27123.4' },
    { realtime_start: '2026-07-30', realtime_end: '2026-08-28', date: '2026-06-30', value: '27500.0' },
    { realtime_start: '2026-08-29', realtime_end: '9999-12-31', date: '2026-06-30', value: '27510.0' },
  ],
};

/**
 * ALFRED snapshot for vintage_as_of='2026-05-15': the as-of view sees the
 * FIRST-release row for 2026-Q1 (27000.0); the 2026-05-29 revision has not
 * yet been published, and 2026-Q2 does not exist at this knowledge time.
 */
const ALFRED_ASOF_2026_05_15 = {
  observations: [
    { realtime_start: '2026-04-28', realtime_end: '2026-05-28', date: '2026-03-31', value: '27000.0' },
  ],
};

/**
 * Tape with a missing observation (ALFRED uses '.' for missing).
 */
const ALFRED_TAPE_WITH_MISSING = {
  observations: [
    { realtime_start: '2026-04-28', realtime_end: '9999-12-31', date: '2026-03-31', value: '27000.0' },
    { realtime_start: '2026-05-29', realtime_end: '9999-12-31', date: '2026-04-30', value: '.' },
    { realtime_start: '2026-06-29', realtime_end: '9999-12-31', date: '2026-05-31', value: '28000.0' },
  ],
};

// =============================================================================
// Helpers
// =============================================================================

function makeResponse(body: unknown, status: number = 200, statusText: string = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CapturedRequest {
  url: string;
}

function captureFetch(responseBody: unknown, status: number = 200, statusText: string = 'OK') {
  const captured: CapturedRequest[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    captured.push({ url });
    return makeResponse(responseBody, status, statusText);
  });
  return { fetchFn, captured };
}

// =============================================================================
// fetchFactorData
// =============================================================================

describe('FredProvider.fetchFactorData', () => {
  let baseRequest: AlternativeDataRequest;
  beforeEach(() => {
    baseRequest = {
      category: 'macro',
      factor_name: 'GDP',
      start_time: '2026-01-01',
      end_time: '2026-12-31',
    };
  });

  it('rejects non-macro category', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    await expect(
      provider.fetchFactorData({ ...baseRequest, category: 'sentiment' as never }),
    ).rejects.toThrow(/category must be 'macro'/);
  });

  it('rejects missing factor_name', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    await expect(
      provider.fetchFactorData({ ...baseRequest, factor_name: '' }),
    ).rejects.toThrow(/factor_name required/);
  });

  it('rejects when API key is missing', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => null });
    await expect(provider.fetchFactorData(baseRequest)).rejects.toThrow(/FRED API key not configured/);
  });

  it('propagates HTTP errors from ALFRED', async () => {
    const { fetchFn } = captureFetch({}, 401, 'Unauthorized');
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'bad-key' });
    await expect(provider.fetchFactorData(baseRequest)).rejects.toThrow(/ALFRED HTTP 401/);
  });

  it('rejects malformed ALFRED payloads (no observations array)', async () => {
    const { fetchFn } = captureFetch({ message: 'oops' });
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    await expect(provider.fetchFactorData(baseRequest)).rejects.toThrow(/malformed payload/);
  });

  it('hits the ALFRED endpoint with realtime sentinels when vintage_as_of is unset', async () => {
    const { fetchFn, captured } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    await provider.fetchFactorData(baseRequest);
    expect(captured).toHaveLength(1);
    const url = new URL(captured[0].url);
    expect(url.origin + url.pathname).toBe('https://api.stlouisfed.org/fred/series/observations');
    expect(url.searchParams.get('series_id')).toBe('GDP');
    expect(url.searchParams.get('api_key')).toBe('k');
    expect(url.searchParams.get('file_type')).toBe('json');
    expect(url.searchParams.get('observation_start')).toBe('2026-01-01');
    expect(url.searchParams.get('observation_end')).toBe('2026-12-31');
    expect(url.searchParams.get('realtime_start')).toBe('1776-07-04');
    expect(url.searchParams.get('realtime_end')).toBe('9999-12-31');
  });

  it('strips T<time> from ISO timestamps when forwarding to ALFRED', async () => {
    const { fetchFn, captured } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    await provider.fetchFactorData({
      ...baseRequest,
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-12-31T23:59:59Z',
    });
    const url = new URL(captured[0].url);
    expect(url.searchParams.get('observation_start')).toBe('2026-01-01');
    expect(url.searchParams.get('observation_end')).toBe('2026-12-31');
  });

  /**
   * The look-ahead-bias test. When the caller does not pin
   * `vintage_as_of`, ALFRED returns the full revision tape; the provider
   * must collapse to FIRST-RELEASE per event_time -- never the latest
   * revision (which is what a naive FRED endpoint would silently return).
   */
  it('collapses full vintage tape to FIRST-release per event_time', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows = await provider.fetchFactorData(baseRequest);

    expect(rows).toHaveLength(2);
    // 2026-Q1: first-release value (27000.0), NOT 27050.5 or 27123.4
    expect(rows[0]).toMatchObject({
      event_time: '2026-03-31T00:00:00Z',
      knowledge_time: '2026-04-28T00:00:00Z',
      value: 27000.0,
      vintage_id: '2026-04-28_2026-05-28',
      source_provider: 'fred',
    });
    // 2026-Q2: first-release value (27500.0), NOT 27510.0
    expect(rows[1]).toMatchObject({
      event_time: '2026-06-30T00:00:00Z',
      knowledge_time: '2026-07-30T00:00:00Z',
      value: 27500.0,
    });
  });

  it('honors knowledge_time >= event_time invariant on every row', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows = await provider.fetchFactorData(baseRequest);
    for (const row of rows) {
      expect(row.knowledge_time >= row.event_time).toBe(true);
    }
  });

  it('demonstrates the FRED publication-lag invariant (GDP first-release lags quarter-end)', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows = await provider.fetchFactorData(baseRequest);
    // 2026-Q1 ends 2026-03-31; ALFRED first-release was 2026-04-28 -> 28 days lag.
    const q1 = rows.find((r) => r.event_time === '2026-03-31T00:00:00Z')!;
    const lagDays = (Date.parse(q1.knowledge_time) - Date.parse(q1.event_time)) / 86400000;
    expect(lagDays).toBeGreaterThanOrEqual(20); // first-release lag is ~28 days
    expect(lagDays).toBeLessThan(60); // not the year-late benchmark revision
  });

  it('passes vintage_as_of through as both realtime_start and realtime_end', async () => {
    const { fetchFn, captured } = captureFetch(ALFRED_ASOF_2026_05_15);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    await provider.fetchFactorData({ ...baseRequest, vintage_as_of: '2026-05-15' });
    const url = new URL(captured[0].url);
    expect(url.searchParams.get('realtime_start')).toBe('2026-05-15');
    expect(url.searchParams.get('realtime_end')).toBe('2026-05-15');
  });

  it('for vintage_as_of, sets knowledge_time = vintage_as_of on every emitted row', async () => {
    const { fetchFn } = captureFetch(ALFRED_ASOF_2026_05_15);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows = await provider.fetchFactorData({ ...baseRequest, vintage_as_of: '2026-05-15' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_time: '2026-03-31T00:00:00Z',
      knowledge_time: '2026-05-15T00:00:00Z',
      value: 27000.0,
    });
  });

  it('drops missing observations (ALFRED `.` sentinel)', async () => {
    const { fetchFn } = captureFetch(ALFRED_TAPE_WITH_MISSING);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows = await provider.fetchFactorData(baseRequest);
    const dates = rows.map((r) => r.event_time).sort();
    expect(dates).toEqual(['2026-03-31T00:00:00Z', '2026-05-31T00:00:00Z']);
  });

  it('emits rows sorted ascending by event_time', async () => {
    // Shuffled input from ALFRED -- the provider must sort.
    const shuffled = {
      observations: [
        { realtime_start: '2026-07-30', realtime_end: '9999-12-31', date: '2026-06-30', value: '27500.0' },
        { realtime_start: '2026-04-28', realtime_end: '9999-12-31', date: '2026-03-31', value: '27000.0' },
      ],
    };
    const { fetchFn } = captureFetch(shuffled);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows = await provider.fetchFactorData(baseRequest);
    expect(rows.map((r) => r.event_time)).toEqual([
      '2026-03-31T00:00:00Z',
      '2026-06-30T00:00:00Z',
    ]);
  });
});

// =============================================================================
// Provider contract
// =============================================================================

describe('FredProvider contract', () => {
  it('declares vintage_supported=true and live_streaming_supported=true', () => {
    const provider = new FredProvider();
    expect(provider.id).toBe('fred');
    expect(provider.source).toBe('macro');
    expect(provider.vintage_supported).toBe(true);
    expect(provider.live_streaming_supported).toBe(true);
  });
});

// =============================================================================
// startLiveStream
// =============================================================================

describe('FredProvider.startLiveStream', () => {
  it('rejects pollIntervalMs below the 60 s floor', () => {
    const provider = new FredProvider();
    expect(() =>
      provider.startLiveStream(
        { category: 'macro', factor_name: 'GDP', start_time: '2026-01-01', end_time: '2026-12-31' },
        () => undefined,
        () => undefined,
        30_000,
      ),
    ).toThrow(/pollIntervalMs must be >= 60000/);
  });

  it('emits an initial baseline snapshot synchronously after construction', async () => {
    const { fetchFn } = captureFetch(ALFRED_FULL_TAPE_GDP);
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const rows: unknown[] = [];
    const stop = provider.startLiveStream(
      { category: 'macro', factor_name: 'GDP', start_time: '2026-01-01', end_time: '2026-12-31' },
      (row) => rows.push(row),
      () => undefined,
      60_000,
    );
    // Allow the synchronous-immediate tick to flush.
    await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('forwards errors via onError, not by throwing', async () => {
    const fetchFn = vi.fn(async () => makeResponse({}, 503, 'Unavailable'));
    const provider = new FredProvider({ fetchFn, apiKeyResolver: async () => 'k' });
    const errs: Error[] = [];
    const stop = provider.startLiveStream(
      { category: 'macro', factor_name: 'GDP', start_time: '2026-01-01', end_time: '2026-12-31' },
      () => undefined,
      (e) => errs.push(e),
      60_000,
    );
    await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/ALFRED HTTP 503/);
  });
});
