/**
 * MarketauxProvider Unit + Integration Tests
 *
 * TICKET_568_5_1_a + TICKET_494: full coverage of the Marketaux News
 * Sentiment provider. Modeled on `fred-provider.test.ts`; the same fetch-
 * injection seam + Electron mock + Response factory.
 *
 * Test surface:
 *   - Provider contract (id, source, vintage_supported, live_streaming).
 *   - fetchFactorData happy path: maps entity sentiment scores onto
 *     AlternativeFactorRow with event_time == knowledge_time ==
 *     published_at.
 *   - fetchFactorData filters to the requested symbol; ignores entities
 *     for other symbols even if they appear in the same article.
 *   - fetchFactorData drops entities without a numeric sentiment_score
 *     (no fabricated zeros -- absence != neutral).
 *   - URL parameter shape (api_token, symbols, filter_entities,
 *     published_after / before).
 *   - Error surfaces: missing api key, HTTP error, malformed payload,
 *     API error envelope, missing symbol on the request.
 *   - startLiveStream: pollInterval floor, dedup by article uuid,
 *     watermark advance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// MarketauxProvider transitively imports the logger which dereferences
// `app.isPackaged` at module load. Mock electron so the tests do not need
// the Electron runtime.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: (b: Buffer) => b.toString('utf-8'),
    encryptString: (s: string) => Buffer.from(s),
  },
}));

import { MarketauxProvider } from '../marketaux-provider';
import type { AlternativeDataRequest } from '../../../../../shared/types/signal-discovery';

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Realistic Marketaux response: two AAPL-tagged articles plus one article
 * that mentions GOOG but not AAPL (must be ignored when the request
 * filters on AAPL).
 */
const MARKETAUX_AAPL_RESPONSE = {
  data: [
    {
      uuid: 'article-1',
      title: 'Apple beats earnings expectations',
      published_at: '2026-05-20T13:30:00Z',
      entities: [
        { symbol: 'AAPL', sentiment_score: 0.72, match_score: 0.95 },
      ],
    },
    {
      uuid: 'article-2',
      title: 'Supply chain risks loom for Apple suppliers',
      published_at: '2026-05-20T16:45:00Z',
      entities: [
        { symbol: 'AAPL', sentiment_score: -0.41, match_score: 0.88 },
        { symbol: 'TSM', sentiment_score: -0.30, match_score: 0.50 },
      ],
    },
    {
      uuid: 'article-3',
      title: 'Alphabet announces AI partnership',
      published_at: '2026-05-20T18:00:00Z',
      entities: [
        { symbol: 'GOOG', sentiment_score: 0.55, match_score: 0.92 },
      ],
    },
  ],
};

/**
 * Response with an entity that has a null sentiment_score. The provider
 * MUST drop that row (no fabricated zero); the second entity in the same
 * article still emits a row.
 */
const MARKETAUX_NULL_SCORE_RESPONSE = {
  data: [
    {
      uuid: 'article-null-score',
      published_at: '2026-05-20T10:00:00Z',
      entities: [
        { symbol: 'AAPL', sentiment_score: null, match_score: 0.40 },
        { symbol: 'AAPL', sentiment_score: 0.12, match_score: 0.91 },
      ],
    },
  ],
};

/**
 * Response with an explicit error envelope. Marketaux returns this when
 * the API key is invalid or out of quota.
 */
