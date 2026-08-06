/**
 * Plugin Services Exports (TICKET_091)
 */

export {
  executeMarketRegimeAnalysis,
  validateMarketRegimeConfig,
  getErrorMessage,
} from './market-regime-service';

export type {
  MarketRegimeConfig,
  MarketRegimeRule,
  MarketRegimeResult,
} from './market-regime-service';

// =============================================================================
// Regime Indicator Entry Service (TICKET_203) - Correct API for Entry Signals
// =============================================================================

export {
  executeRegimeIndicatorEntry,
  validateRegimeIndicatorEntryConfig,
  getEntryErrorMessage,
} from './regime-indicator-entry-service';

export type {
  RegimeIndicatorEntryConfig,
  IndicatorEntryRule,
  RegimeIndicatorEntryResult,
} from './regime-indicator-entry-service';

// =============================================================================
// Kronos Indicator Entry Service (TICKET_208) - Kronos Mode Entry Signals
// =============================================================================

export {
  executeKronosIndicatorEntry,
  validateKronosIndicatorEntryConfig,
  getKronosEntryErrorMessage,
} from './kronos-indicator-entry-service';

export type {
  KronosIndicatorEntryConfig,
  KronosIndicatorRule,
  KronosIndicatorEntryResult,
} from './kronos-indicator-entry-service';

// =============================================================================
// Kronos AI Entry Service (TICKET_211) - LLM-powered Entry Signals
// =============================================================================

export {
  executeKronosAIEntry,
  validateKronosAIEntryConfig,
  getKronosAIEntryErrorMessage,
  getDefaultBespokeConfig,
  getPresetModeDescription,
} from './kronos-ai-entry-service';

export type {
  KronosAIEntryConfig,
  KronosAIEntryResult,
  TraderPresetMode,
  BespokeConfig,
  RawIndicatorBlock,
} from './kronos-ai-entry-service';

// =============================================================================
// Risk Override Exit Service (TICKET_274) - Risk Manager Exit Generation
// =============================================================================

export {
  executeRiskOverrideExit,
  validateRiskOverrideExitConfig,
  getExitErrorMessage,
  MAX_RISK_RULES,
  RISK_RULE_TYPES,
  CB_SCOPES,
  RULE_ACTIONS,
  TIME_UNITS,
  DECAY_SCHEDULES,
  RECOVERY_MODES,
  INDICATOR_CONDITIONS,
  DIRECTION_OPTIONS,
  RULE_DEFAULTS,
} from './risk-override-exit-service';

export type {
  RiskOverrideExitConfig,
  RiskOverrideExitResult,
  RiskOverrideRule,
  RiskRuleType,
  CircuitBreakerRule,
  TimeLimitRule,
  RegimeDetectionRule,
  DrawdownLimitRule,
  IndicatorGuardRule,
  IndicatorExitState,
} from './risk-override-exit-service';

// =============================================================================
// Algorithm Storage Service (TICKET_077_D1) - NEW Centralized Service
// =============================================================================

export {
  // Service
  AlgorithmStorageService,
  getAlgorithmStorageService,
  // Enums
  StorageMode,
  StrategyType,
  SignalSource,
  // Factory functions
  buildKronosIndicatorEntryRequest,
  buildRegimeDetectorRequest,
  buildEntrySignalRequest,
  buildKronosPredictorRequest,
  buildKronosAIEntryRequest,
  buildRiskOverrideExitRequest,
  buildCatalogSaveRequest,
  extractClassName,
} from './algorithm-storage-service';

export type {
  AlgorithmSaveRequest,
  AlgorithmSaveResult,
  ClassificationMetadata,
  // TICKET_212: Algorithm list types
  AlgorithmListItem,
  AlgorithmListResult,
  // Note: Storage types are for algorithm-storage-service internal use
  // Use RegimeIndicatorEntryResult/Config from regime-indicator-entry-service for API calls
  RegimeDetectorResult,
  RegimeDetectorConfig,
  EntrySignalResult,
  EntrySignalConfig,
  KronosPredictorResult,
  KronosPredictorConfig,
  // TICKET_211: Kronos AI Entry storage types
  KronosAIEntryResult as StorageKronosAIEntryResult,
  KronosAIEntryConfig as StorageKronosAIEntryConfig,
  // TICKET_274: Risk Override Exit storage types
  RiskOverrideExitResult as StorageRiskOverrideExitResult,
  RiskOverrideExitStorageConfig,
  // TICKET_994: Strategy Catalog storage types
  CatalogStrategyResult,
  CatalogStrategyConfig as StorageCatalogStrategyConfig,
} from './algorithm-storage-service';

// =============================================================================
// Legacy Algorithm Save Service (DEPRECATED - use AlgorithmStorageService)
// =============================================================================

/** @deprecated Use getAlgorithmStorageService().save() instead */
export {
  saveAlgorithm,
  saveAlgorithmSilent,
} from './algorithm-save-service';

/** @deprecated Use AlgorithmSaveRequest instead */
export type {
  AlgorithmSaveData,
  AlgorithmGenerationConfig,
  AlgorithmSaveResult as LegacyAlgorithmSaveResult,
} from './algorithm-save-service';

// =============================================================================
// Vibing Chat Service (ISSUE_7029) - AI Strategy Studio Backend Communication
// =============================================================================

export {
  executeVibingChat,
  executeVibingChatAction,
  getVibingChatErrorMessage,
  extractStrategyCode,
} from './vibing-chat-service';

export type {
  VibingChatAction,
  VibingChatRequest,
  VibingChatResult,
  VibingChatResponse,
  StrategyRulesResponse,
  EntryCondition,
  ExitCondition,
  StrategyIndicator,
  RiskManagement,
} from './vibing-chat-service';
