/**
 * @StratCraft/types - Shared TypeScript types for StratCraft
 */

export * from './agent-permission-authority';

export type {
  LstmFitQualityAssessment,
  LstmFitQualityAssessmentClassification,
  LstmFitQualityComparison,
  LstmFitQualityConstructionErrorCode,
  LstmFitQualityConstructionErrorPayload,
  LstmFitQualityGateSummary,
  LstmFitQualityProcessState,
  LstmFitQualityReport,
  LstmFitQualityReportRequest,
  LstmFitQualityReadResult,
  LstmFitQualityVersionReport,
} from './lstm-fit-quality-report';
export {
  assessFitQuality,
  DEFAULT_LSTM_FIT_QUALITY_CONFIG,
} from './lstm-fit-quality-contract';
export type {
  DataSufficiency,
  FitQuality,
  FitQualityConfig,
  FitQualityThresholds,
} from './lstm-fit-quality-contract';

export type {
  GuideProviderKind,
  GuideProviderAvailability,
  GuideToolbarProvider,
  GuideToolbarGroup,
  GuideLlmSelection,
  GuideToolbarConfig,
  SetLlmSelectionResult,
  GuideCredentialValidationStatus,
  GuideLlmSettingsProvider,
  GuideLlmSettingsConfig,
  SetLlmCredentialInput,
  SetLlmCredentialResult,
  LlmSettingsMutationResult,
  RefreshLlmModelsResult,
} from './guide-toolbar';
export {
  GUIDE_PLUGIN_WEBUI_PAGE_BY_ID,
  getGuidePluginWebuiPage,
} from './guide-plugin-pages';
export type { GuidePluginWebuiPage } from './guide-plugin-pages';
export {
  AGENT_RUNTIME_CONTRACT_VERSION,
  AGENT_FINGERPRINT_SCHEMA_VERSION,
  NORMALIZED_AGENT_EVENT_CONTRACT_VERSION,
  AGENT_USAGE_CONTRACT_VERSION,
  NORMALIZED_AGENT_EVENT_TYPES,
  AGENT_VISUALIZATION_KINDS,
  AGENT_RUNTIME_IDS,
  AGENT_ENTITLEMENT_SOURCES,
  canonicalAgentJson,
} from './agent-runtime';
export {
  AGENT_VISUAL_TOOL_NAMES,
  projectAgentToolVisualization,
  projectAgentToolVisualizationText,
  deriveFactorMiningLaunch,
  FACTOR_MINING_CONFIRM_TOOL,
  FACTOR_MINING_START_TOOL,
} from './agent-tool-visualization';
export type {
  AgentToolVisualization,
  FactorMiningLaunchContinuation,
} from './agent-tool-visualization';
export {
  RESEARCH_TASK_SCHEMA_VERSION,
  RESEARCH_TASK_SPEC_SCHEMA_ID,
  RESEARCH_TASK_TITLE_MAX_CHARS,
  RESEARCH_TASK_INTENT_MAX_CHARS,
  RESEARCH_TASK_INPUT_ARTIFACT_MAX_ITEMS,
  RESEARCH_TASK_SPEC_V1_JSON_SCHEMA,
  artifactReferenceV1Schema,
  evidenceRequirementV1Schema,
  completionCriterionV1Schema,
  researchTaskSpecV1Schema,
  researchTaskDraftV1Schema,
  parseResearchTaskSpecV1,
  parseResearchTaskDraftV1,
} from './research-task';
export {
  CANDIDATE_ARTIFACT_SCHEMA_VERSION,
  ACCEPTED_ARTIFACT_SCHEMA_VERSION,
  ARTIFACT_ADMISSION_RESULT_SCHEMA_VERSION,
  CANDIDATE_ARTIFACT_MANIFEST_V1_JSON_SCHEMA,
  candidateArtifactFileV1Schema,
  candidateStrategyArtifactManifestV1Schema,
  candidateSignalArtifactManifestV1Schema,
  candidateArtifactManifestV1Schema,
  acceptedArtifactManifestV1Schema,
  parseCandidateArtifactManifestV1,
} from './artifact';
export type {
  CandidateArtifactFileV1,
  CandidateArtifactManifestV1,
  AcceptedArtifactManifestV1,
} from './artifact';
export {
  RESEARCH_WORKER_PROTOCOL_VERSION,
  RESEARCH_WORKER_PROTOCOL_MAJOR,
  RESEARCH_WORKER_CONTRACT_SCHEMA_VERSION,
  RESEARCH_WORKER_DISCOVERY_SCHEMA_VERSION,
  RESEARCH_WORKER_PACKAGE_SCHEMA_VERSION,
  RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION,
  RESEARCH_DISCOVERY_OPERATION_CONTRACT_VERSION,
  RESEARCH_WORKER_CONTROL_TRANSPORT,
  RESEARCH_WORKER_BULK_FORMATS,
  RESEARCH_WORKER_PLATFORMS,
  RESEARCH_WORKER_CAPABILITY_IDS,
  RESEARCH_WORKER_PYTHON_ENTRY_COMMANDS,
  isResearchWorkerPythonEntryCommand,
  RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES,
  RESEARCH_WORKER_MAX_DATA_REFERENCES,
  RESEARCH_WORKER_MAX_ARTIFACT_REFERENCES,
  RESEARCH_WORKER_MAX_CAPABILITIES,
  RESEARCH_WORKER_MAX_PACKAGE_FILES,
  RESEARCH_WORKER_MAX_RUNTIME_PATHS,
  researchWorkerCapabilityIdSchema,
  researchWorkerPlatformSchema,
  researchWorkerProtocolRangeSchema,
  researchWorkerWindowSchema,
  researchWorkerDataReferenceSchema,
  researchWorkerResourcePlanSchema,
  researchWorkerDiscoveryDescriptorSchema,
  researchWorkerHostDiscoverySchema,
  researchWorkerPackageManifestSchema,
  researchWorkerExecuteRequestSchema,
  researchDiscoveryOperationRequestSchema,
  researchDiscoveryOperationResultSchema,
  researchWorkerControlMessageSchema,
  RESEARCH_WORKER_CONTROL_MESSAGE_V1_JSON_SCHEMA,
  RESEARCH_WORKER_DISCOVERY_V1_JSON_SCHEMA,
  RESEARCH_WORKER_PACKAGE_V1_JSON_SCHEMA,
  RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA,
  RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA,
  negotiateResearchWorkerProtocol,
  parseResearchWorkerControlMessage,
} from './research-worker-protocol';
export {
  RESEARCH_WORKER_HOST_MODULE_REGISTER_EXPORT,
} from './research-worker-host-module';
export type {
  ResearchWorkerHostModuleRegistrationContext,
  ResearchWorkerExecutionPolicy,
  ResearchWorkerExecutionSurface,
  ResearchWorkerHostModuleRegistrar,
} from './research-worker-host-module';
export {
  COMMERCIAL_OPERATION_CONTRACT_VERSION,
  COMMERCIAL_HOST_REGISTRATION_CONTRACT_VERSION,
  COMMERCIAL_HOST_ROLES,
  COMMERCIAL_OPERATION_IDS,
  COMMERCIAL_OPERATION_INVENTORY,
  COMMERCIAL_LLM_PURPOSES,
  commercialHostRoleSchema,
  commercialOperationIdSchema,
  commercialOperationRequestSchema,
  commercialOperationProgressSchema,
  commercialOperationResultSchema,
  commercialCapabilityProjectionSchema,
  commercialOperationInventoryEntrySchema,
  COMMERCIAL_OPERATION_REQUEST_V1_JSON_SCHEMA,
  COMMERCIAL_OPERATION_RESULT_V1_JSON_SCHEMA,
  COMMERCIAL_OPERATION_PROGRESS_V1_JSON_SCHEMA,
  COMMERCIAL_CAPABILITY_PROJECTION_V1_JSON_SCHEMA,
} from './commercial-operation';
export type {
  CommercialHostRole,
  CommercialOperationId,
  CommercialOperationRequest,
  CommercialOperationResult,
  CommercialOperationProgress,
  CommercialCapabilityProjection,
  CommercialOperationInventoryEntry,
  CommercialOperationExecutionContext,
  CommercialJsonValue,
  CommercialJsonObject,
  CommercialEntitlementDecision,
  CommercialWindowedDatasetRequest,
  CommercialStorageTransactionResult,
  CommercialStorageTransactionValue,
  CommercialOperationHostServices,
  CommercialResourcePlanDecision,
  CommercialLlmGenerateRequest,
  CommercialLlmPurpose,
  CommercialOperationRegistration,
  CommercialHostRegistrationTransaction,
  CommercialHostModuleRegistrar,
} from './commercial-operation';
export type {
  ResearchWorkerCompatibilityResult,
  ResearchWorkerControlMessage,
  ResearchWorkerExecuteRequest,
  ResearchWorkerResourcePlan,
  ResearchWorkerDataReference,
  ResearchWorkerDiscoveryDescriptor,
  ResearchWorkerHostDiscovery,
  ResearchWorkerPackageManifest,
  ResearchDiscoveryOperationRequest,
  ResearchDiscoveryOperationResult,
} from './research-worker-protocol';
export {
  EXTENSION_BRIDGE_CONTRACT_VERSION,
  extensionCapabilityRequestSchema,
  extensionInvocationSchema,
  extensionSubscriptionSchema,
  extensionEventSchema,
} from './extension-bridge';
export type {
  ExtensionJsonValue,
  ExtensionCapabilityRequest,
  ExtensionInvocation,
  ExtensionSubscription,
  ExtensionEvent,
} from './extension-bridge';
export type {
  ArtifactReferenceV1,
  EvidenceRequirementV1,
  CompletionCriterionV1,
  ResearchTaskSpecV1,
  ResearchTaskDraftV1,
} from './research-task';
export type {
  AgentRuntimeId,
  EntitlementSource,
  AgentRuntimeAuthMethod,
  AgentRuntimeOperatingSystem,
  AgentRuntimeDescriptor,
  AgentRuntimeCapabilities,
  AgentRuntimeStatus,
  VersionedContentReference,
  PermissionPolicyReference,
  ResearchPolicyReference,
  CapabilityProfileReference,
  TaskWorkspaceIdentity,
  ResearchTaskIdentity,
  ToolCapabilityRequest,
  AdmittedToolDefinition,
  ToolCapabilityGrant,
  AgentInferenceRoute,
  GuideAgentSelection,
  GuideAgentRuntimeSnapshot,
  GuideAgentChoiceAvailability,
  GuideAgentChoice,
  GuideAgentRuntimeChoice,
  GuideAgentChoiceCatalog,
  AgentUsageSource,
  AgentUsageCompleteness,
  AgentInferencePayerClass,
  AgentFailureStage,
  AgentUsageV1,
  NormalizedAgentEventEnvelope,
  AgentPlanItemV1,
  AgentPermissionScopeV1,
  ArtifactAdmissionStageV1,
  AgentVisualizationKind,
  AgentToolExecutionState,
  AgentTerminalReason,
  AgentOutcomeSeverity,
  AgentOutcomeParameter,
  AgentOutcomePresentationV1,
  AgentToolOutcomeV1,
  NormalizedAgentEventPayloadMap,
  NormalizedAgentEventType,
  NormalizedAgentEvent,
  NormalizedAgentEventSink,
  AdmittedAgentTurnContext,
  AgentAdmissionErrorCode,
  AgentAdmissionFieldDelta,
  AgentAdmissionErrorDetail,
  AgentRuntimeSession,
  AgentRuntimeTurnRequest,
  AgentRuntimeAdapter,
} from './agent-runtime';
export {
  INFERENCE_ATTRIBUTION_SCHEMA_VERSION,
  GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION,
  GOVERNANCE_EVIDENCE_ENVELOPE_VERSION,
  GOVERNANCE_EVIDENCE_SCHEMA_VERSION,
  GOVERNANCE_MAX_POLICIES,
  GOVERNANCE_MAX_GATES,
  GOVERNANCE_MAX_DEPENDENCY_HASHES,
  GOVERNANCE_MAX_IDENTIFIER_CHARS,
  GOVERNANCE_MAX_VERSION_CHARS,
  GOVERNANCE_MAX_ENVELOPE_BYTES,
  GOVERNANCE_MAX_METRIC_VALUE,
  agentUsageV1Schema,
  inferenceAttributionV1Schema,
  governanceAttributionV1Schema,
  governanceAssuranceLevelSchema,
  governanceSubmissionStateSchema,
  governanceOperationSchema,
  governedHashSchema,
  governanceGateResultSchema,
  governanceEvidenceEnvelopeV1Schema,
  projectGovernanceAttribution,
  GOVERNANCE_EVIDENCE_ENVELOPE_V1_JSON_SCHEMA,
} from './agent-attribution';
export type {
  InferenceAttributionStatus,
  InferenceAttributionV1,
  GovernanceAssuranceLevel,
  GovernanceSubmissionState,
  GovernanceOperation,
  GovernanceAttributionV1,
  GovernanceAttributionMessageKey,
  GovernanceAttributionPresentationV1,
  GovernanceGateResultV1,
  GovernanceEvidenceEnvelopeV1,
  GovernanceEvidenceEnvelopeDraftV1,
} from './agent-attribution';
export {
  GUIDE_COMPLETION_PATH,
  GUIDE_COMPLETION_CONTRACT_VERSION,
  GUIDE_COMPLETION_CONTRACT_SHA256,
  GUIDE_COMPLETION_BACKEND_SOURCE_SHA256,
  parseGuideCompletionEvent,
  parseGuideCompletionError,
} from './guide-completion';
export type {
  GuideCompletionErrorCode,
  GuideCompletionError,
  GuideCompletionRoute,
  GuideCompletionContentBlock,
  GuideCompletionMessage,
  GuideCompletionTool,
  GuideCompletionRequest,
  GuideCompletionEvent,
} from './guide-completion';
export {
  DEFAULT_LOCALE as SHARED_DEFAULT_LOCALE,
  SUPPORTED_LOCALE_RECORDS,
  normalizeSupportedLocale,
  type SupportedLocaleRecord,
} from './locale-registry';
export {
  REGIME_OPTIONS,
  DEFAULT_REGIME_ID,
  DEFAULT_REGIME_STRATEGY_NAME,
  MAX_STRATEGY_NAME_LENGTH,
  DEFAULT_STRATEGY_INDICATOR_LIMIT,
  MAX_STRATEGY_INDICATOR_LIMIT,
  BATCH_GENERATION_QUANTITY_MIN,
  BATCH_GENERATION_QUANTITY_MAX,
  BATCH_GENERATION_MAX_INDICATORS,
  STRATEGY_GENERATION_ENDPOINT_PAIRS,
  STRATEGY_GENERATION_ENDPOINTS,
  isStrategyGenerationEndpoint,
  isStrategyGenerationEndpointPair,
  STRATEGY_INDICATOR_CATALOG,
  STRATEGY_TEMPLATE_CATALOG,
  isRegimeId,
  getRegimeOption,
  findStrategyIndicator,
  getStrategyTemplate,
  listStrategyIndicators,
  resolveStrategyIndicatorConfigurations,
  resolveRegimeStrategyName,
  mapRegimeToCaseType,
  buildRegimeStrategyGenerationRequest,
  buildVibingChatGenerationRequest,
} from './strategy-generation-contract';
export type {
  RegimeId,
  StrategyIndicatorParameter,
  StrategyIndicatorDefinition,
  StrategyIndicatorProjection,
  StrategyIndicatorSelection,
  StrategyIndicatorGenerationConfig,
  StrategyTemplateOperator,
  StrategyTemplateDefinition,
  ListStrategyIndicatorsInput,
  RegimeStrategyGenerationRequestInput,
  VibingChatPayloadInput,
} from './strategy-generation-contract';

