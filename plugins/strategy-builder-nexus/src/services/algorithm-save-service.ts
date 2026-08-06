/**
 * Algorithm Save Service
 *
 * Reusable service for saving generated algorithms to the database.
 * Used across multiple pages (RegimeDetector, EntrySignal, etc.)
 *
 * Implements unified format standards:
 * @see TICKET_077_COMPONENT7_SAVE_MISSING
 * @see TICKET_117_1 - Unified Data Hub Pattern
 * @see REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md - WordPress Database Standard
 * @see STRATEGY_GENERATION_RESPONSE_FORMAT_STANDARD.md - Unified Response Format
 *
 * Key Standards Compliance:
 * - strategy_code: Direct Python code string (NOT nested JSON)
 * - classification_metadata: Follows WordPress standard with signal_source, strategy_role, etc.
 * - strategy_rules: Follows WordPress standard with regime_type, indicators, rules, etc.
 */

import i18n from 'i18next';
import { INTERVAL_1h } from '@StratCraft/types';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Algorithm data structure matching nona_algorithms table schema
 *
 * @see REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md Section 6.1
 */
export interface AlgorithmSaveData {
  /** LLM-generated Python/strategy code (NOT an identifier!) */
  code: string;
  /** Display name of the strategy */
  strategy_name: string;
  /** Strategy type (9=Regime Detector/Analysis, 4=Pre-condition, etc.) */
  strategy_type: number;
  /** JSON metadata following WordPress standard format */
  classification_metadata: string;
  /** JSON strategy rules following WordPress standard format */
  strategy_rules?: string;
  /** Description of the algorithm */
  description?: string;
  /** Owner user ID */
  user_id: string;
  /** Optional file path */
  file_path?: string;
}

/**
 * Configuration for algorithm generation
 */
export interface AlgorithmGenerationConfig {
  /** Strategy name from user input */
  strategy_name: string;
  /** Strategy type (9=Regime Detector, 10=Entry Signal, etc.) */
  strategy_type: number;
  /** Generated Python/strategy code */
  generated_code: string;
  /** Classification metadata (regime type, indicators, etc.) */
  metadata: Record<string, any>;
  /** Optional strategy rules */
  rules?: Record<string, any>;
  /** Optional description */
  description?: string;
  /** Optional user ID (defaults to 'default') */
  user_id?: string;
}

/**
 * Result of save operation
 */
