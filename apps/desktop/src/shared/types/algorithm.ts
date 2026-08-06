/**
 * Algorithm Types - Type definitions for algorithm entities
 *
 * Related: TICKET_115 - Regime Detector Algorithm Storage Implementation
 */

// Re-export types from AlgorithmService for convenience
export type {
  AlgorithmInsertData,
  AlgorithmRecord,
} from '../../main/database/services/algorithm-service';

// =============================================================================
// Preload contract for window.electronAPI.database.getAlgorithms
// (TICKET_771 Step 2 / Layer 2b)
//
// Single source of truth for both:
//   - apps/desktop/src/preload/index.ts (definition site)
//   - plugin renderer code that wraps the preload call (e.g.
//     plugins/back-test-nexus/ui/src/services/algorithmService.ts)
//
// Lives in shared/types because plugins resolve @shared/* against this
// directory and must consume the same shape the preload publishes.
// =============================================================================
export interface GetAlgorithmsOptions {
  userId?: string;
  strategyType?: number | number[];
  signalSourcePrefix?: string;
}

export interface GetAlgorithmsRecord {
  id: number;
  code: string;
  strategyName: string;
  strategyType: number;
  description: string | null;
  classificationMetadata: string | null;
}

export interface GetAlgorithmsResult {
  success: boolean;
  data?: GetAlgorithmsRecord[];
  error?: { code: string; message: string };
}

/**
 * Parsed classification metadata structure
 */
export interface ClassificationMetadata {
  class_name: string;
  signal_source: string;
  strategy_role: string;
  trading_style?: string;
  strategy_composition?: string;
  components?: {
    indicator?: {
      regime_type: string;
      llm_provider: string;
    };
  };
  tags?: string[];
  created_at: string;
}

/**
 * Parsed strategy rules structure
 */
export interface StrategyRules {
  strategy_type: string;
  regime_type: string;
  entry_conditions: unknown[];
  exit_conditions: unknown[];
  risk_management?: Record<string, unknown>;
  indicators?: string[];
  rules?: unknown[];
  detection_config?: Record<string, unknown>;
}