// ============================================================================
// TICKET_1023_4: Tier-0 API URL / domain constants
// ============================================================================

export {
  DESKTOP_API_BASE_URL,
  AUTH_SERVER_BASE_URL,
  STRATCRAFT_WEBSITE_URL,
  AUTH_UPGRADE_URL,
  AUTH_PRICING_URL,
  WEBSITE_PRICING_URL,
  GLITCHTIP_INGEST_HOST,
} from './api-config';

// ============================================================================
// TICKET_1030_7: Tier-0 API route path constants
// ============================================================================

export {
  API_BACKTEST_LIST,
  API_BACKTEST_RESULT,
  API_BACKTEST_RUN,
  API_BACKTEST_STATUS,
  API_STRATEGY_LIST,
  API_STRATEGY_GET,
  API_STRATEGY_GENERATE,
  API_STRATEGY_PERSIST,
  API_STRATEGY_GENERATE_ENTRY,
  API_STRATEGY_GENERATE_EXIT,
  API_STRATEGY_GENERATE_KRONOS,
  API_STRATEGY_GENERATE_AI_LIBERO,
  API_STRATEGY_GENERATE_AI_STUDIO,
  API_AI_STUDIO_SESSION_START,
  API_AI_STUDIO_SESSION_CONTINUE,
  API_AI_STUDIO_SESSION_ACTION,
  API_STRATEGY_DELETE,
  API_STRATEGY_COMPILE,
  API_STRATEGY_COMPILATION_STATUS,
  API_STRATEGY_VALIDATION_REPORT,
  API_STRATEGY_TOOLCHAIN_STATUS,
  API_STRATEGY_SAVE,
  API_STRATEGY_LOAD,
  API_STRATEGY_GENERATE_WORKFLOW,
  API_GENERATION_SESSION_START,
  API_GENERATION_SESSION_CANCEL,
  API_GENERATION_SESSION_STATE,
  API_STRATEGY_GENERATE_FROM_CATALOG,
  API_BATCH_GENERATION_START,
  API_BATCH_GENERATION_CANCEL,
  API_BATCH_GENERATION_STATE,
  API_WORKSPACE_SYNC_STATUS,
  API_WORKSPACE_SYNC_EXPORT,
  API_WORKSPACE_SYNC_IMPORT,
  API_FACTOR_LIST,
  API_FACTOR_START,
  API_FACTOR_START_FROM_REPORTS,
  API_FACTOR_RESUME,
  API_SIGNAL_SOURCE_LIST,
  API_PERSONA_LIST,
  API_SIGNAL_DISCOVERY_TEMPLATES,
  API_SIGNAL_DISCOVERY_DEFINITIONS,
  API_SIGNAL_DISCOVERY_SCOREBOARD,
  API_SIGNAL_DISCOVERY_QUALITY_METRICS,
  API_SIGNAL_DISCOVERY_RUNS,
  API_SIGNAL_DISCOVERY_START_SWEEP,
  API_SIGNAL_DISCOVERY_STOP_SWEEP,
  API_SIGNAL_DISCOVERY_SWEEP_STATUS,
  API_PLUGINS_REGISTRY,
  API_PLUGINS_STATS,
  API_PLUGINS_ENTITLEMENTS,
  API_USER_CREDIT_STATUS,
  API_APP_RATE_LIMIT_STATUS,
  API_APP_SERVER_STATUS,
  API_DASHBOARD_INTERPRET,
  API_DASHBOARD_INTERPRET_STATUS,
  API_START_MARKET_REGIME,
  API_CHECK_MARKET_REGIME,
  API_START_ENTRY_SIGNAL,
  API_CHECK_ENTRY_SIGNAL,
  API_START_EXIT_STRATEGY,
  API_CHECK_EXIT_STRATEGY,
  API_START_KRONOS,
  API_CHECK_KRONOS,
  API_KRONOS_HEALTH,
  API_KRONOS_PREDICT,
  API_START_KRONOS_INDICATOR_ENTRY,
  API_CHECK_KRONOS_INDICATOR_ENTRY,
  API_KRONOS_LLM_ENTRY,
  API_CHECK_KRONOS_LLM_ENTRY,
  API_LLM_PROVIDERS_MODELS,
  API_START_LLM_LIBERO,
  API_CHECK_LLM_LIBERO,
  API_VIBING_CHAT,
  API_CHECK_VIBING_CHAT,
  API_LLM_TRADER,
  API_CHECK_LLM_TRADER,
  API_START_WATCHLIST,
  API_CHECK_WATCHLIST,
  API_GENERATE_CATALOG_STRATEGY,
  API_CHECK_CATALOG_STRATEGY,
  API_PERSONA_LIST_LEGACY,
  API_AUTH_SEND_CODE,
  API_AUTH_VERIFY_CODE,
  API_AUTH_LOGIN_PASSWORD,
  API_SYSTEM_MONITOR,
  API_WORKLOAD_QUEUE_GET,
  API_WORKLOAD_QUEUE_ENQUEUE,
  API_WORKLOAD_QUEUE_DEQUEUE,
  API_ALPHA_FACTORY_RUN,
  API_ALPHA_FACTORY_PROGRESS,
  API_QUANT_LAB_REFRESH_SCOREBOARD,
  API_QUANT_LAB_REROLLUP_VERDICT,
  API_QUANT_LAB_REFIT_ARTIFACT,
  API_RESEARCH_ENV_STATUS,
  API_RESEARCH_ENV_JOB,
  API_RESEARCH_ENV_INSTALL,
  API_RESEARCH_ENV_REPAIR,
  API_RESEARCH_ENV_VERIFY,
  API_RESEARCH_ENV_UNINSTALL,
  API_RESEARCH_ENV_REMOVE_CAPABILITY,
  API_SWEEP_QUEUE_GET,
  API_SWEEP_QUEUE_ENQUEUE,
  API_SWEEP_QUEUE_CANCEL,
  API_SWEEP_QUEUE_CLEAR,
  API_SIGNAL_RUN_DELETE,
  API_SIGNAL_RUN_UPDATE,
  API_SWEEP_HISTORY,
  API_SWEEP_COVERAGE,
  API_LEADERBOARD,
  API_DEFINITION_ROLLUP,
  API_CUSTOM_FACTOR_SAVE,
  API_CUSTOM_FACTOR_DELETE,
  API_SIGNAL_SOURCE_GET,
  API_SIGNAL_SOURCE_DELETE,
  API_SIGNAL_SOURCE_CONFIRM,
  API_REMEDIATION_FAMILY_BH,
  API_PROMOTION_REGISTER,
  API_PROMOTION_STATUS,
  API_ROSTER_GET_STATE,
  API_ROSTER_LIST,
  API_ROSTER_APPLY_TRANSITION,
  API_ROSTER_REMOVE,
  API_RELEGATION_GET_CONFIG,
  API_RELEGATION_SET_CONFIG,
  API_RELEGATION_RUN_CYCLE,
  API_LSTM_GET_MANIFEST,
  API_LSTM_SET_ACTIVE_VERSION,
  API_LSTM_DELETE_VERSION,
  API_LSTM_LIST_SNAPSHOTS,
  API_LSTM_SAVE_SNAPSHOT,
  API_LSTM_RESTORE_SNAPSHOT,
  API_LSTM_DELETE_SNAPSHOT,
  API_LSTM_TRAINING_START,
  API_LSTM_TRAINING_STATUS,
  API_LSTM_TRAINING_CANCEL,
  API_LSTM_TRAINING_HISTORY,
  API_LSTM_FIT_QUALITY_REPORT,
  API_ALPHA_FACTORY_SAVE_CONFIG,
  API_ALPHA_FACTORY_LOAD_CONFIG,
  API_ALPHA_FACTORY_CANCEL,
  API_ALPHA_FACTORY_CANCEL_UNIVERSE,
  API_ALPHA_FACTORY_PROVIDER_WINDOW,
  API_ALPHA_FACTORY_LAST_RESULT,
  API_CHIP_ALLOWED_REGIMES_GET,
  API_CHIP_ALLOWED_REGIMES_SET,
  API_FACTOR_MINING_START,
  API_FACTOR_MINING_REVIEW,
  API_FACTOR_MINING_EDIT,
  API_FACTOR_MINING_CONFIRM,
  API_FACTOR_MINING_STATUS,
  API_FACTOR_MINING_SESSIONS,
  FACTOR_MINING_CORRELATION_HEADER,
  FACTOR_MINING_TOOL_HEADER,
  RUNTIME_COMPOSITION_HEADER,
  API_FACTOR_CATALOG_LIST,
  API_FACTOR_CATALOG_ACTIVATE,
  API_FACTOR_CATALOG_DEACTIVATE,
  API_FACTOR_FORMULA_GENERATE,
  API_FACTOR_FORMULA_PERSIST,
  API_DATA_LIST_PROVIDERS,
  API_DATA_SEARCH_SYMBOLS,
  API_DATA_GET_SYMBOL_DATE_RANGE,
  API_DATA_CHECK_COVERAGE,
  API_DATA_LIST_SEGMENTS,
  API_DATA_GET_CACHE_STATS,
  API_DATA_LIST_IMPORTED_PACKAGES,
  API_DATA_LIST_IMPORTED_PACKAGE_SUMMARIES,
  API_DATA_CHECK_IMPORTED_PACKAGE_INTEGRITY,
  API_DATA_AUDIT_IMPORTED_PACKAGE_ORPHANS,
  API_DATA_BUILD_COVERAGE_REPORT,
  API_DATA_APPEND_TO_PACKAGE,
  API_DATA_QUEUE_DOWNLOAD,
  API_DATA_GET_DOWNLOAD_STATUS,
  API_DATA_RETRY_FAILED,
  API_DATA_CANCEL_DOWNLOAD,
  API_DATA_GET_QUEUE_STATUS,
  API_DATA_DELETE_SEGMENTS,
  API_DATA_IMPORT_PACKAGE,
  API_DATA_REGISTER_PARQUET_DIR,
  API_DATA_REMOVE_PACKAGE,
  API_DATA_CLEAR_CACHE,
  API_HISTDATA_REVIEW,
  API_HISTDATA_CONFIRM,
  API_HISTDATA_EXECUTE,
  API_PLUGIN_LIST,
  API_PLUGIN_GET,
  API_PLUGIN_GET_CONFIG,
  API_PLUGIN_SET_CONFIG,
  API_PLUGIN_ACTIVATE,
  API_PLUGIN_DEACTIVATE,
  API_PLUGIN_INSTALL,
  API_PLUGIN_UNINSTALL,
  API_ENTITLEMENT_LIST,
  API_ENTITLEMENT_GET_PLUGIN,
  API_ENTITLEMENT_TOGGLE_SERVICE,
  API_MARKETPLACE_GET_REGISTRY,
  API_MARKETPLACE_GET_PLUGIN_DETAILS,
  API_MARKETPLACE_CHECK_UPDATES,
  API_MARKETPLACE_ACTIVATE_LICENSE,
  API_MARKETPLACE_GET_LICENSE_STATUS,
  API_MARKETPLACE_REMOVE_LICENSE,
  API_MARKETPLACE_CHECK_ENTITLEMENT,
  API_MARKETPLACE_CHECK_ENTITLEMENTS_BATCH,
  API_ENTITLEMENT_GET_AUDIT_LOG,
  API_MARKET_GET_DATA,
  API_MARKET_GET_SYMBOLS,
  API_KRONOS_RUN_PREDICTION,
  API_KRONOS_CANCEL_PREDICTION,
  API_KRONOS_LIST_MODELS,
  API_SIGNAL_GENERATOR_START,
  API_SIGNAL_GENERATOR_STOP,
  API_SIGNAL_GENERATOR_STATUS,
  API_SIGNAL_GENERATOR_HISTORY,
  API_SIGNAL_GENERATOR_IMPORT_FACTORS,
  API_SIGNAL_GENERATOR_RUN_FACTOR_SWEEP,
  API_BACKTEST_CANCEL,
  API_BACKTEST_QUEUE,
  API_BACKTEST_CANCEL_ALL,
  API_BACKTEST_PHASE,
  API_BACKTEST_RESUME,
  API_BACKTEST_CANDLES,
  API_SETTINGS_GET,
  API_SETTINGS_SET_LOCALE,
  API_SETTINGS_SET_MARKET_ROUTING,
  API_SETTINGS_SET_PROVIDER_DEFAULTS,
  API_SETTINGS_LIST_LLM_PROVIDERS,
  API_SETTINGS_SET_LLM_SELECTION,
  API_SETTINGS_SET_LLM_CREDENTIAL,
  API_SETTINGS_CHECK_LLM_CREDENTIAL,
  API_SETTINGS_GET_LLM_ACCESS,
  API_CONVERSATION_LIST,
  API_CONVERSATION_GET,
  API_CONVERSATION_DELETE,
  API_CONVERSATION_CREATE,
  API_CONVERSATION_ADD_MESSAGE,
  API_CONFIG_RELOAD,
  API_COMMERCIAL_CAPABILITY,
  API_COMMERCIAL_EXECUTE,
  API_CONFIG_HEALTH,
  API_MACHINE_INFO,
  API_DATABASE_BACKUP,
  API_DATABASE_BACKUP_LIST,
  API_DATABASE_RESTORE,
  API_SIGMA_ELIGIBILITY,
  API_SIGMA_INSTALL,
  API_SIGMA_INSTALL_STATUS,
} from './api-routes';
export type { ApiRoute } from './api-routes';

