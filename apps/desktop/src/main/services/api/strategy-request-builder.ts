/**
 * Strategy Request Builder
 *
 * TICKET_461: Shared request format transformation for backend
 * /api/start_market_regime_analysis endpoint.
 *
 * Extracted from batch-generation-handlers.ts:buildSingleConfig().
 * Used by strategy-api.ts (Service API) and batch-generation-handlers.ts.
 */

import { toApiProvider } from '../../../shared/constants/llm-providers';

// Regime -> backend case_type mapping (mirrors market-regime-service.ts::mapRegimeToCaseType)
const REGIME_TO_CASE_TYPE: Record<string, string> = {
  trend: 'TREND_DETECTION',
  range: 'RANGE_DETECTION',
  consolidation: 'CONSOLIDATION_DETECTION',
  oscillation: 'OSCILLATION_DETECTION',
};

export function mapRegimeToCaseType(regime: string): string {
  if (regime.startsWith('bespoke_')) return regime;
  return REGIME_TO_CASE_TYPE[regime] || regime.toUpperCase();
}

/**
 * Build a server request matching backend /api/start_market_regime_analysis protocol.
 */
export function buildServerRequest(params: {
  regime: string;
  indicators: string[];
  strategy_name: string;
  preference?: string;
  persona?: string;
  llm_provider?: string;
  llm_model?: string;
}): Record<string, unknown> {
  const caseType = mapRegimeToCaseType(params.regime);

  const serverIndicators = params.indicators.map((ind) => ({
    type: ind.toLowerCase(),
    name: ind,
  }));

  const indicatorStr = params.indicators.join(' AND ');
  const regimeLabel = params.regime.replace(/_/g, ' ');
  const prompt = params.preference
    ? `${params.preference}\n\nRules: ${indicatorStr}`
    : `Generate a ${regimeLabel} strategy using: ${indicatorStr}`;

  return {
    strategy_name: params.strategy_name,
    // TICKET_1220: code generation is always English-only (TICKET_850).
    // getApiLocale() must not be called in the main process (i18next is
    // never initialized here).
    locale: 'en_US',
    output_format: 'v3',
    storage_mode: 'local',
    language: 'cpp',
    auto_reverse: true,
    analysis_config: {
      regime: [{
        case_type: caseType,
        params: {
          indicators: serverIndicators,
          factors: [],
        },
      }],
      llm_config: {
        prompt,
        provider: toApiProvider(params.llm_provider || ''),
        model: params.llm_model,
      },
      auto_reverse: true,
    },
    ...(params.persona && { persona: params.persona }),
    ...(params.preference && { preference: params.preference }),
  };
}
