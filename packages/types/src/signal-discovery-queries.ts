/**
 * Canonical signal-discovery read SQL builders (TICKET_1278).
 *
 * These builders are the single source of truth for the scoreboard/leaderboard
 * and list_signal_runs queries. Two independent runtimes execute them against
 * the same DB and MUST NOT drift:
 *
 *   - Electron main process (`quant-lab-extended-api.ts` getLeaderboard, the
 *     `http-server.ts` discovery read routes)
 *   - Standalone MCP server (`handlers/signal-discovery.ts` direct-SQL fallback)
 *
 * The MCP standalone server cannot import Electron modules (electron `app`
 * dependency), so the two consumers cannot share a runtime helper. They share
 * *these SQL strings* instead -- this module is pure TS with no runtime deps.
 *
 * ── TICKET_970_7 namespace resolution ──────────────────────────────────────
 * `signal_scoreboard.algo_id` lives in the persisted `nona_signal.id`
 * namespace (970_7), NOT the `nona_signal_definition.id` namespace. The pre-970_7
 * join `d.id = CAST(sb.algo_id AS INTEGER)` missed 100% of rows, nulling out
 * templateId/params/verdict/lastTrained. The correct resolution chain is:
 *
 *   signal_scoreboard.algo_id
 *     -> nona_signal s        (s.id = CAST(sb.algo_id AS INTEGER))
 *     -> nona_signal_definition d
 *          (json_extract(s.metadata,'$.fingerprint') = d.fingerprint,  TICKET_568_3)
 *
 * `s.deleted_at IS NULL AND s.status = 1` is mandatory on the `s` side so the
 * partial expression index `idx_nona_signal_metadata_fingerprint`
 * (WHERE deleted_at IS NULL AND status = 1, migration v100) is eligible.
 */

/**
 * Sort columns accepted by the scoreboard/leaderboard. `inner` is the raw
 * `signal_scoreboard sb` column used to ORDER the bounded inner subquery
 * (TICKET_1278_3); `outer` is the camelCase alias that inner subquery projects,
 * used to re-sort the joined result. The two MUST stay paired -- see
 * buildScoreboardQuery.
 */
export const SCOREBOARD_SORT_COLUMNS: Readonly<
  Record<string, { inner: string; outer: string }>
> = {
  score: { inner: 'sb.score', outer: 'score' },
  sharpe_long: { inner: 'sb.sharpe_long', outer: 'sharpeLong' },
  sharpe_short: { inner: 'sb.sharpe_short', outer: 'sharpeShort' },
  hit_rate: { inner: 'sb.hit_rate', outer: 'hitRate' },
  trades: { inner: 'sb.trades', outer: 'trades' },
  agreement_score: { inner: 'sb.agreement_score', outer: 'agreementScore' },
};

export function resolveScoreboardSortColumn(
  sortBy: string | undefined,
): { inner: string; outer: string } {
  return SCOREBOARD_SORT_COLUMNS[sortBy ?? 'score'] ?? SCOREBOARD_SORT_COLUMNS.score;
}