// ============================================================================
// TICKET_927_1_4_F: Tier-0 ISO 4217 currency enum
// ============================================================================

export { CURRENCIES, isCurrency } from './currency';
export type { Currency } from './currency';

// ============================================================================
// TICKET_927_1_1: Market identity + scope + symbol-to-market resolver
// ============================================================================

export { MARKET_IDS, isMarketId, isAnyMarketId, isDynamicMarketId, ASSET_CLASSES, MARKET_ASSET_CLASS, assetClassOf, sameAssetClass, setDynamicAssetClassResolver } from './market-id';
export type { MarketId, DynamicMarketId, AnyMarketId, AssetClass } from './market-id';
export { MarketScope } from './market-scope';
import { MarketScope } from './market-scope'; // local use in FusionTrunkSignalInput.scope
export type { InstrumentRegistry } from './instrument-registry';
export { StaticInstrumentRegistry, staticInstrumentRegistry } from './instrument-registry-static';

// ============================================================================
// TICKET_927_2_2: Tier-0 DataProviderId promotion
// ============================================================================

export {
  DATA_PROVIDER_IDS, isDataProviderId,
  PROVIDER_YFINANCE, PROVIDER_CCXT, PROVIDER_ALPACA, PROVIDER_DUKASCOPY,
  PROVIDER_CLICKHOUSE, PROVIDER_BAOSTOCK, PROVIDER_AKSHARE, PROVIDER_TUSHARE,
  PROVIDER_DATABENTO,
  PROVIDER_ALPHA_VANTAGE, PROVIDER_POLYGON,
} from './data-provider-id';
export type { DataProviderId } from './data-provider-id';

