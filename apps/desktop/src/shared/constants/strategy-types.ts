/**
 * Strategy Type Constants (TICKET_639)
 *
 * Defines which signal sources are free (no authentication required)
 * and which require login (Pro/paid types).
 *
 * Used by IPC handlers to conditionally skip auth pre-flight checks
 * and pass skipAuth to authenticatedFetch for anonymous backend access.
 */

// ---------------------------------------------------------------------------
// Kronos Model Catalog (ISSUE_7010)
// Single source of truth -- consumed by IPC handlers and Service API.
// ---------------------------------------------------------------------------

export interface KronosModelEntry {
  id: string;
  name: string;
  params: string;
  maxContext: number;
}

export const KRONOS_MODEL_CATALOG: readonly KronosModelEntry[] = [
  { id: 'kronos-mini', name: 'Kronos Mini', params: '8M', maxContext: 512 },
  { id: 'kronos-small', name: 'Kronos Small', params: '20M', maxContext: 1024 },
  { id: 'kronos-base', name: 'Kronos Base', params: '84M', maxContext: 2048 },
] as const;

/**
 * Signal sources that do not require authentication.
 * These strategy types can be generated without login.
 * Backend must also accept anonymous requests for these types.
 */
export const FREE_SIGNAL_SOURCES = new Set([
  'indicator_detector_trend',
  'indicator_detector_range',
  'indicator_detector_consolidation',
  'indicator_detector_oscillation',
  'indicator_entry_trend',
  'indicator_entry_range',
  'indicator_entry_standalone',
  'indicator_entry_consolidation',
  'indicator_entry_oscillation',
] as const);

/**
 * Check if a signal source is free (does not require authentication).
 *
 * All indicator_detector_*, indicator_entry_*, and indicator_exit_* types are free,
 * including bespoke variants (e.g., indicator_detector_bespoke_momentum).
 *
 * TICKET_196_7_5 Resolution #5: tool_sweep_* (HMM / n-gram / ML parameter sweep)
 * is 100% local compute -- no LLM, no server -- so it qualifies as free under
 * the Open Core service model (TICKET_435 / TICKET_638 / TICKET_639).
 *
 * TICKET_196_7_6_3 D5: factor_talib_* (catalog-mapped TA-Lib factors) is free
 * because TA-Lib factors are public-domain math (not Pro IP) and the parameter
 * sweep UX mirrors tool_sweep_*. LLM-generated factors stay Pro and would NOT
 * join this list. Only the `factor_talib_` prefix is whitelisted in Phase 1.
 *
 * TICKET_196_7_6_8 Acceptance #5: factor_alpha158_* (catalog-mapped Alpha158
 * composite factors from `alpha158_factors.json`) joins the free
 * whitelist now that Phase 2 ships. Alpha158 formulas are public-domain
 * Qlib expressions (same shape as TA-Lib: 100% local C++ compute via the
 * `factor_eval` plugin, no LLM, no server). `factor_alpha101_*` stays gated
 * until Phase 3 ships its cross-sectional kernels.
 *
 * TICKET_568_5_3 D7: factor_combo_* (Layer 2 multi-factor combinator) is free
 * in Phase 1 because all component factors are TA-Lib (already free). When a
 * future paid factor family enters the picker, the combo must flip to paid iff
 * any component is paid; that gating will be stamped onto `nona_signal.is_free`
 * at persist time rather than re-decided here.
 *
 * TICKET_795_1_3 (decision 2): factor_llm_* (LLM-generated factor formulas
 * emitted by the Signal Discovery Factor tab) joins the free whitelist
 * downstream of the upstream PRO gate. The LLM call itself --
 * `POST /api/factor_formula/generate` per TICKET_795_1_1 -- is
 * `auth: required` with no anonymous quota, so the IP exposure (factor
 * prompt template) is enforced server-side at generation time. Once the
 * formula is persisted into `nona_signal`, the row is local C++ compute
 * via the existing `factor_eval` plugin (no further server calls), so it
 * behaves like any other factor (talib / alpha158 / combo) for visibility,
 * picker enumeration, and scoreboard scoring. Keeping the row free
 * downstream is consistent with the rest of the factor family.
 *
 * Pro types requiring auth: llm, llmtrader, aiLibero, aiStudio,
 * kronosLLMEntry, kronos_prediction.
 *
 * @param signalSource - The signal_source string to check
 * @returns true if the signal source does not require authentication
 */