export interface ScoreboardQueryParams {
  limit: number;
  sortBy?: string;
  templateId?: string;
  minScore?: number | null;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * TICKET_1278 D1: scoreboard/leaderboard query on the post-970_7 namespace.
 *
 * Row shape (camelCase aliases): algoId, persistedSignalId (= s.id, the
 * alpha_factory_add_signals-addressable id), definitionId (= d.id, the
 * list_signal_runs / quality-metrics-addressable id), templateId (now
 * non-null), params, score, sharpeLong, sharpeShort, hitRate, trades,
 * trainedSymbolCount, agreementScore, mode, windowBars, computedAt, verdict,
 * lastTrained.
 *
 * The latest-run join is re-pointed at d.id (definition namespace) -- the same
 * namespace signal_run.definition_id has always used.
 *
 * ── TICKET_1278_3: inner-LIMIT-first (same pattern as buildSignalRunsQuery/D2
 *    and buildSignalDefinitionsQuery/1278_2) ──────────────────────────────────
 * The pre-1278_3 shape joined nona_signal / nona_signal_definition / the
 * latest-run correlated subquery for all 26K+ scoreboard rows and only THEN
 * sorted them in a temp B-tree to return LIMIT rows -- `SCAN sb` + a per-row
 * fingerprint join + `USE TEMP B-TREE FOR ORDER BY`, measured at 25.5s for
 * limit:1 on the 7GB DB. On the single-threaded MCP/Electron better-sqlite3
 * `.all()` this blocks the event loop long enough to ECONNRESET the MCP server.
 *
 * Fix: the inner subquery bounds `signal_scoreboard` to the top-N by the sort
 * column FIRST, resolving the definition chain only for those N rows; the
 * latest-run join + its correlated subquery then run `limit` times, not 26K.
 *   - No template filter: the inner subquery is driven by
 *     `idx_signal_scoreboard_score` (migration v125) so the default `score`
 *     sort needs no scan and no temp B-tree; the LEFT JOINs resolve the N
 *     survivors (unresolved persisted signals / definitions correctly null).
 *   - template_id present: the filter lives on the definition, so the inner
 *     subquery INNER JOINs nona_signal -> nona_signal_definition and applies
 *     `d.template_id = ?` BEFORE the LIMIT (a post-join WHERE would drop
 *     matching rows of the target family that sit beyond an all-family
 *     top-N window). Rows are non-null by construction on this branch.
 *
 * Both branches project the resolved columns out of the inner subquery, so the
 * outer query adds only the latest-run join (keyed on the carried definitionId)
 * -- the fingerprint join is never evaluated twice.
 *
 * Mode is intentionally NOT filtered: the tool exposes no `mode` param and the
 * scoreboard carries both `backtest` and `live` rows (scoreboard-write-from-
 * envelope.ts / live-scheduler.ts); an implicit `mode = 'backtest'` would
 * silently drop live rows. The index leads with `score DESC` (not mode) so it
 * drives the ORDER BY without a mode predicate.
 */
export function buildScoreboardQuery(input: ScoreboardQueryParams): BuiltQuery {
  const orderCol = resolveScoreboardSortColumn(input.sortBy);

  const params: unknown[] = [];

  // Inner subquery: bound signal_scoreboard to the top-N by the sort column
  // BEFORE the expensive latest-run join. All resolved columns (persisted
  // signal id, definition id/template/params) are projected here so the outer
  // query re-uses them without re-joining.
  const innerConditions: string[] = [];
  if (input.minScore != null && !Number.isNaN(input.minScore)) {
    innerConditions.push('sb.score >= ?');
    params.push(input.minScore);
  }

  let innerJoins: string;
  if (input.templateId) {
    // template_id lives on the definition -> INNER JOIN the resolution chain
    // inside the bounded set so the filter applies before the LIMIT.
    innerJoins = `
      JOIN nona_signal s
        ON s.id = CAST(sb.algo_id AS INTEGER)
        AND s.deleted_at IS NULL
        AND s.status = 1
      JOIN nona_signal_definition d
        ON d.fingerprint = json_extract(s.metadata, '$.fingerprint')
        AND d.deleted_at IS NULL`;
    innerConditions.push('d.template_id = ?');
    params.push(input.templateId);
  } else {
    // No family filter: LEFT JOIN so rows whose persisted signal / definition
    // is absent (deleted, not yet persisted) still surface with null fields.
    innerJoins = `
      LEFT JOIN nona_signal s
        ON s.id = CAST(sb.algo_id AS INTEGER)
        AND s.deleted_at IS NULL
        AND s.status = 1
      LEFT JOIN nona_signal_definition d
        ON d.fingerprint = json_extract(s.metadata, '$.fingerprint')
        AND d.deleted_at IS NULL`;
  }
  const innerWhere = innerConditions.length > 0 ? `WHERE ${innerConditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      inner_sb.algoId,
      inner_sb.persistedSignalId,
      inner_sb.definitionId,
      inner_sb.templateId,
      inner_sb.params,
      inner_sb.score,
      inner_sb.sharpeLong,
      inner_sb.sharpeShort,
      inner_sb.hitRate,
      inner_sb.trades,
      inner_sb.trainedSymbolCount,
      inner_sb.agreementScore,
      inner_sb.mode,
      inner_sb.windowBars,
      inner_sb.computedAt,
      lr.statistical_verdict AS verdict,
      lr.created_at          AS lastTrained
    FROM (
      SELECT
        sb.algo_id         AS algoId,
        s.id               AS persistedSignalId,
        d.id               AS definitionId,
        d.template_id      AS templateId,
        d.params_canonical AS params,
        sb.score           AS score,
        sb.sharpe_long     AS sharpeLong,
        sb.sharpe_short    AS sharpeShort,
        sb.hit_rate        AS hitRate,
        sb.trades          AS trades,
        sb.trained_symbol_count AS trainedSymbolCount,
        sb.agreement_score AS agreementScore,
        sb.mode            AS mode,
        sb.window_bars     AS windowBars,
        sb.computed_at     AS computedAt
      FROM signal_scoreboard sb${innerJoins}
      ${innerWhere}
      ORDER BY ${orderCol.inner} DESC
      LIMIT ?
    ) AS inner_sb
    -- latest run for the resolved definition (definition namespace); runs for
    -- the bounded N rows only, so the correlated subquery is evaluated limit
    -- times, not once per scoreboard row.
    LEFT JOIN signal_run lr ON lr.definition_id = inner_sb.definitionId
      AND lr.deleted_at IS NULL
      AND lr.id = (
        SELECT r2.id FROM signal_run r2
        WHERE r2.definition_id = inner_sb.definitionId
          AND r2.deleted_at IS NULL
        ORDER BY r2.created_at DESC LIMIT 1
      )
    ORDER BY inner_sb.${orderCol.outer} DESC
  `;
  params.push(input.limit);
  return { sql, params };
}

export interface SignalRunsQueryParams {
  limit: number;
  signalId?: number | null;
  templateId?: string;
  status?: string;
}

/**
 * TICKET_1278 D2: list_signal_runs, bounded to the top-N first.
 *
 * The pre-1278 fallback evaluated the `persistedSignalId` correlated subquery
 * for all 158K signal_run rows before the ORDER BY sort -- ~27 min. Two fixes:
 *
 *   1. The inner subquery collapses `ORDER BY r.created_at DESC LIMIT ?` to the
 *      top-N rows BEFORE the correlated `persistedSignalId` subquery is
 *      evaluated, so it runs `limit` times (default 20), not 158K times. The
 *      definition join and correlated subquery apply to the N survivors only.
 *   2. `AND s.status = 1` on the fingerprint subquery makes the partial index
 *      `idx_nona_signal_metadata_fingerprint` eligible (all non-deleted
 *      nona_signal rows have status=1; result set unchanged).
 *
 * The `template_id` filter lives on the definition, so it MUST be applied
 * inside the inner subquery (via a join) before the LIMIT -- otherwise the
 * top-N-overall bound would drop matching rows of the target template that sit
 * beyond the window. Filters on signal_run alone (definition_id, status,
 * deleted_at) also go inside, so the LIMIT always bounds the correct set.
 */
export function buildSignalRunsQuery(input: SignalRunsQueryParams): BuiltQuery {
  const innerConditions: string[] = ['r.deleted_at IS NULL'];
  const innerParams: unknown[] = [];

  if (input.signalId != null) {
    innerConditions.push('r.definition_id = ?');
    innerParams.push(input.signalId);
  }
  if (input.status && input.status !== 'all') {
    innerConditions.push('r.status = ?');
    innerParams.push(input.status);
  }

  // The template_id filter needs the definition join; when present, the inner
  // subquery joins nona_signal_definition so the LIMIT bounds the filtered set.
  const innerDefJoin = input.templateId
    ? 'JOIN nona_signal_definition di ON di.id = r.definition_id'
    : '';
  if (input.templateId) {
    innerConditions.push('di.template_id = ?');
    innerParams.push(input.templateId);
  }
  const innerWhere = `WHERE ${innerConditions.join(' AND ')}`;

  const sql = `
    SELECT
      r.id             AS runId,
      r.definition_id  AS signalId,
      d.template_id    AS templateId,
      r.status,
      r.score,
      r.is_sharpe      AS isSharpe,
      r.oos_sharpe_mean AS oosSharpe,
      r.is_hit_rate    AS isHitRate,
      r.oos_hit_rate   AS oosHitRate,
      r.deflated_sharpe_ratio AS deflatedSharpeRatio,
      r.l1_verdict     AS l1Verdict,
      r.l2_verdict     AS l2Verdict,
      r.l3_verdict     AS l3Verdict,
      r.funnel_terminal_layer AS funnelTerminalLayer,
      r.statistical_verdict AS statisticalVerdict,
      r.trained_symbol_count AS trainedSymbolCount,
      r.data_snapshot_id AS dataSnapshotId,
      r.cached_from_run_id IS NOT NULL AS cacheHit,
      r.created_at     AS createdAt,
      r.research_mode  AS researchMode,
      r.fold_count     AS foldCount,
      -- TICKET_1268: persisted nona_signal id (the Alpha-Factory-addressable
      -- id), resolved via the TICKET_568_3 fingerprint join; null when the run
      -- has not passed persistence. status=1 keeps the partial index eligible.
      (SELECT s.id FROM nona_signal s
        WHERE json_extract(s.metadata, '$.fingerprint') = d.fingerprint
          AND s.deleted_at IS NULL
          AND s.status = 1 LIMIT 1) AS persistedSignalId
    FROM (
      SELECT r.*
      FROM signal_run r
      ${innerDefJoin}
      ${innerWhere}
      ORDER BY r.created_at DESC
      LIMIT ?
    ) AS r
    JOIN nona_signal_definition d ON d.id = r.definition_id
    ORDER BY r.created_at DESC
  `;
  const params = [...innerParams, input.limit];
  return { sql, params };
}

export interface SignalDefinitionsQueryParams {
  limit: number;
  templateId?: string;
  provider?: string;
}

/**
 * TICKET_1278 D3: list_signal_definitions read, shared by the MCP fallback and
 * the Electron route. Exposes persistedSignalId via the status=1 index-eligible
 * fingerprint subquery (TICKET_1268).
 *
 * TICKET_1278_2: bounded to the top-N first, same pattern as
 * buildSignalRunsQuery (D2). The flat shape evaluated the three correlated
 * SELECT-list subqueries (runCount, latestRunStatus, persistedSignalId) for
 * every non-deleted definition row (26K+) before the ORDER BY sort could apply
 * the LIMIT -- minutes per call, and the Electron route runs it synchronously
 * on the main process. The inner subquery collapses to the top-N by created_at
 * first (no correlated work, milliseconds), so the subqueries run `limit`
 * times only. All definition-level filters (deleted_at, template_id, provider)
 * live inside the inner subquery so the LIMIT bounds the filtered set.
 */
export function buildSignalDefinitionsQuery(input: SignalDefinitionsQueryParams): BuiltQuery {
  const conditions: string[] = ['d.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (input.templateId) {
    conditions.push('d.template_id = ?');
    params.push(input.templateId);
  }
  if (input.provider) {
    conditions.push('d.provider = ?');
    params.push(input.provider);
  }
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const sql = `
    SELECT
      d.id,
      d.fingerprint,
      d.template_id   AS templateId,
      d.params_canonical AS params,
      d.provider,
      d.signal_source  AS signalSource,
      d.category,
      d.display_name   AS displayName,
      d.bar_interval   AS barInterval,
      d.created_at     AS createdAt,
      (SELECT COUNT(*) FROM signal_run r WHERE r.definition_id = d.id AND r.deleted_at IS NULL) AS runCount,
      (SELECT r.status FROM signal_run r WHERE r.definition_id = d.id AND r.deleted_at IS NULL ORDER BY r.run_seq DESC LIMIT 1) AS latestRunStatus,
      -- TICKET_1268: persisted nona_signal id (the Alpha-Factory-addressable
      -- id), resolved via the TICKET_568_3 fingerprint join; null when the run
      -- has not passed persistence. status=1 keeps the partial index eligible.
      (SELECT s.id FROM nona_signal s
        WHERE json_extract(s.metadata, '$.fingerprint') = d.fingerprint
          AND s.deleted_at IS NULL
          AND s.status = 1 LIMIT 1) AS persistedSignalId
    FROM (
      SELECT d.*
      FROM nona_signal_definition d
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT ?
    ) AS d
    ORDER BY d.created_at DESC
  `;
  params.push(input.limit);
  return { sql, params };
}

/**
 * TICKET_1278 D3: the two quality-metrics reads (per-layer metrics + run-level
 * verdicts), shared by the MCP fallback and the Electron route. Static SQL --
 * both callers bind `signal_run_id` once.
 */
export const SIGNAL_QUALITY_METRICS_SQL = `
  SELECT
    signal_run_id AS signalRunId,
    layer,
    metric_name   AS metricName,
    metric_value  AS metricValue,
    computed_at   AS computedAt
  FROM signal_quality_metrics
  WHERE signal_run_id = ?
  ORDER BY layer, metric_name
`;

export const SIGNAL_RUN_VERDICTS_SQL = `
  SELECT
    id,
    definition_id    AS definitionId,
    l1_verdict       AS l1Verdict,
    l2_verdict       AS l2Verdict,
    l3_verdict       AS l3Verdict,
    funnel_terminal_layer AS funnelTerminalLayer,
    statistical_verdict AS statisticalVerdict,
    p_value_bh_adjusted AS pValueBhAdjusted,
    deflated_sharpe_ratio AS deflatedSharpeRatio,
    oos_sharpe_mean  AS oosSharpe,
    is_sharpe        AS isSharpe,
    is_hit_rate      AS isHitRate,
    oos_hit_rate     AS oosHitRate
  FROM signal_run
  WHERE id = ?
`;

/** Group flat quality-metric rows by layer (shared shaping logic). */
export function groupQualityMetricsByLayer(
  rows: Array<{ layer: string; metricName: string; metricValue: unknown }>,
): Record<string, Array<{ metricName: string; metricValue: unknown }>> {
  const byLayer: Record<string, Array<{ metricName: string; metricValue: unknown }>> = {};
  for (const row of rows) {
    const layer = row.layer;
    if (!byLayer[layer]) byLayer[layer] = [];
    byLayer[layer].push({ metricName: row.metricName, metricValue: row.metricValue });
  }
  return byLayer;
}