// ============================================================================
// TICKET_1023_8: Tier-0 LLM provider ID constants
// ============================================================================

export {
  LLM_PROVIDER_IDS, isLlmProviderId,
  LLM_PROVIDER_CLAUDE, LLM_PROVIDER_OPENAI, LLM_PROVIDER_GEMINI,
  LLM_PROVIDER_DEEPSEEK, LLM_PROVIDER_GROK, LLM_PROVIDER_QWEN,
  LLM_PROVIDER_OLLAMA, LLM_PROVIDER_LINO, LLM_PROVIDER_OPENAI_COMPATIBLE,
  LLM_PROVIDER_PRO_CATALOG, LLM_PROVIDER_NONA,
  LLM_CONTRIB_CLAUDE, LLM_CONTRIB_OPENAI, LLM_CONTRIB_GEMINI,
  LLM_CONTRIB_DEEPSEEK, LLM_CONTRIB_GROK, LLM_CONTRIB_QWEN,
  LLM_CONTRIB_OLLAMA, LLM_CONTRIB_LINO, LLM_CONTRIB_OPENAI_COMPATIBLE,
} from './llm-provider-id';
export type { LlmProviderId } from './llm-provider-id';

// TICKET_1265_7 D2: cross-package LLM credential metadata SSOT
export {
  LLM_CREDENTIAL_META,
  getLlmCredentialMeta,
  validateLlmCredentialValue,
} from './llm-credential-meta';
export type { LLMCredentialMeta, LLMExtraCredentialField } from './llm-credential-meta';

