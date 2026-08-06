/**
 * Centralized Algorithm Storage Service
 *
 * Follows backend StrategyStorageService pattern exactly.
 * Handles all strategy types with proper metadata mapping.
 *
 * @see TICKET_077_D1_CENTRALIZED_ALGORITHM_STORAGE_SERVICE.md
 * @see /app/nona_server/src/services/strategy_storage_service.py
 */

import i18n from 'i18next';
import { getCurrentUserIdAsString } from '../utils/auth-utils';

// =============================================================================
// Enums (matches backend constants)
// =============================================================================

/**
 * Storage mode enumeration (matches backend StorageMode)
 */
export enum StorageMode {
  LOCAL = 'local',    // Save to desktop SQLite only
  REMOTE = 'remote',  // Save to server MySQL only
  HYBRID = 'hybrid',  // Save to both
}

/**
 * Strategy type constants (matches backend constants/business/strategy.py)
 * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md
 */
export enum StrategyType {
  TYPE_EXECUTION = 1,       // Execution strategies
  TYPE_ENTRY_SIGNAL = 3,    // Entry signal strategies (Legacy)
  TYPE_EXIT_SIGNAL = 6,     // Exit signal strategies
  TYPE_PRECONDITION = 7,    // Pre-condition strategies
  TYPE_POSTCONDITION = 8,   // Post-condition strategies
  TYPE_ANALYSIS = 9,        // Analysis strategies (Market Regime, Kronos Predictor)
  TYPE_DIRECTOR = 10,       // Director strategies
  TYPE_ADVISOR = 11,        // Advisor strategies
}

/**
 * Signal source constants (matches backend SignalSourceConstants)
 * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md
 */
export enum SignalSource {
  INDICATOR_DETECTOR = 'indicator_detector',
  KRONOS_INDICATOR_ENTRY = 'kronosIndicatorEntry',  // TICKET_210: Match backend standard
  KRONOS_PREDICTOR = 'kronos_prediction',           // TICKET_210: Match backend standard
  KRONOS_LLM_ENTRY = 'kronos_llm_entry',
  MARKET_REGIME = 'market_regime',
  WATCHLIST = 'watchlist',                          // Trader Mode > Market Observer
  LLMTRADER = 'llmtrader',                          // Trader Mode > AI Entry Generator
  AI_LIBERO = 'aiLibero',                           // Agent Mode > AI Libero (TICKET_500)
  AI_STUDIO = 'aiStudio',                           // Vibing Chat > AI Studio (TICKET_523)
  RISK_OVERRIDE = 'risk_override',                   // Risk Manager > Risk Override Exit (TICKET_274)
  STRATEGY_CATALOG = 'strategy_catalog',             // Strategy Catalog > Generated from catalog (TICKET_994)
}

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Classification metadata (matches backend WordPress standard)
 */
export interface ClassificationMetadata {
  signal_source: SignalSource | string;
  strategy_role: string;
  trading_style?: string;
  strategy_composition?: string;
  class_name: string;
  components?: Record<string, unknown>;
  tags?: string[];
  created_at?: string;

  // Type-specific fields
  entry_signal_base?: string;  // For Kronos Indicator Entry
  regime_type?: string;        // For Regime Detector
  server_strategy_id?: number; // Backend DB strategy ID for LLM API
}

/**
 * Algorithm save request (unified interface)
 */
export interface AlgorithmSaveRequest {
  // Required fields
  strategy_name: string;
  code: string;
  user_id: string;
  strategy_type: StrategyType;

  // Storage control
  storage_mode?: StorageMode;  // Default: LOCAL

  /** TICKET_010: Code language for file extension */
  language?: 'python' | 'cpp';

  // Metadata (dynamic based on strategy type)
  classification_metadata: ClassificationMetadata;
  strategy_rules?: Record<string, unknown>;
  description?: string;
}

/**
 * Save result
 */
export interface AlgorithmSaveResult {
  success: boolean;
  data?: {
    id: number;
    strategy_name: string;
    storage_mode: StorageMode;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * TICKET_212: Algorithm list item
 */
export interface AlgorithmListItem {
  id: number;
  code: string;
  strategyName: string;
  strategyType: number;
  description?: string;
  classificationMetadata?: ClassificationMetadata;
}

/**
 * TICKET_212: Algorithm list result
 */
export interface AlgorithmListResult {
  success: boolean;
  data: AlgorithmListItem[];
  error?: {
    code: string;
    message: string;
  };
}

// =============================================================================
// Factory Function Input Types
// =============================================================================

export interface KronosIndicatorEntryResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  entry_signal_base: string;
  strategy_id?: number | null;
  created_at?: string;
}

export interface KronosIndicatorEntryConfig {
  user_id?: string;
  longEntryIndicators: Array<Record<string, unknown>>;
  shortEntryIndicators: Array<Record<string, unknown>>;
}

export interface RegimeDetectorResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
}