export function isFreeSignalSource(signalSource: string): boolean {
  if (
    signalSource.startsWith('indicator_detector_') ||
    signalSource.startsWith('indicator_entry_') ||
    signalSource.startsWith('indicator_exit_') ||
    signalSource.startsWith('tool_sweep_') ||
    signalSource.startsWith('factor_talib_') ||
    signalSource.startsWith('factor_alpha158_') ||
    signalSource.startsWith('factor_combo_') ||
    signalSource.startsWith('factor_llm_') ||
    signalSource.startsWith('strategy_catalog_') ||
    signalSource === 'exit_strategy'
  ) {
    return true;
  }
  return false;
}

/**
 * Check if a signal source produces continuous `[-1, 1]` per-bar output
 * eligible for rank-IC scoring on the Signal Performance Scoreboard.
 *
 * TICKET_196_6 (Decision D4): IC-rank only continuous-output families.
 * Discrete / LLM trade-decision outputs are excluded because Spearman rank-IC
 * on a binary {-1, +1} stream collapses to a phi coefficient and is not
 * numerically comparable to continuous-signal IC across families
 * (Grinold & Kahn Fundamental Law assumes continuous cross-sectional forecasts).
 *
 * Include (continuous output):
 *   - indicator_detector_*, indicator_entry_*, indicator_exit_* prefixes
 *   - tool_sweep_* prefix (HMM / n-gram / sklearn / xgboost / pytorch_mlp)
 *   - factor_talib_* prefix (TICKET_196_7_6_3): TA-Lib factor signals reduce
 *     to a continuous scalar via zscore / rank / raw reducer per D2; their
 *     per-bar output is the same shape as indicator_* and tool_sweep_*.
 *   - factor_alpha158_* prefix (TICKET_196_7_6_8 Acceptance #2): Alpha158
 *     composite factors from `alpha158_factors.json` use the same
 *     `zscore | rank | raw` reducer set as TA-Lib (the reducer choice is
 *     orthogonal to the engine that produced the raw factor value), so the
 *     per-bar output is the same continuous scalar shape -- ranked on the
 *     same scoreboard as TA-Lib factor signals.
 *   - factor_combo_* prefix (TICKET_568_5_3 D1): Layer 2 multi-factor combo
 *     produces a single continuous alpha series via equal_weight / ic_weighted
 *     / regression / pca; same shape as a single factor_talib_*.
 *   - factor_llm_* prefix (TICKET_795_1_3 decision 2): LLM-generated factor
 *     formulas (Alpha158 DSL per TICKET_795_1_2) are evaluated by the same
 *     C++ `factor_eval` plugin as `factor_alpha158_*`. The reducer choice
 *     is engine-orthogonal, so the per-bar output is the same continuous
 *     scalar shape -- ranked on the same scoreboard as catalog factor
 *     signals.
 *   - exact match `workflow`
 *   - exact match `exit_strategy`
 *
 * Exclude (discrete / LLM trade decision):
 *   - ai_libero, ai_studio, kronos_prediction, and anything not in the
 *     include set (conservative default -- new signal_sources must opt in).
 *
 * @param signalSource - The signal_source string to check
 * @returns true if eligible for rank-IC scoring
 */
export function isIcScoreableSignalSource(signalSource: string): boolean {
  if (
    signalSource.startsWith('indicator_detector_') ||
    signalSource.startsWith('indicator_entry_') ||
    signalSource.startsWith('indicator_exit_') ||
    signalSource.startsWith('tool_sweep_') ||
    signalSource.startsWith('factor_talib_') ||
    signalSource.startsWith('factor_alpha158_') ||
    signalSource.startsWith('factor_combo_') ||
    signalSource.startsWith('factor_llm_') ||
    signalSource.startsWith('alt_') ||
    signalSource === 'workflow' ||
    signalSource === 'exit_strategy'
  ) {
    return true;
  }
  return false;
}

/**
 * TICKET_568_5_1 Phase 3: detect Layer 3 alternative-data signals from their
 * `signal_source` string.
 *
 * Layer 3 signals adopt the `alt_<category>_<factor>` prefix convention:
 *   alt_macro_yield_curve_slope
 *   alt_macro_vix_term_structure
 *   alt_sentiment_news_score        (future, follow-up ticket)
 *   alt_fund_flow_etf_inflow        (future, follow-up ticket)
 *   alt_on_chain_exchange_netflow   (future, follow-up ticket)
 *
 * The Signal Performance Scoreboard writer uses this helper to decide
 * whether to stamp `forward_test_started_at` on the FIRST observation of
 * an alt-data signal (one-shot stamp, never overwritten) -- which is the
 * data-contract item from TICKET_568_5_1 enforcement of [[TICKET_196_6_1]]
 * "live-IC sample size always visible".
 *
 * @param signalSource - The signal_source string to check
 * @returns true if the signal is a Layer 3 alt-data signal
 */
export function isAltDataSignalSource(signalSource: string): boolean {
  return signalSource.startsWith('alt_');
}