// TICKET_1276 P0b: cross-package LLM provider records SSOT (relocated from
// apps/desktop shared constants so the MCP standalone server reads the same
// records instead of a hardcoded standalone catalog copy)
export {
  LLM_PROVIDER_RECORDS,
  getProviderRecord,
  isPlatformServedProvider,
  resolveModelDisplayName,
  COST_PREFERRED_PROVIDER_ORDER,
  COST_PREFERRED_MODEL_OVERRIDES,
  selectCostPreferredProvider,
  toApiProvider,
  buildFallbackCatalog,
} from './llm-provider-records';
export type {
  LLMProviderRecord,
  ProCatalogModel,
  BackendProviderModel,
  BackendProvider,
  BackendProviderResponse,
  ProAvailableProvider,
} from './llm-provider-records';

// TICKET_1276 P0: cross-package credential storage-policy tiers SSOT
// (relocated from apps/desktop shared constants; desktop re-exports)
export {
  CredentialTier,
  inferCredentialTier,
  clearSensitiveBuffer,
  clearSensitiveString,
  isMarketplacePlugin,
} from './credential-tiers';
export type { CredentialAuditEntry } from './credential-tiers';

// ============================================================================
// TICKET_077_28_R1: Tier-0 provider-shape registry
// (lifted from plugins/quant-lab-nexus tool-sweep/universes.ts so trading-side
// callers, future ibkr live provider, and any cross-plugin consumer can read
// the same source of truth without sideways imports between Tier 1 plugins)
// ============================================================================

export {
  PROVIDER_GROUPS,
  YFINANCE_SUBSETS,
  YFINANCE_INTRADAY_LIMITS,
  DEFAULT_PROVIDER_SYMBOLS,
  SP500_TOP65,
  SP500_500,
  CRYPTO_TOP40_CCXT,
  G10_FX_YFINANCE,
  G10_FX_DUKASCOPY,
  US_SECTOR_ETFS,
  DATABENTO_US50,
  isMultiAssetProvider,
  getYfinanceIntradayWarning,
  getSymbolsForSlot,
  getRankingMetricsFor,
  getDefaultSliceFor,
  getKnownUniverseSize,
  // TICKET_932_1: pure dynamic provider-options layer.
  flattenProviderCatalog,
  findProviderOption,
  isProviderVisibleUnderSelection,
  // TICKET_932_2: BYOD imported-package merge.
  buildImportedPackageGroup,
  PROVIDER_ASSET_CLASSES,
  resolveProviderAssetClasses,
  isProviderAssetClassCompatible,
  isMarketScopeCompatibleWithProvider,
} from './provider-registry';
export type {
  ProviderGroup,
  ProviderGroupEntry,
  YfinanceSubset,
  DataSourceSlot,
  UniverseSliceSpec,
  RankingMetricId,
  RankingMetricOption,
  // TICKET_932_1
  ProviderOption,
} from './provider-registry';

// ============================================================================
// TICKET_927_2_1: Data readiness tier-0 types
// ============================================================================

export { ReadinessStatus, DataReadinessError } from './data-readiness';
export type {
  DataManifestEntryKind,
  SymbolId,
  IsoTimestamp,
  RunId,
  SnapshotId,
  TimeWindow,
  ManifestEntry,
  DataManifest,
  ReadinessEntry,
  DataReadinessReport,
  MarketReadyView,
  FxPairKey,
  FxRateReadyView,
  ReadyDataset,
  StagingProgressMsg,
} from './data-readiness';

