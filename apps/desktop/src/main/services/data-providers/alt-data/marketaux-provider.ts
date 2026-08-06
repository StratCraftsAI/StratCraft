/**
 * Marketaux News Sentiment Data Provider
 *
 * TICKET_568_5_1_a: First concrete `sentiment` IAlternativeDataProvider.
 * Sources stock-tagged news with pre-computed sentiment scores from the
 * Marketaux API (https://api.marketaux.com/v1/news/all).
 *
 * Why Marketaux as the first sentiment provider:
 *   - Pre-scored: sentiment is computed BEFORE the API returns, so the
 *     `knowledge_time` equals the article `published_at` -- there is no
 *     additional scoring lag we need to model (the lag is folded into the
 *     publication timestamp itself).
 *   - Honest PIT: every row carries an unambiguous `published_at`. We
 *     never need to estimate a "when did this become knowable" timestamp.
 *   - Stock entity extraction is done by Marketaux. Each article carries
 *     an `entities[]` array with `symbol` + per-entity `sentiment_score`
 *     in [-1, +1], so we can emit one row per (article, matched-symbol)
 *     pair without doing NLP locally.
 *   - Free tier exists (100 req/day, 3 articles per response) -- enough
 *     for a single-user desktop tool's polling cadence at hour-level
 *     resolution. TOS allows displaying sentiment scores to the
 *     authenticated end user inside the app (no redistribution beyond
 *     that). The BYOK key is per-user, so each user respects their own
 *     quota.
 *
 * Auth: BYOK pass-through per TICKET_435. Reads `marketaux.apiKey` from
 * the SecureCredentialService under the back-test plugin namespace --
 * same pattern as `fred.apiKey`. Free tier requires registration at
 * https://www.marketaux.com/; the key is never persisted server-side.
 *
 * Provider contract:
 *   source: 'sentiment'
 *   vintage_supported: false  -- Marketaux replaces deleted/edited
 *     articles silently; we have no archive to reconstruct what an
 *     investor "would have seen" at a past knowledge_time. The Phase 1
 *     persistence guard refuses backtest registration on the back of
 *     this flag (TICKET_568_5_1 D1) -- this is the correct behavior, NOT
 *     a bug. Live-streaming consumers (TICKET_196_7_7) remain usable.
 *   live_streaming_supported: true -- polling at a rate-limit-aware
 *     cadence (default 1h; 5min minimum floor) emits new articles as
 *     they appear, deduplicated by article `uuid`.
 *
 * Row emission:
 *   One row per (article uuid, matched-symbol-entity) pair. `value` is
 *   the per-entity `sentiment_score` (Marketaux's pre-computed score in
 *   [-1, +1]); `event_time = knowledge_time = published_at`. Articles
 *   without a numeric sentiment_score are dropped (we do not fabricate
 *   zeros -- absence of a score is not "neutral").
 *
 * @see docs/design/TICKET_568_5_1_a_SIGNAL_DISCOVERY_LAYER3_SENTIMENT_PROVIDER.md
 */

import type {
  AlternativeDataRequest,
  AlternativeFactorRow,
} from '../../../../shared/types/signal-discovery';
import type { IAlternativeDataProvider } from './types';
import { DATA_CREDENTIAL_KEYS, DATA_API_BASE_MARKETAUX } from '@StratCraft/types';
import { getSecureCredentialService } from '../../secure-credential-service';
import { appLog } from '../../../utils/logger';

// =============================================================================
// Constants
// =============================================================================

/**
 * BYOK plugin namespace. Mirrors FRED -- alt-data API keys live alongside
 * back-test data-source keys (the user resolves them once in Credentials
 * Settings; Signal Discovery and the back-test path share the namespace).
 */
const PLUGIN_ID = 'com.stratcraft.back-test-nexus';
const API_KEY_SECRET = DATA_CREDENTIAL_KEYS.MARKETAUX_API_KEY;

/**
 * Marketaux `news/all` endpoint. Returns paginated news with entity-level
 * sentiment scoring already applied. Filtering is via query params; the
 * shape is documented at https://www.marketaux.com/documentation.
 */
const MARKETAUX_BASE_URL = DATA_API_BASE_MARKETAUX;