export interface AlgorithmSaveResult {
  success: boolean;
  data?: {
    id: number;
    code: string;
    strategy_name: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract class name from generated Python code
 *
 * @param code - Generated Python code
 * @returns Extracted class name or default value
 */
function extractClassName(code: string): string {
  const classMatch = code.match(/class\s+(\w+)\s*\(/);
  return classMatch ? classMatch[1] : 'GeneratedStrategy';
}


/**
 * Generate signal_source based on regime type
 *
 * @see REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md Section 5.2
 * @param regimeType - Regime type (trend, range, etc.)
 * @returns Signal source string
 */
function generateSignalSource(regimeType: string): string {
  return `indicator_detector_${regimeType}`;
}

/**
 * Build classification_metadata following WordPress standard format
 *
 * Implements the standard structure for algorithm classification:
 * @see REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md Section 6.2
 * @see STRATEGY_GENERATION_RESPONSE_FORMAT_STANDARD.md Line 364-369
 *
 * Standard fields (REQUIRED):
 * - signal_source: Generated via generateSignalSource() (e.g., "indicator_detector_trend")
 * - strategy_role: "market_regime" for Regime Detector
 * - trading_style: "neutral" for market regime detection
 *
 * Extended fields (WordPress standard):
 * - class_name: Extracted from generated Python code
 * - strategy_composition: "atomic" (single-purpose strategy)
 * - components.indicator: Detailed indicator configuration
 * - tags: Searchable tags array
 * - created_at: ISO 8601 timestamp
 *
 * @param config - Algorithm generation configuration
 * @param className - Extracted class name from Python code
 * @returns Standard classification_metadata object
 */
function buildClassificationMetadata(
  config: AlgorithmGenerationConfig,
  className: string
): Record<string, any> {
  const regimeType = config.metadata.regime || 'generic';
  // TICKET_638: No NONA fallback -- preserve actual provider from generation context
  const llmProvider = config.metadata.llm_provider || '';

  return {
    // Core classification fields (STRATEGY_GENERATION_RESPONSE_FORMAT_STANDARD)
    class_name: className,
    signal_source: generateSignalSource(regimeType),  // "indicator_detector_{regime}"
    strategy_role: 'market_regime',
    trading_style: 'neutral',

    // Extended WordPress fields (REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL)
    strategy_composition: 'atomic',
    components: {
      indicator: {
        regime_type: regimeType,
        llm_provider: llmProvider,
        llm_model: config.metadata.llm_model,
      },
    },
    tags: ['indicator', 'regime', 'market-analysis'],
    created_at: new Date().toISOString(),
  };
}

/**
 * Build strategy_rules following WordPress standard format
 *
 * Implements the standard structure for strategy rules blueprint:
 * @see REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md Section 6.3
 *
 * Standard fields:
 * - regime_type: Type of market regime (trend, range, consolidation, etc.)
 * - entry_conditions: Array of entry condition rules (empty for regime detector)
 * - exit_conditions: Array of exit condition rules (empty for regime detector)
 * - indicators: Array of indicator names used (e.g., ["EMA", "ATR"])
 * - rules: Array of template-based rules with indicator/strategy/logic
 * - factors: Configuration factors (timeframe, sensitivity, etc.)
 *
 * @param config - Algorithm generation configuration
 * @returns Standard strategy_rules object
 */
function buildStrategyRules(config: AlgorithmGenerationConfig): Record<string, any> {
  const regimeType = config.metadata.regime || 'generic';

  return {
    regime_type: regimeType,
    entry_conditions: [],
    exit_conditions: [],
    indicators: config.rules?.indicators || [],
    rules: config.rules?.rules || [],
    factors: config.rules?.factors || {
      timeframe: INTERVAL_1h,
      sensitivity: 'medium',
    },
  };
}

/**
 * Map generation config to database save format
 *
 * Implements unified format standards from multiple sources:
 * @see REGIME_DETECTOR_LLM_TO_DATABASE_PROTOCOL.md Section 6.1 - WordPress Database Standard
 * @see STRATEGY_GENERATION_RESPONSE_FORMAT_STANDARD.md Line 340-390 - Unified Format
 *
 * Key Compliance Points:
 * 1. code field: Direct Python code string (NOT identifier, NOT nested JSON)
 * 2. classification_metadata: Standard structure with signal_source, strategy_role, etc.
 * 3. strategy_rules: Standard structure with regime_type, indicators, rules, etc.
 * 4. All JSON fields properly stringified for SQLite TEXT storage
 *
 * Field Mapping:
 * - code <- config.generated_code (LLM-generated Python code)
 * - strategy_name <- config.strategy_name (user input)
 * - strategy_type <- config.strategy_type (9 for Regime Detector)
 * - classification_metadata <- buildClassificationMetadata() (standard format)
 * - strategy_rules <- buildStrategyRules() (standard format)
 * - description <- config.description (optional)
 * - user_id <- config.user_id || 'default'
 * - file_path <- "generated/{strategy_name}.cpp" (nonabt C++) or ".py" (Python)
 *
 * @param config - Generation configuration from RegimeDetectorPage
 * @returns Algorithm save data ready for database insertion
 */
function mapConfigToSaveData(config: AlgorithmGenerationConfig): AlgorithmSaveData {
  // Extract class name from generated Python code
  const className = extractClassName(config.generated_code);

  // Build standard classification_metadata (follows WordPress + Unified standard)
  const classificationMetadata = buildClassificationMetadata(config, className);

  // Build standard strategy_rules (follows WordPress standard)
  const strategyRules = buildStrategyRules(config);

  return {
    // CRITICAL: Store LLM-generated Python code in 'code' field
    // NOT an identifier, NOT nested JSON, direct Python code string
    // Complies with: STRATEGY_GENERATION_RESPONSE_FORMAT_STANDARD Line 403
    code: config.generated_code,

    strategy_name: config.strategy_name,
    strategy_type: config.strategy_type,

    // JSON fields: Stringify for SQLite TEXT storage
    classification_metadata: JSON.stringify(classificationMetadata),
    strategy_rules: JSON.stringify(strategyRules),

    description: config.description,
    user_id: config.user_id || 'default',

    // TICKET_661: All new generation produces C++ only
    file_path: `generated/${config.strategy_name}.cpp`,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Save generated algorithm to database via Hub API
 *
 * This function provides a unified interface for saving algorithms
 * across all plugin pages. It handles:
 * - Generating unique algorithm codes
 * - Mapping configuration to database schema
 * - Calling Hub API with proper plugin context
 * - Error handling and notifications
 *
 * @param config - Algorithm generation configuration
 * @param pluginId - Plugin ID (default: 'com.stratcraft.strategy-builder-nexus')
 * @returns Save result with success/error status
 *
 * @example
 * ```typescript
 * const result = await saveAlgorithm({
 *   strategy_name: 'Trend Following',
 *   strategy_type: 9,
 *   generated_code: pythonCode,
 *   metadata: { regime: 'trend', llm_provider: 'CLAUDE' },
 * });
 *
 * if (result.success) {
 *   console.log('Saved:', result.data);
 * }
 * ```
 */
export async function saveAlgorithm(
  config: AlgorithmGenerationConfig,
  pluginId = 'com.stratcraft.strategy-builder-nexus'
): Promise<AlgorithmSaveResult> {
  try {
    // Map config to database format
    const algorithmData = mapConfigToSaveData(config);

    console.log('[AlgorithmSaveService] Saving algorithm:', {
      code: algorithmData.code,
      name: algorithmData.strategy_name,
      type: algorithmData.strategy_type,
    });

    // Call Hub API to save
    const response = await window.electronAPI.hub.invokeEntity(
      'save',
      'nona_algorithm',
      algorithmData,
      pluginId
    );

    if (response.success) {
      console.log('[AlgorithmSaveService] Algorithm saved successfully:', response.data);

      // Show success notification
      window.nexus?.window?.showNotification(
        i18n.t('notifications.strategySavedSuccess', { name: config.strategy_name, ns: 'strategy-builder' }),
        'success'
      );

      return {
        success: true,
        data: response.data,
      };
    } else {
      console.error('[E:STRATEGY:ALGO_SAVE_FAILED] [AlgorithmSaveService] Save failed:', response.error);

      // Show error notification
      window.nexus?.window?.showNotification(
        i18n.t('errors.saveFailed', { ns: 'strategy-builder' }),
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
    console.error('[E:STRATEGY:ALGO_SAVE_EXCEPTION] [AlgorithmSaveService] Exception during save:', error);

    // Show error notification
    window.nexus?.window?.showNotification(
      i18n.t('errors.saveFailed', { ns: 'strategy-builder' }),
      'error'
    );

    return {
      success: false,
      error: {
        code: 'EXCEPTION',
        message: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
      },
    };
  }
}

/**
 * Save algorithm without showing notifications
 *
 * Use this for batch operations or when you want to handle
 * notifications manually.
 *
 * @param config - Algorithm generation configuration
 * @param pluginId - Plugin ID
 * @returns Save result
 */
export async function saveAlgorithmSilent(
  config: AlgorithmGenerationConfig,
  pluginId = 'com.stratcraft.strategy-builder-nexus'
): Promise<AlgorithmSaveResult> {
  try {
    const algorithmData = mapConfigToSaveData(config);

    console.log('[AlgorithmSaveService] Saving algorithm (silent):', {
      code: algorithmData.code,
      name: algorithmData.strategy_name,
      type: algorithmData.strategy_type,
    });

    const response = await window.electronAPI.hub.invokeEntity(
      'save',
      'nona_algorithm',
      algorithmData,
      pluginId
    );

    if (response.success) {
      console.log('[AlgorithmSaveService] Algorithm saved successfully:', response.data);
      return {
        success: true,
        data: response.data,
      };
    } else {
      console.error('[E:STRATEGY:ALGO_SAVE_FAILED] [AlgorithmSaveService] Save failed:', response.error);
      return {
        success: false,
        error: response.error || {
          code: 'SAVE_FAILED',
          message: i18n.t('MSG_GENERIC_ERROR', { ns: 'errors' }),
        },
      };
    }
  } catch (error) {
    console.error('[E:STRATEGY:ALGO_SAVE_EXCEPTION] [AlgorithmSaveService] Exception during save:', error);
    return {
      success: false,
      error: {
        code: 'EXCEPTION',
        message: error instanceof Error ? error.message : i18n.t('MSG_UNKNOWN_ERROR', { ns: 'errors' }),
      },
    };
  }
}