// ============================================================================
// TICKET_927_1_4_C: Tier-0 per-market cost model
// ============================================================================

export type { PerMarketCost, PortfolioCostModel, PerStockCostParams } from './portfolio-cost-model';
export { DEFAULT_PER_MARKET_COST, DEFAULT_IMPACT_CONSTANT, getDefaultCostForMarket } from './portfolio-cost-model';

// ============================================================================
// TICKET_927_4_1: Tier-0 per-market book + firm-portfolio aggregator contract
// ============================================================================

export type {
  ConstructionRule,
  PortfolioEquityPoint,
  ColumnarEquityCurve,
  PerSymbolContribution,
  PortfolioMetrics,
  PortfolioCostedResult,
  PortfolioBookResult,
  BookStatus,
  InsaneInputExample,
} from './portfolio-book';
export { columnarToEquityPoints } from './portfolio-book';

export type {
  PortfolioBookSet,
  FirmPortfolio,
  FirmPortfolioAggregator,
  FxRateProvider,
  PortfolioBookSetDTO,
  FirmPortfolioDTO,
} from './firm-portfolio';
export { identityFxRateProvider, toFirmPortfolioDTO } from './firm-portfolio';

// ============================================================================
// TICKET_927_1_4_D: Tier-0 per-market risk, vol-target, turnover-control
// ============================================================================

export type {
  TurnoverControlConfig,
  RiskConstraintsConfig,
  VolatilityTargetConfig,
  PerMarketTurnoverControl,
  PerMarketRiskConstraints,
  PerMarketVolatilityTarget,
} from './portfolio-risk';
export { DEFAULT_PER_MARKET_RISK } from './portfolio-risk';

// ============================================================================
// TICKET_927_3_1: Tier-0 per-bucket bar-level orchestrator contract
// ============================================================================

export {
  BAR_STAGES,
  emptyScoreCalibState,
  emptyVolTargetState,
  wrapArrayAsFusedBarIterable,
} from './per-bucket-orchestrator';
export type {
  BarStageId,
  BarStagesTuple,
  BarOHLC,
  FusedBarEntry,
  FusedBarCrossSection,
  FusedBarIterable,
  BarInputs,
  BarState,
  VolTargetState,
  OrderIntent,
  BarStep,
  PerBucketBarOrchestrator,
  BucketContext,
  BucketReplayLoop,
} from './per-bucket-orchestrator';

// ============================================================================
// TICKET_927_1_4_B: Tier-0 per-bucket regime gating types
// ============================================================================

export type {
  RegimeBarState,
  RegimeAdjustment,
  PerBucketRegimeAdjustment,
} from './regime-adjustment';

// ============================================================================
// Strategy Types
// ============================================================================

export interface Strategy {
  id: string;
  name: string;
  code: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyCreateInput {
  name: string;
  code: string;
  description?: string;
}

export interface StrategyUpdateInput {
  code?: string;
  description?: string;
}

// ============================================================================
// Backtest Types
// ============================================================================

export interface BacktestConfig {
  strategyId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  symbols: string[];
  params?: Record<string, unknown>;
}

export type BacktestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BacktestResult {
  id: string;
  strategyId: string;
  status: BacktestStatus;
  totalReturn?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  winRate?: number;
  tradesCount: number;
  createdAt: string;
  completedAt?: string;
}

export interface Trade {
  id: string;
  backtestId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: string;
  pnl?: number;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
}

// ============================================================================
// Market Data Types
// ============================================================================

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TimeInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';
// TICKET_1225 P0: '2h' joins the canonical vocabulary (mirrors the C++
// stratforge/data/interval.hpp 10-token vocabulary; ALL_INTERVALS in
// interval-constants.ts already carries it).
export type BarInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w' | '1M';

export interface MarketDataQuery {
  symbol: string;
  startDate: string;
  endDate: string;
  interval: TimeInterval;
}

// ============================================================================
// Signal Fusion Types
// ============================================================================

export type SignalNature = 'cross_sectional' | 'single_symbol_valid';

export interface SignalForwardReturnPair {
  timestamp: number;
  symbol: string;
  signalValue: number;
  signalConfidence: number;
  rNext: number;
  horizonBars: number;
}

export interface FusionTrunkSignalInput {
  signalId: string;
  interval: BarInterval;
  /** TICKET_927_1_3: the signal's market-of-applicability. The trunk MUST
   *  partition by this axis BEFORE invoking the C++ runner; cells whose
   *  symbol resolves to a MarketId outside `scope.markets` are structurally
   *  not addressed by this signal, never "absent and renormalised" (parent
   *  ticket section 0.1). REQUIRED -- never defaulted to "all markets";
   *  parent ticket section 3 root cause #1 backfill rule #4 (TICKET_858). */
  scope: MarketScope;
  pairs: SignalForwardReturnPair[];
  ic?: number;
  nature: SignalNature;
  decaySlope?: number | null;
}

// ============================================================================
// Server Status Types
// ============================================================================

export interface ServerStatus {
  api: boolean;
  engine: boolean;
  mcp: boolean;
}

// ============================================================================
// Plugin Types
// ============================================================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  main: string;
  type: 'data-provider' | 'indicator' | 'signal' | 'risk' | 'ui';
  dependencies?: Record<string, string>;
}

// ============================================================================
// IPC Types
// ============================================================================

export interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// TICKET_968 Layer 0 -- cross-timeframe alignment skip-reason registry
// ============================================================================

export {
  ALIGNMENT_SKIP_REASONS,
  ALIGNMENT_SKIP_REASON_IDS,
  ALIGNMENT_SKIP_REASON_DOMINANCE_THRESHOLD,
  ALIGNMENT_MIN_OVERLAP_BARS,
  isAlignmentSkipReason,
} from './alignment-skip-reasons';
export type {
  AlignmentSkipReason,
  AlignmentSkipReasonEntry,
  AlignmentSkipStat,
} from './alignment-skip-reasons';

// ============================================================================
// TICKET_969 Layer 2 -- provider availability remediation registry
// ============================================================================

// ============================================================================
// TICKET_1023_6: Credential key constants
// ============================================================================

export {
  DATA_CREDENTIAL_KEYS,
  LLM_CREDENTIAL_KEYS,
  LLM_CONFIG_KEYS,
} from './credential-keys';
export type {
  DataCredentialKey,
  LlmCredentialKey,
} from './credential-keys';

export {
  PROVIDER_LOOKBACK_REMEDIATION,
  getProviderLookbackRemediationOption,
} from './provider-availability-remediation';
export type {
  ProviderLookbackGateCode,
  ProviderLookbackRemediationOptionId,
  ProviderLookbackRemediationOption,
  ProviderLookbackRemediation,
  ProviderLookbackPerSignalRange,
  ProviderLookbackGateDiagnostic,
  ProviderLookbackRelaxationReason,
  ProviderLookbackDroppedSignal,
  // TICKET_970_6 -- nullable fusion-geometry block + refusal-category
  // discriminator + lifted per-signal catalog refusal rows.
  ProviderLookbackRefusalCategory,
  ProviderLookbackCatalogRefusalRow,
} from './provider-availability-remediation';

