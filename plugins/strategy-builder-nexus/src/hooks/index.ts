/**
 * Strategy Builder Plugin Hooks
 *
 * @see TICKET_077_D2 - Unified Generate Workflow
 * @see TICKET_190 - LLM Access Check
 */

// LLM Access Hook (TICKET_190)
export { useLLMAccess } from './useLLMAccess';
export type {
  LLMAccessResult,
  UseLLMAccessOptions,
  UseLLMAccessReturn,
} from './useLLMAccess';

// Generate Workflow Hook (TICKET_077_D2)
export { useGenerateWorkflow } from './useGenerateWorkflow';
// TICKET_1208 P6: Workflow state store (preserved across view switches)
export { useGenerateWorkflowStore } from './useGenerateWorkflowStore';
export type {
  GenerationResult,
  GenerateResultState,
  CodeDisplayState,
  GenerateWorkflowConfig,
  GenerateWorkflowCallbacks,
  GenerateWorkflowState,
  GenerateWorkflowActions,
  GenerateWorkflowLLMAccess,
  UseGenerateWorkflowReturn,
} from './useGenerateWorkflow';

// Kronos Predictor Hook (TICKET_205)
export { useKronosPredictor, KRONOS_MODELS, PRESETS } from './useKronosPredictor';
export type {
  ModelOption,
  PresetConfig,
  KronosPredictorState,
  KronosPredictionResult,
  KronosPredictionRequest,
  UseKronosPredictorReturn,
} from './useKronosPredictor';

// Quant Lab Availability Hook (TICKET_264)
export { useQuantLabAvailable } from './useQuantLabAvailable';
export type { UseQuantLabAvailableReturn } from './useQuantLabAvailable';

// LLM Catalog Hook (TICKET_646 Phase 3)
export { useLLMCatalog } from './useLLMCatalog';
export type {
  UseLLMCatalogReturn,
  LLMCatalogProvider,
  LLMCatalogModel,
} from './useLLMCatalog';