export interface RegimeDetectorConfig {
  user_id?: string;
  regime: string;
  llm_provider?: string;
  llm_model?: string;
  indicators?: unknown[];
  rules?: unknown[];
}

export interface EntrySignalResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
}

export interface EntrySignalConfig {
  user_id?: string;
  regime: string;
  indicator_blocks?: unknown[];
  factor_blocks?: unknown[];
  llm_provider?: string;
  llm_model?: string;
}

/**
 * Kronos Predictor result from API
 */
export interface KronosPredictorResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
}

/**
 * Kronos Predictor configuration
 */
export interface KronosPredictorConfig {
  user_id?: string;
  model_version: string;
  lookback: number;
  pred_len: number;
  temperature: number;
  top_p: number;
  top_k: number;
  sample_count: number;
  signal_filter: {
    filters: {
      confidence: { enabled: boolean; min_value: number };
      expected_return: { enabled: boolean; min_value: number };
      direction_filter: { enabled: boolean; mode: string };
      magnitude: { enabled: boolean; min_value: number };
      consistency: { enabled: boolean; min_value: number };
    };
    combination_logic: 'AND' | 'OR';
  };
}

/**
 * Kronos AI Entry result from API (TICKET_211)
 */
export interface KronosAIEntryResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  strategy_id?: number;
  created_at?: string;
}

/**
 * Kronos AI Entry configuration (TICKET_211)
 */
export interface KronosAIEntryConfig {
  user_id?: string;
  preset_mode: 'baseline' | 'monk' | 'warrior' | 'bespoke';
  bespoke_config?: {
    lookbackBars: number;
    positionLimits: number;
    leverage: number;
    tradingFrequency: number;
    typicalYield: number;
    maxDrawdown: number;
  };
  prompt: string;
  indicators: Array<{
    id: string;
    indicatorSlug: string | null;
    paramValues: Record<string, number | string>;
  }>;
  llm_provider?: string;
  llm_model?: string;
}

/**
 * Market Observer result from API (TICKET_077_1 page35)
 */
export interface MarketObserverResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  created_at?: string;
}

/**
 * Market Observer configuration (TICKET_077_1 page35)
 */
export interface MarketObserverConfig {
  user_id?: string;
  llm_provider?: string;
  llm_model?: string;
  indicators?: unknown[];
  rules?: unknown[];
}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Centralized Algorithm Storage Service
 *
 * Singleton pattern for consistent state management.
 * All strategy types use this single entry point.
 */
export class AlgorithmStorageService {
  private static instance: AlgorithmStorageService | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AlgorithmStorageService {
    if (!this.instance) {
      this.instance = new AlgorithmStorageService();
    }
    return this.instance;
  }

  /**
   * Parse storage mode string to enum
   */
  parseStorageMode(mode?: string): StorageMode {
    if (!mode) return StorageMode.LOCAL;
    const normalized = mode.toLowerCase();
    if (normalized === 'remote') return StorageMode.REMOTE;
    if (normalized === 'hybrid') return StorageMode.HYBRID;
    return StorageMode.LOCAL;
  }

  /**
   * Check if should persist to local SQLite
   *
   * LOCAL mode: Save to desktop SQLite
   * REMOTE mode: Skip local (server handles it)
   * HYBRID mode: Save to both
   */
  shouldPersistLocal(mode: StorageMode): boolean {
    return mode === StorageMode.LOCAL || mode === StorageMode.HYBRID;
  }

