/**
 * Single shared owner for the regime-detector `classification_metadata` +
 * `strategy_rules` assembly (TICKET_1306_4, finding D6).
 *
 * Before this module the assembly existed twice: the authoritative Electron
 * copy in `extractAlgorithmData` and a divergent inline copy in the MCP
 * `persistGeneratedStrategy` (strategy_role/tags/rules-shape all differed). This
 * is the ONE assembler; both surfaces call it so a taxonomy change updates one
 * place. Mirrors `market_regime_business.py:623-655`.
 *
 * Electron-free: no Node, no Electron, no i18n. `createdAt` is injected so the
 * output is deterministic under test and identical across surfaces.
 */

export interface StrategyClassificationInput {
  /**
   * Resolved strategy class name. Callers pass either the backend-supplied
   * `class_name` or a code-extracted fallback; the assembler does not parse
   * code.
   */
  className: string;
  regimeType: string;
  llmProvider: string;
  /** Only present in `strategy_rules.detection_config`; kept optional. */
  llmModel?: string;
  /** Ordered rule descriptors from the request context (may be empty). */
  rules?: Array<{ type?: string; name?: string; [key: string]: unknown }>;
  persona?: string;
  preference?: string;
  /** LLM-reported trading style, merged into the feature fingerprint. */
  tradingStyle?: string;
  /** ISO8601 timestamp for `created_at`; injected for determinism. */
  createdAt: string;
}

export interface StrategyClassification {
  classificationMetadata: Record<string, unknown>;
  strategyRules: Record<string, unknown>;
}

/**
 * Generate `signal_source` following the backend logic
 * (`market_regime_business.py:609-621`):
 *   - `bespoke_*`     -> `indicator_detector_bespoke_*` (full name kept)
 *   - `TREND_DETECTION` / `trend` -> `indicator_detector_trend` (first part)
 */
export function generateSignalSource(regimeType: string): string {
  if (regimeType.toLowerCase().startsWith('bespoke_')) {
    return `indicator_detector_${regimeType}`;
  }
  const subtype = regimeType.includes('_')
    ? regimeType.split('_')[0].toLowerCase()
    : regimeType.toLowerCase();
  return `indicator_detector_${subtype}`;
}

export function buildStrategyClassification(
  input: StrategyClassificationInput,
): StrategyClassification {
  const signalSource = generateSignalSource(input.regimeType);
  const rules = input.rules ?? [];

  const classificationMetadata: Record<string, unknown> = {
    class_name: input.className,
    signal_source: signalSource,
    strategy_role: 'market_regime',
    trading_style: 'neutral',
    strategy_composition: 'atomic',
    components: {
      indicator: {
        regime_type: input.regimeType,
        llm_provider: input.llmProvider,
      },
    },
    tags: ['indicator', 'regime', 'market-analysis'],
    created_at: input.createdAt,
    ...(input.persona && { persona: input.persona }),
    ...(input.preference && { preference: input.preference }),
    feature_fingerprint: {
      indicator_combo: rules
        .map((r) => r.type || r.name || '')
        .filter(Boolean)
        .sort(),
      regime: input.regimeType,
      persona: input.persona || null,
      ...(input.tradingStyle && { trading_style: input.tradingStyle }),
    },
  };

  const strategyRules: Record<string, unknown> = {
    strategy_type: 'Market Regime Detection',
    regime_type: input.regimeType,
    entry_conditions: [],
    exit_conditions: [],
    risk_management: {},
    indicators: [],
    rules,
    detection_config: {
      regime_type: input.regimeType,
      llm_provider: input.llmProvider,
      ...(input.llmModel !== undefined && { llm_model: input.llmModel }),
    },
  };

  return { classificationMetadata, strategyRules };
}