const MARKETAUX_ERROR_RESPONSE = {
  error: {
    code: 'invalid_api_token',
    message: 'The provided API token is invalid.',
  },
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

function makeProvider(opts?: {
  fetchFn?: ReturnType<typeof captureFetch>['fetchFn'];
  apiKey?: string | null;
}) {
  // `apiKey: null` explicitly tests the missing-key code path; a missing
  // `apiKey` property defaults to 'TEST_KEY' so the happy path tests do
  // not need to know about the resolver.
  const apiKey = opts && 'apiKey' in opts ? opts.apiKey ?? null : 'TEST_KEY';
  return new MarketauxProvider({
    fetchFn: opts?.fetchFn,
    apiKeyResolver: async () => apiKey,
  });
}

const BASE_REQUEST: AlternativeDataRequest = {
  symbol: 'AAPL',
  category: 'sentiment',
  factor_name: 'news_score',
  start_time: '2026-05-20T00:00:00Z',
  end_time: '2026-05-21T00:00:00Z',
};

// =============================================================================
// Contract surface
// =============================================================================

describe('MarketauxProvider contract', () => {
  it('declares the four contract fields per IAlternativeDataProvider', () => {
    const p = makeProvider();
    expect(p.id).toBe('marketaux');
    expect(p.source).toBe('sentiment');
    expect(p.vintage_supported).toBe(false);
    expect(p.live_streaming_supported).toBe(true);
  });
});

// =============================================================================
// fetchFactorData
// =============================================================================

describe('MarketauxProvider.fetchFactorData', () => {
  it('maps articles to rows for the requested symbol, drops other entities', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });

    const rows = await p.fetchFactorData(BASE_REQUEST);

    // article-1 (1 AAPL entity) + article-2 (1 AAPL entity, TSM dropped)
    // article-3 (GOOG only) is fully dropped.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.symbol)).toEqual(['AAPL', 'AAPL']);
    expect(rows.map((r) => r.value)).toEqual([0.72, -0.41]);
  });

  it('sets event_time == knowledge_time == published_at (Marketaux is pre-scored)', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });

    const rows = await p.fetchFactorData(BASE_REQUEST);

    expect(rows[0].event_time).toBe('2026-05-20T13:30:00Z');
    expect(rows[0].knowledge_time).toBe('2026-05-20T13:30:00Z');
    expect(rows[0].knowledge_time).toBe(rows[0].event_time);
  });

  it('returns rows sorted ASC by event_time', async () => {
    // Build an out-of-order response (server returns desc-by-default).
    const desc = {
      data: [
        ...MARKETAUX_AAPL_RESPONSE.data.filter((a) => a.uuid !== 'article-3'),
      ].reverse(),
    };
    const { fetchFn } = captureFetch(desc);
    const p = makeProvider({ fetchFn });

    const rows = await p.fetchFactorData(BASE_REQUEST);

    // String compare on ISO8601 is lexicographic-correct.
    expect(rows[0].event_time < rows[1].event_time).toBe(true);
  });

  it('drops entities without a numeric sentiment_score (no fabricated zero)', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_NULL_SCORE_RESPONSE);
    const p = makeProvider({ fetchFn });

    const rows = await p.fetchFactorData(BASE_REQUEST);

    // Two AAPL entities in one article: one with null score, one with 0.12.
    // Only the numeric one survives.
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(0.12);
  });

  it('builds the URL with the documented Marketaux query params', async () => {
    const { fetchFn, captured } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });

    await p.fetchFactorData(BASE_REQUEST);

    expect(captured).toHaveLength(1);
    const url = new URL(captured[0].url);
    expect(url.origin + url.pathname).toBe('https://api.marketaux.com/v1/news/all');
    expect(url.searchParams.get('api_token')).toBe('TEST_KEY');
    expect(url.searchParams.get('symbols')).toBe('AAPL');
    expect(url.searchParams.get('filter_entities')).toBe('true');
    expect(url.searchParams.get('published_after')).toBe('2026-05-20T00:00:00Z');
    expect(url.searchParams.get('published_before')).toBe('2026-05-21T00:00:00Z');
    expect(url.searchParams.get('sort')).toBe('published_at');
  });

  it('stamps source_provider="marketaux" and category="sentiment" on every row', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });

    const rows = await p.fetchFactorData(BASE_REQUEST);

    for (const r of rows) {
      expect(r.source_provider).toBe('marketaux');
      expect(r.category).toBe('sentiment');
    }
  });

  it('puts the article uuid into vintage_id for downstream dedup', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });

    const rows = await p.fetchFactorData(BASE_REQUEST);

    expect(rows.map((r) => r.vintage_id).sort()).toEqual(['article-1', 'article-2']);
  });
});

// =============================================================================
// Error surfaces
// =============================================================================