  /**
   * Save algorithm to local SQLite
   *
   * Central entry point for all strategy types.
   */
  async save(request: AlgorithmSaveRequest): Promise<AlgorithmSaveResult> {
    const storageMode = this.parseStorageMode(request.storage_mode);

    console.log('[AlgorithmStorageService] Save request:', {
      strategy_name: request.strategy_name,
      strategy_type: request.strategy_type,
      storage_mode: storageMode,
    });

    // Check if should persist locally
    if (!this.shouldPersistLocal(storageMode)) {
      console.log(
        `[AlgorithmStorageService] Skipping local storage (mode=${storageMode})`
      );
      return {
        success: true,
        data: {
          id: 0,
          strategy_name: request.strategy_name,
          storage_mode: storageMode,
        },
      };
    }

    try {
      // Build database record
      const record = this.buildDatabaseRecord(request);

      console.log('[AlgorithmStorageService] Saving to database:', {
        strategy_name: record.strategy_name,
        strategy_type: record.strategy_type,
        code_length: (record.code as string).length,
      });

      // Call Hub API to save
      const response = await window.electronAPI.hub.invokeEntity(
        'save',
        'nona_algorithm',
        record,
        'com.stratcraft.strategy-builder-nexus'
      );

      if (response.success) {
        console.log(
          `[AlgorithmStorageService] Saved successfully: id=${response.data}, name=${request.strategy_name}`
        );

        // Show success notification
        window.nexus?.window?.showNotification(
          i18n.t('notifications.strategySavedSuccess', { name: request.strategy_name, ns: 'strategy-builder' }),
          'success'
        );

        return {
          success: true,
          data: {
            id: response.data,
            strategy_name: request.strategy_name,
            storage_mode: storageMode,
          },
        };
      } else {
        console.error('[E:STRATEGY:ALGO_STORAGE_SAVE_FAILED] [AlgorithmStorageService] Save failed:', response.error);

        // Show error notification
        window.nexus?.window?.showNotification(
          i18n.t('notifications.strategySaveFailed', { error: response.error?.message || 'Unknown error', ns: 'strategy-builder' }),
          'error'
        );

        return {
          success: false,
          error: response.error || {
            code: 'SAVE_FAILED',
            message: i18n.t('MSG_GENERIC_ERROR', { ns: 'errors' }),
          },
        };
      }
    } catch (error) {
      console.error('[E:STRATEGY:ALGO_STORAGE_SAVE_EXCEPTION] [AlgorithmStorageService] Save exception:', error);

      // Show error notification
      window.nexus?.window?.showNotification(
        i18n.t('errors.saveFailed', { ns: 'strategy-builder' }),
        'error'
      );

      return {
        success: false,
        error: {
          code: 'SAVE_EXCEPTION',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Save without showing notifications (for batch operations)
   */
  async saveSilent(request: AlgorithmSaveRequest): Promise<AlgorithmSaveResult> {
    const storageMode = this.parseStorageMode(request.storage_mode);

    if (!this.shouldPersistLocal(storageMode)) {
      return {
        success: true,
        data: {
          id: 0,
          strategy_name: request.strategy_name,
          storage_mode: storageMode,
        },
      };
    }

    try {
      const record = this.buildDatabaseRecord(request);

      const response = await window.electronAPI.hub.invokeEntity(
        'save',
        'nona_algorithm',
        record,
        'com.stratcraft.strategy-builder-nexus'
      );

      if (response.success) {
        return {
          success: true,
          data: {
            id: response.data,
            strategy_name: request.strategy_name,
            storage_mode: storageMode,
          },
        };
      } else {
        return {
          success: false,
          error: response.error,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SAVE_EXCEPTION',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Build database record from request
   */
  private buildDatabaseRecord(request: AlgorithmSaveRequest): Record<string, unknown> {
    // Ensure created_at is set
    const metadata: ClassificationMetadata = {
      ...request.classification_metadata,
      created_at: request.classification_metadata.created_at || new Date().toISOString(),
    };

    return {
      code: request.code,
      strategy_name: request.strategy_name,
      strategy_type: request.strategy_type,
      classification_metadata: JSON.stringify(metadata),
      strategy_rules: request.strategy_rules
        ? JSON.stringify(request.strategy_rules)
        : null,
      description: request.description || null,
      user_id: request.user_id,
      // TICKET_661: All new generation produces C++ only
      file_path: `generated/${request.strategy_name}.cpp`,
    };
  }

  /**
   * TICKET_212: Get Kronos AI Entry algorithms
   * Filters by strategy_type=1 (TYPE_EXECUTION) + signal_source='kronos_llm_entry'
   */
  async getKronosAIEntryAlgorithms(): Promise<AlgorithmListResult> {
    try {
      const userId = await getCurrentUserIdAsString();
      const response = await window.electronAPI.database.getAlgorithms({
        userId,
        strategyType: StrategyType.TYPE_EXECUTION,
        signalSourcePrefix: 'kronos_llm_entry',
      });

      if (!response.success || !response.data) {
        console.error('[E:STRATEGY:KRONOS_AI_ENTRY_FETCH_FAILED] [AlgorithmStorageService] Failed to fetch Kronos AI Entry algorithms:', response.error);
        return {
          success: false,
          data: [],
          error: response.error,
        };
      }

      const algorithms = response.data.map(record => ({
        id: record.id,
        code: record.code,
        strategyName: record.strategyName,
        strategyType: record.strategyType,
        description: record.description || undefined,
        classificationMetadata: record.classificationMetadata
          ? JSON.parse(record.classificationMetadata)
          : undefined,
      }));

      return {
        success: true,
        data: algorithms,
      };
    } catch (error) {
      console.error('[E:STRATEGY:KRONOS_AI_ENTRY_FETCH_EXCEPTION] [AlgorithmStorageService] getKronosAIEntryAlgorithms exception:', error);
      return {
        success: false,
        data: [],
        error: {
          code: 'FETCH_EXCEPTION',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Build save request for Kronos Indicator Entry
 */
export function buildKronosIndicatorEntryRequest(
  result: KronosIndicatorEntryResult,
  config: KronosIndicatorEntryConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_EXECUTION,
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.KRONOS_INDICATOR_ENTRY,
      strategy_role: 'execution',
      trading_style: 'indicator_confirmation',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      entry_signal_base: result.entry_signal_base,
      components: {
        kronos_indicator_entry: {
          longEntryIndicators: config.longEntryIndicators,
          shortEntryIndicators: config.shortEntryIndicators,
        },
      },
      tags: ['kronos', 'indicator_entry', result.entry_signal_base],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      entry_signal_base: result.entry_signal_base,
      indicators: {
        long: config.longEntryIndicators,
        short: config.shortEntryIndicators,
      },
    },
  };
}

/**
 * Build save request for Regime Detector
 */
export function buildRegimeDetectorRequest(
  result: RegimeDetectorResult,
  config: RegimeDetectorConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_ANALYSIS,
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: `indicator_detector_${config.regime}`,
      strategy_role: 'market_regime',
      trading_style: 'neutral',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      regime_type: config.regime,
      components: {
        indicator: {
          regime_type: config.regime,
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
        },
      },
      tags: ['indicator', 'regime', 'market-analysis'],
    },
    strategy_rules: {
      regime_type: config.regime,
      indicators: config.indicators || [],
      rules: config.rules || [],
    },
  };
}

/**
 * Build save request for Entry Signal Generator
 * TICKET_210: Fixed strategy_type and signal_source to match backend standard
 */
export function buildEntrySignalRequest(
  result: EntrySignalResult,
  config: EntrySignalConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_ENTRY_SIGNAL,  // TICKET_210: Fix 0 -> 3
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: `indicator_entry_${config.regime}`,  // TICKET_210: Fix to indicator_entry_{base}
      strategy_role: 'execution',
      trading_style: 'indicator_confirmation',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      regime_type: config.regime,
      components: {
        indicator_blocks: config.indicator_blocks || [],
        factor_blocks: config.factor_blocks || [],
      },
      tags: ['entry', 'signal', config.regime],
    },
    strategy_rules: {
      regime_type: config.regime,
      indicator_blocks: config.indicator_blocks || [],
      factor_blocks: config.factor_blocks || [],
    },
  };
}

/**
 * Build save request for Kronos Predictor (TICKET_207)
 * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md Section 9
 */
export function buildKronosPredictorRequest(
  result: KronosPredictorResult,
  config: KronosPredictorConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_ANALYSIS,  // TYPE_ANALYSIS = 9 for Kronos Predictor
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.KRONOS_PREDICTOR,  // 'kronos_prediction'
      strategy_role: 'prediction',
      trading_style: 'ai_driven',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      components: {
        kronos_predictor: {
          model_version: config.model_version,
          lookback: config.lookback,
          pred_len: config.pred_len,
          temperature: config.temperature,
          top_p: config.top_p,
          top_k: config.top_k,
          sample_count: config.sample_count,
        },
        signal_filter: config.signal_filter,
      },
      tags: ['kronos', 'predictor', 'ai', config.model_version],
    },
    strategy_rules: {
      model_version: config.model_version,
      prediction_settings: {
        lookback: config.lookback,
        pred_len: config.pred_len,
      },
      advanced_settings: {
        temperature: config.temperature,
        top_p: config.top_p,
        top_k: config.top_k,
        sample_count: config.sample_count,
      },
      signal_filter: config.signal_filter,
    },
  };
}

/**
 * Build save request for Kronos AI Entry (TICKET_211)
 * LLM-powered entry signal generation using preset modes
 */
export function buildKronosAIEntryRequest(
  result: KronosAIEntryResult,
  config: KronosAIEntryConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_EXECUTION,  // TYPE_EXECUTION = 1 for entry strategies
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.KRONOS_LLM_ENTRY,  // 'kronos_llm_entry'
      strategy_role: 'execution',
      trading_style: 'ai_driven',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      entry_signal_base: 'kronos',
      server_strategy_id: result.strategy_id,
      components: {
        kronos_ai_entry: {
          preset_mode: config.preset_mode,
          bespoke_config: config.bespoke_config,
          prompt: config.prompt,
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
        },
        indicator_context: config.indicators.filter(i => i.indicatorSlug),
      },
      tags: ['kronos', 'ai_entry', 'llm', config.preset_mode],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      entry_signal_base: 'kronos',
      preset_mode: config.preset_mode,
      bespoke_config: config.bespoke_config,
      prompt: config.prompt,
      indicator_context: config.indicators.filter(i => i.indicatorSlug),
    },
  };
}

/**
 * Build save request for Market Observer (TICKET_077_1 page35)
 * Precondition strategy for Trader Mode
 */
export function buildMarketObserverRequest(
  result: MarketObserverResult,
  config: MarketObserverConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_PRECONDITION,  // TYPE_PRECONDITION = 7
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.WATCHLIST,        // 'watchlist'
      strategy_role: 'precondition',
      trading_style: 'observation',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      components: {
        market_observer: {
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
        },
      },
      tags: ['trader', 'observer', 'precondition'],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      indicators: config.indicators || [],
      rules: config.rules || [],
    },
  };
}

/**
 * Trader AI Entry result from API (TICKET_214 page36)
 */
export interface TraderAIEntryResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  created_at?: string;
}