// ============================================================================
// TICKET_1030_6: Tier-0 TemplateId registry
// ============================================================================

export { TemplateId } from './template-id';
export type { TemplateIdValue } from './template-id';

// ============================================================================
// TICKET_1023_2 -- Named interval string constants
// ============================================================================

export {
  INTERVAL_1m,
  INTERVAL_5m,
  INTERVAL_15m,
  INTERVAL_30m,
  INTERVAL_1h,
  INTERVAL_2h,
  INTERVAL_4h,
  INTERVAL_1d,
  INTERVAL_1w,
  INTERVAL_1M,
  ALL_INTERVALS,
  INTERVAL_RANK,
  isIntervalFinerThan,
  intervalToMs,
} from './interval-constants';

// ============================================================================
// TICKET_1308 7D -- Public signal-discovery type primitives
// ============================================================================
export type { TrainingBars } from './signal-discovery-types';
export { asTrainingBars, FACTOR_COMBINATOR_METHODS } from './signal-discovery-types';

// ============================================================================
// TICKET_1326 F1 -- the single owner of the training-bar budget. Every
// surface (Electron main, MCP standalone, plugin UI) resolves the default
// and the bounds here; none keeps a literal (TICKET_1329 UAC1/UAC2/UAC4).
// ============================================================================
export {
  TRAINING_BAR_WORKLOADS,
  TRAINING_BAR_WORKLOAD_DEFAULT,
  TRAINING_BAR_WORKLOAD_BOUNDS,
  TRAINING_BARS_MIN,
  TRAINING_BARS_PREVIEW_MAX,
  TRAINING_BARS_BATCH_MAX,
  TRAINING_BARS_PREVIEW_DEFAULT,
  TRAINING_BARS_BATCH_DEFAULTS,
  TRAINING_BARS_BATCH_FALLBACK,
  resolveTrainingBarBudget,
  validateTrainingBarOverride,
  isTrainingBarWorkload,
} from './training-bar-budget';
export type {
  TrainingBarWorkload,
  TrainingBarBudget,
  TrainingBarBudgetRequest,
} from './training-bar-budget';

// ============================================================================
// TICKET_1331 F1 -- the single owner of the batch training WINDOW contract.
// The CatBoost chain trained on ALL available history (1.886M bars/symbol on
// 5m, 26 years) because the manifest's declared window was inert. This owns the
// default (2 years), the resolution, and the log sentence. It is NOT
// `training-bar-budget` -- that resolves a BAR COUNT for preview/scheduler
// workloads; applying its `batch` table here would cut 5m to ~10 days
// (TICKET_1331 sec.2). The two must not be unified.
// ============================================================================
export {
  TRAINING_WINDOW_YEARS_DEFAULT,
  TRAINING_WINDOW_YEARS_MIN,
  TRAINING_WINDOW_YEARS_MAX,
  TRAINING_WINDOW_ALL,
  resolveTrainingWindow,
  trainingWindowStartDate,
  describeTrainingWindow,
} from './training-window';
export type {
  TrainingWindow,
  TrainingWindowSource,
  TrainingWindowRequest,
  TrainingWindowResult,
  TrainingWindowOk,
  TrainingWindowError,
} from './training-window';

// ============================================================================
// TICKET_1324 F1 -- the single owner of the sweep launch contract. Config
// normalization, the cross-path run registry decision, the fence requirement,
// preflight, and the resume-marker identity all resolve here, so a sweep
// started from the CLI chain, the desktop orchestrator, or the Guide WebUI
// agent gets ONE set of safety properties (TICKET_1329 UAC1/UAC2/UAC3).
// ============================================================================
export {
  SWEEP_LAUNCHERS,
  SWEEP_LAUNCHER_LABELS,
  isSweepLauncher,
  normalizeSweepLaunchRequest,
  isSweepClaimStale,
  describeSweepClaim,
  buildPreflightSpec,
  PREFLIGHT_PYTHON_MODULES,
  evaluatePreflight,
  isSweepFenced,
  decideSweepLaunch,
  SWEEP_JOB_NAME,
  gridStageKey,
  bayesianStageKey,
  CHAIN_DONE_STAGE_KEY,
  stageMarkerRelativePath,
  formatStageMarker,
  stageMarkerGrepPrefix,
  isStageDone,
  // TICKET_1325 -- the timeframe selection contract (F1/F2/F5).
  CHAIN_TIMEFRAMES,
  isChainTimeframe,
  resolveChainTimeframes,
  describeChainTimeframeSelection,
} from './sweep-launch';
export type {
  SweepLauncher,
  SweepLaunchRequest,
  SweepLaunchRequestResult,
  SweepLaunchRequestOk,
  SweepLaunchRequestError,
  SweepLaunchWireInput,
  SweepRunClaim,
  SweepClaimLiveness,
  PreflightRequirement,
  PreflightProbe,
  SweepFenceState,
  SweepLaunchDecisionInput,
  SweepLaunchDecision,
  SweepLaunchRefusalCode,
  ChainTimeframe,
  ChainTimeframeSource,
  ChainTimeframeSelectionOk,
  ChainTimeframeSelectionError,
  ChainTimeframeSelectionResult,
} from './sweep-launch';

// ============================================================================
// TICKET_1334 P0 -- the Service API runtime-role contract. Mutexes the ROLE
// (which process serves `api-port`/`api-token`), never the process: Path A /
// Path B coexistence is deliberate architecture (D3).
// ============================================================================
export {
  SERVICE_API_HOSTS,
  SERVICE_API_HOST_LABELS,
  isServiceApiHost,
  isServiceApiClaimStale,
  describeServiceApiClaim,
  parseServiceApiRuntimeClaim,
  formatServiceApiRuntimeClaim,
  // TICKET_1334 P4 (D4 / AC5_1) -- runtime-role STATE, the shared decision every
  // surface renders instead of re-deriving.
  SERVICE_API_ROLE_STATUSES,
  resolveServiceApiRoleState,
  isSameServiceApiRoleState,
} from './service-api-runtime';
export type {
  ServiceApiHost,
  ServiceApiRuntimeClaim,
  ServiceApiClaimLiveness,
  ServiceApiRoleStatus,
  ServiceApiRuntimeRoleState,
  ServiceApiRoleFacts,
} from './service-api-runtime';

// ============================================================================
// TICKET_1327 F1/F2 -- the single owner of data-provider availability. ONE
// credential map (the `provider-manager.ts` / `universes.ts` mirrors are
// deleted), with identity + configured-ness (Class-S) split from reachability
// (Class-R) so the WebUI answers with Electron down (TICKET_1276 AC4).
// ============================================================================
export {
  DATA_PROVIDER_CREDENTIALS,
  DATA_PROVIDER_CREDENTIAL_PLUGIN_ID,
  isByokDataProvider,
  resolveDataProviderFromCredential,
  resolveProviderConfiguredState,
  resolveConfiguredDataProviders,
  toSelectableProviderIds,
  buildAvailabilityWithoutReachability,
} from './provider-availability';
export type {
  ProviderCredentialDescriptor,
  ProviderConfiguredState,
  ProviderConfiguredEntry,
  ProviderReachabilityEntry,
  ProviderAvailabilityResponse,
  CredentialPresenceReader,
} from './provider-availability';

