/**
 * Algorithm Types - Type definitions for algorithm entities
 *
 * Related: TICKET_115 - Regime Detector Algorithm Storage Implementation
 */

// =============================================================================
// nona_algorithms / nona_signal row shapes
//
// These are pure data contracts for the SQLite rows, consumed by main-process
// services, the shared Hub entity map (types/hub/schema.ts) and -- through the
// `@shared/*` path alias -- by plugin renderers. They therefore live in
// `shared/`, which is the layer that owns cross-process contracts.
//
// They used to be declared in main/database/services/algorithm-service.ts and
// re-exported from here. That was an upward `shared -> main` dependency: it
// pulled db-manager.ts, the migration host and the whole Electron main-process
// graph into every plugin that includes `apps/desktop/src/shared/**/*` in its
// tsconfig, so a plugin `tsc --noEmit` failed whenever an unrelated main-side
// dependency (e.g. @StratCraft/db-migrations) had not been built yet.
// AlgorithmService now imports these from here instead.
// =============================================================================

/**
 * Data required to insert a new algorithm into database
 */
export interface AlgorithmInsertData {
  code: string;
  strategy_name: string;
  strategy_type: number;
  classification_metadata: string; // JSON string
  strategy_rules?: string; // JSON string
  description?: string;
  file_path?: string;
  prompt_template?: string;
  user_id: string;
  category?: string;
  metadata?: string; // JSON string
  /**
   * TICKET_907_1_1: first-class signal bar interval on nona_signal.
   * Kept optional because nona_algorithms does not carry this column and
   * legacy nona_signal rows remain nullable.
   */
  bar_interval?: string | null;
  record_type?: string;
  is_system?: number;
  activate?: number;
  status?: number;
  pnl?: string;
  sync_status?: string;
  local_only?: number;
  version?: number;
  audit_status?: 'pending' | 'completed' | 'failed' | 'skipped';
  backend_validation_report?: string | null;
  /**
   * TICKET_196_7_6_4 D4 / TICKET_196_7_0_2 (migration v51): absolute path
   * to the v2 signal artifact directory for file-backed signal kinds
   * (currently `factor_talib_*` via FactorArtifactLoader). Persisted into
   * the `artifact_path` column on `nona_signal` / `nona_algorithms`.
   */
  artifact_path?: string;
  /**
   * TICKET_927_1_2_A: per-signal market-of-applicability JSON column on
   * `nona_signal` (added by migration v87 / TICKET_927_1_2). Canonical
   * shape is `MarketScope.toJson()` -- sorted, deduped JSON array of
   * MarketId strings. Set non-null on every new discovery write by
   * `persistSignal()`; nona_algorithms ignores it because the column is
   * nona_signal-only. Optional at the InsertData layer so non-signal
   * callers (e.g. legacy `nona_algorithms` writes) compile without
   * change.
   */
  market_scope?: string;
}

/**
 * Complete algorithm record from database
 */
export interface AlgorithmRecord {
  id: number;
  code: string;
  file_path: string | null;
  strategy_name: string | null;
  description: string | null;
  strategy_type: number;
  classification_metadata: string | null;
  record_type: string;
  category: string | null;
  metadata: string | null;
  bar_interval?: string | null;
  pnl: string;
  user_id: string | null;
  is_system: number;
  status: number;
  activate: number;
  create_time: string;
  update_time: string;
  sync_status: string;
  last_sync_time: string | null;
  local_only: number;
  strategy_rules: string | null;
  prompt_template: string | null;
  version: number;
  deleted_at: string | null;
  compile_status: 'pending' | 'success' | 'error' | null;
  compile_error: string | null;
  compile_hash: string | null;
  compile_artifact_path: string | null;
  compiled_at: number | null;
  audit_status: 'pending' | 'completed' | 'failed' | 'skipped' | null;
  backend_validation_report: string | null;
}

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