/**
 * Trader AI Entry configuration (TICKET_214 page36)
 */
export interface TraderAIEntryConfig {
  user_id?: string;
  preset_mode: 'baseline' | 'monk' | 'warrior' | 'bespoke';
  bespoke_config?: {
    lookbackBars: number;
    positionLimits: number;
    leverage: number;
    tradingFrequency: number;
    typicalYield: number;
    maxDrawdown: number;
  };
  prompt: string;
  indicators: Array<{
    id: string;
    indicatorSlug: string | null;
    paramValues: Record<string, number | string>;
  }>;
  llm_provider?: string;
  llm_model?: string;
}

/**
 * Build save request for Trader AI Entry (TICKET_214 page36)
 * LLM-powered trader strategy generation with full template management
 */
export function buildTraderAIEntryRequest(
  result: TraderAIEntryResult,
  config: TraderAIEntryConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_EXECUTION,  // TYPE_EXECUTION = 1 for entry strategies
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.LLMTRADER,  // 'llmtrader'
      strategy_role: 'execution',
      trading_style: 'ai_driven',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      entry_signal_base: 'trader',
      components: {
        llm_trader: {
          preset_mode: config.preset_mode,
          bespoke_config: config.bespoke_config,
          prompt: config.prompt,
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
        },
        indicator_context: config.indicators.filter(i => i.indicatorSlug),
      },
      tags: ['trader', 'llmtrader', 'llm', config.preset_mode],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      entry_signal_base: 'trader',
      preset_mode: config.preset_mode,
      bespoke_config: config.bespoke_config,
      prompt: config.prompt,
      indicator_context: config.indicators.filter(i => i.indicatorSlug),
    },
  };
}