// ============================================================================
// TICKET_1278 -- Canonical signal-discovery read SQL builders (shared by the
// Electron Service API routes and the standalone MCP direct-SQL fallback)
// ============================================================================

export {
  SCOREBOARD_SORT_COLUMNS,
  resolveScoreboardSortColumn,
  buildScoreboardQuery,
  buildSignalRunsQuery,
  buildSignalDefinitionsQuery,
  SIGNAL_QUALITY_METRICS_SQL,
  SIGNAL_RUN_VERDICTS_SQL,
  groupQualityMetricsByLayer,
} from './signal-discovery-queries';
export type {
  ScoreboardQueryParams,
  SignalRunsQueryParams,
  SignalDefinitionsQueryParams,
  BuiltQuery,
} from './signal-discovery-queries';

// TICKET_1280 P2 -- surface-wide mutation-result contract
export { deriveMutationCounters, projectChipPersistedIds } from './mutation-result';
export type { MutationOutcome, MutationResult } from './mutation-result';

// ============================================================================
// TICKET_1225 P0 -- FeedPlan / FeedSpec (multi-timeframe backtest contract)
// ============================================================================

export type { FeedPlan, FeedSpec, FeedSource } from './feed-plan';

// ============================================================================
// TICKET_1030_15: Third-party provider URL constants
// ============================================================================

export {
  LLM_SIGNUP_URL_CLAUDE,
  LLM_SIGNUP_URL_OPENAI,
  LLM_SIGNUP_URL_GEMINI,
  LLM_SIGNUP_URL_DEEPSEEK,
  LLM_SIGNUP_URL_GROK,
  LLM_SIGNUP_URL_QWEN,
  LLM_SIGNUP_URL_OLLAMA,
  LLM_SIGNUP_URL_LINO,
  LLM_API_BASE_CLAUDE,
  LLM_API_BASE_OPENAI,
  LLM_API_BASE_GEMINI,
  LLM_API_BASE_DEEPSEEK,
  LLM_API_BASE_GROK,
  LLM_API_BASE_QWEN,
  LLM_API_BASE_OPENROUTER,
  LLM_API_BASE_OLLAMA_DEFAULT,
  LLM_API_BASE_LINO,
  DATA_SIGNUP_URL_ALPACA,
  DATA_SIGNUP_URL_ALPHA_VANTAGE,
  DATA_SIGNUP_URL_POLYGON,
  DATA_SIGNUP_URL_TUSHARE,
  DATA_API_BASE_ALPACA,
  DATA_API_BASE_ALPACA_LIVE,
  DATA_API_BASE_ALPACA_PAPER,
  DATA_API_BASE_ALPHA_VANTAGE,
  DATA_API_BASE_POLYGON,
  DATA_API_BASE_DUKASCOPY,
  DATA_API_BASE_MARKETAUX,
  DATA_API_BASE_FRED,
  DATA_API_BASE_CFTC,
} from './provider-urls';

// ============================================================================
// TICKET_1276 P2 gate 2 -- shared SQLite schema-version-skew contract
// ============================================================================

export { EXPECTED_SCHEMA_VERSION } from './schema-version';
export {
  SECURE_STORE_ERROR_CODES,
  type SecureStoreErrorCode,
  type CredentialHealth,
  type SecureStoreFailure,
} from './secure-store-health';
export type {
  SecureStoreLifecycleCapabilities,
  SecureStoreLifecycleMode,
  SecureStoreLifecycleMutationResult,
  SecureStoreLifecycleStatus,
} from './secure-store-lifecycle';

// ============================================================================
// TICKET_1298 Phase 0 -- managed-tool descriptor and immutable-plan contracts
// ============================================================================

export {
  MANAGED_TOOL_CATALOG_SCHEMA_VERSION,
  MANAGED_TOOL_DESCRIPTOR_SCHEMA_VERSION,
} from './managed-tools';
export type {
  ManagedToolArchitecture,
  ManagedToolArchiveFormat,
  ManagedToolArtifactDescriptor,
  ManagedToolCatalog,
  ManagedToolDescriptor,
  ManagedToolErrorCode,
  ManagedToolInstallPlan,
  ManagedToolLifecycleState,
  ManagedToolOperationClass,
  ManagedToolPermissionDescriptor,
  ManagedToolPlatform,
  ManagedToolResourceDecision,
  ManagedToolRuntimeDescriptor,
  ManagedToolStorePathIdentity,
} from './managed-tools';

export type {
  BatchGenerationItemError,
  BatchGenerationResult,
  BatchGenerationSkip,
  BatchGenerationState,
  BatchGenerationStatus,
} from './strategy-batch-generation';

export * from './backtest-lifecycle-storage';
export type { ChainEntrySummary } from './backtest-chain';
export * from './system-config-capability';
// TICKET_1335 D2: constrained factor catalog identity shared by Electron main
// and the standalone MCP process.
export * from './factor-catalog';
// TICKET_1335: shared research-environment lifecycle contract consumed by
// Electron IPC/preload, the Service API, and MCP as adapters over one service.
export * from './research-environment';
// TICKET_661_1 AC-10: the authoritative, Electron-free strategy-language
// evidence classifier, the single shared C++ source-analysis owner, and the
// shared execution-admission operation. Electron Main, the Service API, MCP,
// and headless all consume these exact operations; adapters are transport only.
export * from './strategy-language-evidence';
export * from './cpp-source-analysis';
export * from './strategy-execution-admission';
// TICKET_661_1 steps 4/5: the deterministic legacy inventory with its
// section 5.1.1 consistency snapshot, and the immutable archive. Both are pure
// and Electron-free -- callers inject rows, bytes, hashing, and filesystem
// effects -- so the Service API, IPC, MCP, and headless surfaces share one
// owner rather than each reconstructing the migration decision.
export * from './strategy-migration-inventory';
export * from './strategy-migration-archive';
// TICKET_661_1 step 5 (section 5.3 / 5.3.1): the two-phase regeneration
// lifecycle -- a single-transaction candidate commit that is non-executable by
// persisted state, and a separate admission that is the only writer of
// `execution_readiness == 'admitted'`. Storage is injected, so Electron Main
// and the standalone MCP surface drive one operation rather than two.
export * from './strategy-migration-lifecycle';
// TICKET_1303_100 Phase 4: the generated projection of the nona_server
// governance API contract. nona_server owns the schema; QuantNexus consumes
// this pinned, digest-verified projection as an anti-corruption layer.
export * from './governance-api';
// TICKET_1345: Operation Admission -- pure types and decision functions.
// Every exposed operation declares one policy and passes through one local
// admission authority before business execution.
export * from './operation-admission';
// TICKET_1363: one serialized pre-launch review and confirmed-plan contract
// shared by workload owners and every presentation/transport adapter.
export * from './workload-prelaunch';
export * from './factor-mining';
export * from './histdata-acquisition';
export * from './data-download-specification';
// TICKET_1368: Frozen Sigma marketplace product identity.
export * from './marketplace-product';