/**
 * Default HTTP request timeout. Marketaux typically responds within 1-2 s;
 * 30 s headroom matches the FRED provider's posture.
 */
const MARKETAUX_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Default live-polling cadence (1 hour). The user can override per
 * `startLiveStream()` call, but the floor is enforced at
 * `MIN_LIVE_POLL_INTERVAL_MS` to protect the free-tier daily quota:
 * 100 req/day = roughly one request every 14.4 minutes if spread evenly,
 * so the 5-minute floor is intentionally generous for paid keys while
 * still preventing accidental quota exhaustion in dev.
 */
const DEFAULT_LIVE_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MIN_LIVE_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Marketaux page size cap. The free tier caps a single response at 3
 * articles; paid tiers raise this to 100. We always request the maximum
 * (100) and let the server clamp -- a paid key gets more data per request
 * without code changes.
 */
const MARKETAUX_PAGE_SIZE = 100;

// =============================================================================
// Marketaux response shape
// =============================================================================

/**
 * Single matched-entity record inside a Marketaux article. Marketaux runs
 * stock entity extraction + per-entity sentiment scoring; the `symbol`
 * field is the ticker the score applies to. `match_score` is the entity
 * extractor's confidence (independent from sentiment) -- we surface it
 * via `vintage_id` for downstream filtering if needed but do not gate on
 * it here (the ticket scope is "consume already-scored series", not
 * "tune the extractor").
 */
interface MarketauxEntity {
  symbol: string;
  /** Sentiment score in [-1, +1]; absent on entities Marketaux did not
   * score (rare, but happens when the article body is too short). */
  sentiment_score?: number | null;
  /** Entity-extraction confidence in [0, 1]. */
  match_score?: number;
}

interface MarketauxArticle {
  /** Stable article identifier; used for dedup across polling ticks. */
  uuid: string;
  /** Article title (not emitted as a factor row, but useful for logging). */
  title?: string;
  /** ISO8601 UTC. This IS the event_time AND the knowledge_time. */
  published_at: string;
  /** Per-entity sentiment scores. Empty for articles with no matched
   * stock entities (filtered to empty by the request's `symbols` param,
   * but the server may still return general-market articles when the
   * `symbols` filter is omitted). */
  entities?: MarketauxEntity[];
}