// -----------------------------------------------------------------------------
// AI Libero Request Builder (TICKET_077_26 page37)
// -----------------------------------------------------------------------------

interface AILiberoResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  created_at?: string;
}

interface AILiberoConfig {
  user_id?: string;
  preset_mode: string;
  bespoke_config?: {
    lookbackBars: number;
    positionLimits: number;
    leverage: number;
    tradingFrequency: number;
    typicalYield: number;
    maxDrawdown: number;
  };
  prediction_config: {
    batchSize: number;
    warmupPeriod: number;
    lookbackBars: number;
    analysisInterval: number;
  };
  prompt: string;
  indicators: Array<{ indicatorSlug: string | null; paramValues: Record<string, unknown> }>;
  llm_provider?: string;
  llm_model?: string;
}

/**
 * Build save request for AI Libero (TICKET_077_26 page37)
 * Agent Mode LLM-powered strategy generation with advanced prediction config
 */
export function buildAILiberoRequest(
  result: AILiberoResult,
  config: AILiberoConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_EXECUTION,  // TYPE_EXECUTION = 1 for entry strategies
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.AI_LIBERO,  // 'aiLibero'
      strategy_role: 'execution',
      trading_style: 'ai_driven',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      entry_signal_base: 'agent',
      components: {
        ai_libero: {
          preset_mode: config.preset_mode,
          bespoke_config: config.bespoke_config,
          prediction_config: config.prediction_config,
          prompt: config.prompt,
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
        },
        indicator_context: config.indicators.filter(i => i.indicatorSlug),
      },
      tags: ['agent', 'aiLibero', 'llm', config.preset_mode],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      entry_signal_base: 'agent',
      preset_mode: config.preset_mode,
      bespoke_config: config.bespoke_config,
      prediction_config: config.prediction_config,
      prompt: config.prompt,
      indicator_context: config.indicators.filter(i => i.indicatorSlug),
    },
  };
}