describe('MarketauxProvider error surfaces', () => {
  it('throws when api key is not configured', async () => {
    const p = makeProvider({ apiKey: null });

    await expect(p.fetchFactorData(BASE_REQUEST)).rejects.toThrow(/api key not configured/i);
  });

  it('throws when category is not sentiment', async () => {
    const p = makeProvider();

    await expect(
      p.fetchFactorData({ ...BASE_REQUEST, category: 'macro' }),
    ).rejects.toThrow(/category must be 'sentiment'/);
  });

  it('throws when symbol is missing (Marketaux is per-symbol attribution)', async () => {
    const p = makeProvider();

    await expect(
      p.fetchFactorData({ ...BASE_REQUEST, symbol: undefined }),
    ).rejects.toThrow(/symbol is required/i);
  });

  it('throws when factor_name is missing', async () => {
    const p = makeProvider();

    await expect(
      p.fetchFactorData({ ...BASE_REQUEST, factor_name: '' }),
    ).rejects.toThrow(/factor_name required/);
  });

  it('throws on HTTP error status', async () => {
    const { fetchFn } = captureFetch({}, 401, 'Unauthorized');
    const p = makeProvider({ fetchFn });

    await expect(p.fetchFactorData(BASE_REQUEST)).rejects.toThrow(/HTTP 401/);
  });

  it('surfaces Marketaux API error envelope', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_ERROR_RESPONSE);
    const p = makeProvider({ fetchFn });

    await expect(p.fetchFactorData(BASE_REQUEST)).rejects.toThrow(/invalid_api_token/);
  });

  it('throws on malformed payload (no data array)', async () => {
    const { fetchFn } = captureFetch({ meta: { found: 0 } });
    const p = makeProvider({ fetchFn });

    await expect(p.fetchFactorData(BASE_REQUEST)).rejects.toThrow(/malformed payload/);
  });
});

// =============================================================================
// startLiveStream
// =============================================================================

describe('MarketauxProvider.startLiveStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('throws when pollIntervalMs is below the 5-minute floor', () => {
    const p = makeProvider();
    const onRow = vi.fn();
    const onError = vi.fn();

    expect(() =>
      p.startLiveStream(BASE_REQUEST, onRow, onError, 60_000),
    ).toThrow(/pollIntervalMs must be >= 300000/);
  });

  it('dedups by article uuid across ticks (vintage_id is the uuid)', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });
    const seen: string[] = [];
    const onRow = (row: { vintage_id?: string }) => seen.push(row.vintage_id ?? '');

    const stop = p.startLiveStream(BASE_REQUEST, onRow, () => {}, 5 * 60 * 1000);
    // First tick fires immediately; flush it.
    await vi.runOnlyPendingTimersAsync();
    expect(seen).toEqual(['article-1', 'article-2']);

    // Advance one cadence and let the second tick fire with the SAME
    // mocked response. Dedup should suppress all rows.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(seen).toEqual(['article-1', 'article-2']);

    stop();
  });

  it('forwards errors via onError without throwing', async () => {
    // Use real timers for this test -- we only need the immediate tick to
    // fire, and the fake-timer queue interactions with async rejection
    // chains are noisy. Skip the setInterval scheduling concern entirely
    // by calling stop() before the timer can fire (real 5min interval).
    vi.useRealTimers();
    try {
      const fetchFn = vi.fn<[url: string], Promise<Response>>(async () => {
        throw new Error('network down');
      });
      const p = makeProvider({ fetchFn });
      const errs: Error[] = [];

      const stop = p.startLiveStream(BASE_REQUEST, () => {}, (err) => errs.push(err), 5 * 60 * 1000);
      // Yield to the microtask queue so the immediate tick's async chain
      // settles. Two awaits cover: fetchFn -> tick's catch -> onError.
      await new Promise((resolve) => setImmediate(resolve));

      expect(errs).toHaveLength(1);
      expect(errs[0].message).toMatch(/network down/);
      stop();
    } finally {
      vi.useFakeTimers();
    }
  });

  it('stop() prevents subsequent ticks from firing', async () => {
    const { fetchFn } = captureFetch(MARKETAUX_AAPL_RESPONSE);
    const p = makeProvider({ fetchFn });

    const stop = p.startLiveStream(BASE_REQUEST, () => {}, () => {}, 5 * 60 * 1000);
    await vi.runOnlyPendingTimersAsync();
    const initialCalls = fetchFn.mock.calls.length;
    stop();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fetchFn.mock.calls.length).toBe(initialCalls);
  });
});