interface MarketauxResponse {
  data: MarketauxArticle[];
  meta?: {
    found?: number;
    returned?: number;
    limit?: number;
    page?: number;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

// =============================================================================
// Injection seam for tests
// =============================================================================

/**
 * Fetch function injectable for tests. Production uses Node 18+ global
 * `fetch`; tests override with a stub. Mirrors FredFetchFn.
 */
export type MarketauxFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface MarketauxProviderOptions {
  /** Override fetch for tests; defaults to global fetch. */
  fetchFn?: MarketauxFetchFn;
  /** Override request timeout (ms). */
  requestTimeoutMs?: number;
  /** Override the secret read; defaults to SecureCredentialService. */
  apiKeyResolver?: () => Promise<string | null>;
}

// =============================================================================
// MarketauxProvider
// =============================================================================

export class MarketauxProvider implements IAlternativeDataProvider {
  readonly id = 'marketaux';
  readonly name = 'Marketaux News Sentiment';
  readonly source = 'sentiment' as const;
  // No vintage archive -- past articles can be edited/deleted silently.
  // Backtest registration refused by the persistence guard. Correct
  // behavior, not a workaround.
  readonly vintage_supported = false;
  readonly live_streaming_supported = true;

  private readonly fetchFn: MarketauxFetchFn;
  private readonly requestTimeoutMs: number;
  private readonly apiKeyResolver: () => Promise<string | null>;

  constructor(opts: MarketauxProviderOptions = {}) {
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.requestTimeoutMs = opts.requestTimeoutMs ?? MARKETAUX_REQUEST_TIMEOUT_MS;
    this.apiKeyResolver = opts.apiKeyResolver ?? defaultApiKeyResolver;
  }

  /**
   * Historical fetch. The Marketaux contract:
   *
   *   - Articles are filtered by `published_after` / `published_before`
   *     (mapped from request's `start_time` / `end_time`).
   *   - When `params.symbol` is set, we filter on the Marketaux
   *     `symbols` param so the response only carries articles tagged
   *     with that ticker. The matched entity inside each article carries
   *     the score we emit.
   *   - When `params.symbol` is unset, we DO NOT broaden to "all
   *     articles" -- the ticket contract for sentiment is per-symbol
   *     attribution. Caller MUST supply a symbol. (Layer 3 market-wide
   *     sentiment would be a separate provider -- e.g. VIX is already
   *     covered by FRED.)
   *   - `vintage_as_of` is ignored because `vintage_supported: false`.
   *     The persistence guard ensures backtest never requests one.
   *
   * Rows without a numeric `sentiment_score` on the matched entity are
   * dropped. We do not emit a fabricated zero -- absence of a score is
   * not the same as neutral sentiment.
   */
  async fetchFactorData(params: AlternativeDataRequest): Promise<AlternativeFactorRow[]> {
    if (params.category !== 'sentiment') {
      throw new Error(
        `[MarketauxProvider] fetchFactorData: category must be 'sentiment' ` +
          `(got '${params.category}')`,
      );
    }
    if (!params.symbol) {
      throw new Error(
        `[MarketauxProvider] fetchFactorData: symbol is required ` +
          `(Marketaux sentiment is per-symbol attribution; market-wide ` +
          `sentiment belongs to a separate provider)`,
      );
    }
    if (!params.factor_name) {
      throw new Error(
        `[MarketauxProvider] fetchFactorData: factor_name required ` +
          `(e.g. 'news_score' to surface per-article sentiment)`,
      );
    }
    const apiKey = await this.apiKeyResolver();
    if (!apiKey) {
      throw new Error(
        `[MarketauxProvider] Marketaux API key not configured. Go to ` +
          `Settings > Credentials and add '${API_KEY_SECRET}' under plugin ` +
          `'${PLUGIN_ID}'. Register for a free key at https://www.marketaux.com/`,
      );
    }

    const url = this.buildUrl({
      symbol: params.symbol,
      publishedAfter: params.start_time,
      publishedBefore: params.end_time,
      apiKey,
    });

    const resp = await this.fetchWithTimeout(url);
    if (!resp.ok) {
      throw new Error(
        `[MarketauxProvider] HTTP ${resp.status} for symbol '${params.symbol}': ` +
          `${resp.statusText}`,
      );
    }
    const body = (await resp.json()) as MarketauxResponse;
    if (body.error) {
      throw new Error(
        `[MarketauxProvider] API error (${body.error.code ?? 'unknown'}): ` +
          `${body.error.message ?? 'no message'}`,
      );
    }
    if (!body.data || !Array.isArray(body.data)) {
      throw new Error(
        `[MarketauxProvider] malformed payload for symbol '${params.symbol}'`,
      );
    }

    return this.mapArticles(body.data, params);
  }

  /**
   * Start a live polling loop for one (symbol, factor_name) pair. On
   * each tick, fetches articles published since the last seen
   * `published_at` and forwards new (article, entity) pairs to `onRow`.
   * Returns a stop() function that cancels the timer.
   *
   * Deduplication: we track `lastSeenPublishedAt` AND a set of seen
   * article UUIDs across the most recent few ticks. Marketaux pagination
   * + the `published_after` filter means a slow-moving article window
   * could surface the same row twice; the uuid set is the authoritative
   * dedup. The published-at watermark is just an early-exit so we do
   * not need to scan the full uuid set in steady state.
   *
   * Rate-limit awareness: the floor `MIN_LIVE_POLL_INTERVAL_MS` (5 min)
   * keeps the free-tier 100 req/day quota safe even if the consumer
   * picks an aggressive cadence (100 req/day = one req per 14.4 min
   * spread evenly; the floor is a defensive bound, not the recommended
   * cadence).
   */
  startLiveStream(
    params: AlternativeDataRequest,
    onRow: (row: AlternativeFactorRow) => void,
    onError: (err: Error) => void,
    pollIntervalMs: number = DEFAULT_LIVE_POLL_INTERVAL_MS,
  ): () => void {
    if (pollIntervalMs < MIN_LIVE_POLL_INTERVAL_MS) {
      throw new Error(
        `[MarketauxProvider] startLiveStream: pollIntervalMs must be >= ` +
          `${MIN_LIVE_POLL_INTERVAL_MS} ms (Marketaux free tier is ` +
          `100 req/day; aggressive polling exhausts the daily quota)`,
      );
    }

    let lastSeenPublishedAt: string | null = null;
    const recentUuids = new Set<string>();
    // Keep dedup window bounded: 200 uuids is a few hours of news at
    // typical volume; well under the 100/day quota and small enough that
    // Set lookups stay constant-time in practice.
    const RECENT_UUID_BUDGET = 200;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        // Window: from the last-seen watermark (or the request's start)
        // through now(). On the first tick lastSeenPublishedAt is null
        // and we fetch the original request window.
        const startTime = lastSeenPublishedAt ?? params.start_time;
        const endTime = new Date().toISOString();
        const rows = await this.fetchFactorData({
          ...params,
          start_time: startTime,
          end_time: endTime,
        });
        for (const row of rows) {
          // vintage_id encodes the article uuid (set in mapArticles) so
          // we can dedup without a second schema field.
          const uuid = row.vintage_id ?? '';
          if (recentUuids.has(uuid)) continue;
          recentUuids.add(uuid);
          if (recentUuids.size > RECENT_UUID_BUDGET) {
            // Drop the oldest insertion. Set iteration order is
            // insertion order in JS.
            const oldest = recentUuids.values().next().value;
            if (oldest !== undefined) recentUuids.delete(oldest);
          }
          onRow(row);
        }
        if (rows.length > 0) {
          const newest = rows[rows.length - 1].event_time;
          if (lastSeenPublishedAt === null || newest > lastSeenPublishedAt) {
            lastSeenPublishedAt = newest;
          }
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    };

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

  private buildUrl(args: {
    symbol: string;
    publishedAfter: string;
    publishedBefore: string;
    apiKey: string;
  }): string {
    const qs = new URLSearchParams({
      api_token: args.apiKey,
      symbols: args.symbol,
      filter_entities: 'true',
      published_after: args.publishedAfter,
      published_before: args.publishedBefore,
      sort: 'published_at',
      // Marketaux sort direction defaults to desc; we re-sort ASC in
      // mapArticles so the contract holds regardless.
      limit: String(MARKETAUX_PAGE_SIZE),
    });
    return `${MARKETAUX_BASE_URL}?${qs.toString()}`;
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
   * Map Marketaux articles to AlternativeFactorRow.
   *
   * One row per (article uuid, matched-symbol entity) pair where the
   * entity matches the request's `symbol` AND carries a numeric
   * `sentiment_score`. The `vintage_id` slot encodes the article uuid
   * for downstream dedup -- the field is documented as optional on the
   * row schema, and Marketaux is `vintage_supported: false`, so this
   * dual-use does not collide with vintage-archive semantics for
   * providers that DO support vintages.
   *
   * `event_time` and `knowledge_time` both equal `published_at`:
   * Marketaux scores articles at ingestion (before the API returns
   * them), so the "first knowable" timestamp IS the publication
   * timestamp from the consumer's perspective.
   */
  private mapArticles(
    articles: MarketauxArticle[],
    params: AlternativeDataRequest,
  ): AlternativeFactorRow[] {
    const rows: AlternativeFactorRow[] = [];
    const targetSymbol = params.symbol!;
    for (const article of articles) {
      if (!article.entities || article.entities.length === 0) continue;
      for (const entity of article.entities) {
        if (entity.symbol !== targetSymbol) continue;
        const score = entity.sentiment_score;
        if (score === null || score === undefined || !Number.isFinite(score)) {
          continue;
        }
        rows.push({
          category: 'sentiment',
          factor_name: params.factor_name,
          symbol: targetSymbol,
          event_time: article.published_at,
          knowledge_time: article.published_at,
          value: score,
          vintage_id: article.uuid,
          source_provider: this.id,
        });
      }
    }
    rows.sort((a, b) =>
      a.event_time < b.event_time ? -1 : a.event_time > b.event_time ? 1 : 0,
    );
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
    appLog.error('[MarketauxProvider] credential read failed:', err);
    return null;
  }
}