// -----------------------------------------------------------------------------
// Risk Override Exit Request Builder (TICKET_274)
// -----------------------------------------------------------------------------

export interface RiskOverrideExitResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  created_at?: string;
}

export interface RiskOverrideExitStorageConfig {
  user_id?: string;
  rules: unknown[];
  hard_safety: { max_loss_percent: number };
  llm_provider?: string;
  llm_model?: string;
}

/**
 * Build save request for Risk Override Exit (TICKET_274)
 * Risk override rules that operate above the Alpha Factory combinator.
 * Saved with usage_type='exit' for Exit Factory integration.
 */
export function buildRiskOverrideExitRequest(
  result: RiskOverrideExitResult,
  config: RiskOverrideExitStorageConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_EXIT_SIGNAL,  // TYPE_EXIT_SIGNAL = 6
    storage_mode: StorageMode.LOCAL,
    classification_metadata: {
      signal_source: SignalSource.RISK_OVERRIDE,  // 'risk_override'
      strategy_role: 'exit_override',
      trading_style: 'risk_management',
      strategy_composition: 'composite',
      class_name: result.class_name,
      components: {
        risk_override: {
          rule_count: config.rules.length,
          hard_safety: config.hard_safety,
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
        },
      },
      tags: ['exit', 'risk_override'],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      rules: config.rules,
      hard_safety: config.hard_safety,
    },
  };
}

// -----------------------------------------------------------------------------
// Strategy Catalog Request Builder (TICKET_994)
// -----------------------------------------------------------------------------

export interface CatalogStrategyResult {
  strategy_name: string;
  strategy_code: string;
  class_name: string;
  created_at?: string;
}

export interface CatalogStrategyConfig {
  user_id?: string;
  catalog_id: string;
  category: string;
  llm_provider?: string;
  llm_model?: string;
  customization?: {
    preference?: string;
    timeframe?: string;
    riskLevel?: string;
  };
}

export function buildCatalogSaveRequest(
  result: CatalogStrategyResult,
  config: CatalogStrategyConfig,
  userId: string
): AlgorithmSaveRequest {
  return {
    strategy_name: result.strategy_name,
    code: result.strategy_code,
    user_id: userId,
    strategy_type: StrategyType.TYPE_EXECUTION,
    storage_mode: StorageMode.LOCAL,
    language: 'cpp',
    classification_metadata: {
      signal_source: `strategy_catalog_${config.category}`,
      strategy_role: 'execution',
      trading_style: 'catalog_generated',
      strategy_composition: 'atomic',
      class_name: result.class_name,
      components: {
        catalog: {
          catalog_id: config.catalog_id,
          category: config.category,
          llm_provider: config.llm_provider,
          llm_model: config.llm_model,
          customization: config.customization,
        },
      },
      tags: ['catalog', config.category, config.catalog_id],
      created_at: result.created_at || new Date().toISOString(),
    },
    strategy_rules: {
      catalog_id: config.catalog_id,
      category: config.category,
      customization: config.customization || {},
    },
  };
}

/**
 * Extract class name from generated Python code
 */
export function extractClassName(code: string): string {
  // Match Python class X( or C++ class X : / class X {
  const classMatch = code.match(/class\s+(\w+)\s*[({:]/);
  return classMatch ? classMatch[1] : 'GeneratedStrategy';
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Get singleton instance of AlgorithmStorageService
 */
export function getAlgorithmStorageService(): AlgorithmStorageService {
  return AlgorithmStorageService.getInstance();
}
