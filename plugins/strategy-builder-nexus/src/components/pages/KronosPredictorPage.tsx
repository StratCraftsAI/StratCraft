/**
 * KronosPredictorPage Component
 *
 * Kronos AI Predictor page following TICKET_077 layout specification.
 * Zones: A (Header), B (Sidebar), C (Content), D (Action Bar)
 *
 * TICKET_207: Migrated to useGenerateWorkflow for algorithm storage
 *
 * @see TICKET_205 - Kronos Predictor Page Migration
 * @see TICKET_207 - KronosPredictorPage Algorithm Storage Missing
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_077_D2 - Unified Generate Workflow
 */

import React, { useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { useAppStore } from '@/stores';
import { useKronosPredictorStore } from './useKronosPredictorStore';
import { Plus, Zap, TrendingUp, CheckCircle, Shuffle } from 'lucide-react';
import { cn } from '../../lib/utils';

// UI Components
import {
  ModelSelector,
  SliderInputGroup,
  PresetButtonGroup,
  CollapsiblePanel,
  SignalFilterPanel,
  TimeRangeSelector,
  GenerateContentWrapper,
  CodeDisplay,
  ApiKeyPrompt,
  BYOKSetupDialog,
  NamingDialog,
  type PresetOption,
  type SignalFilterConfig,
  type TimeRangeMode,
  type DirectionMode,
  type CombinationLogic,
  GenerateActionBar,
} from '../ui';

// TICKET_077_D2: Unified Generate Workflow Hook
import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

// Services
import {
  buildKronosPredictorRequest,
  extractClassName,
} from '../../services/algorithm-storage-service';
import type { AlgorithmSaveRequest } from '../../services/algorithm-storage-service';
import { getCurrentUserIdAsString } from '../../utils/auth-utils';
import { THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface KronosPredictorPageProps {
  onSettingsClick?: (tab?: string) => void;
  /** Page title from navigation */
  pageTitle?: string;
  /** LLM provider setting from plugin config */
  llmProvider?: string;
  /** LLM model setting from plugin config */
  llmModel?: string;
}

interface ModelOption {
  id: string;
  name: string;
  params: string;
  maxContext: number;
  recommended?: boolean;
}

interface PresetConfig {
  lookback: number;
  predLen: number;
  temperature: number;
  topP: number;
  topK: number;
  sampleCount: number;
}

/**
 * Page state passed to workflow config builders
 */
interface KronosPredictorState {
  selectedModel: string;
  lookback: number;
  predLen: number;
  temperature: number;
  topP: number;
  topK: number;
  sampleCount: number;
  signalFilter: SignalFilterConfig;
  timeRangeMode: TimeRangeMode;
  customTime: string;
}

/**
 * API request format for Kronos prediction
 */
interface KronosPredictionRequest {
  model: string;
  lookback: number;
  pred_len: number;
  temperature: number;
  top_p: number;
  top_k: number;
  sample_count: number;
  time_range: TimeRangeMode;
  start_time?: string;
  strategy_name: string;
  signal_filter: {
    filters: {
      confidence: { enabled: boolean; min_value: number };
      expected_return: { enabled: boolean; min_value: number };
      direction_filter: { enabled: boolean; mode: DirectionMode };
      magnitude: { enabled: boolean; min_value: number };
      consistency: { enabled: boolean; min_value: number };
    };
    combination_logic: CombinationLogic;
  };
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const KRONOS_MODELS: ModelOption[] = [
  { id: 'kronos-mini', name: 'Kronos-mini', params: '4.1M', maxContext: 2048 },
  { id: 'kronos-small', name: 'Kronos-small', params: '24.7M', maxContext: 512, recommended: true },
  { id: 'kronos-base', name: 'Kronos-base', params: '102.3M', maxContext: 512 },
];

const PRESETS: Record<string, PresetConfig> = {
  quick: { lookback: 100, predLen: 20, temperature: 1.0, topP: 0.9, topK: 0, sampleCount: 1 },
  standard: { lookback: 400, predLen: 120, temperature: 1.0, topP: 0.9, topK: 0, sampleCount: 1 },
  precision: { lookback: 500, predLen: 120, temperature: 0.8, topP: 0.95, topK: 0, sampleCount: 5 },
  explore: { lookback: 400, predLen: 120, temperature: 1.5, topP: 0.85, topK: 0, sampleCount: 3 },
};

// MODEL_PRESETS: moved inside component as useMemo (needs t() for i18n)

const DEFAULT_SIGNAL_FILTER: SignalFilterConfig = {
  confidence: { enabled: true, value: 60 },
  expectedReturn: { enabled: true, value: 2 },
  direction: { enabled: false, mode: 'both' },
  magnitude: { enabled: false, value: 1 },
  consistency: { enabled: true, value: 70 },
  combinationLogic: 'AND',
};

// KRONOS_ERROR_MESSAGES: moved inside component as useMemo (needs t() for i18n)

function getCurrentDateTimeLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

// -----------------------------------------------------------------------------
// API Functions
// -----------------------------------------------------------------------------

/**
 * Execute Kronos prediction API call
 */
async function executeKronosPrediction(config: KronosPredictionRequest, _signal?: AbortSignal): Promise<GenerationResult> {
  console.debug('[KronosPredictor] Sending request:', config);

  const response = await window.electronAPI.kronos.predict(config);

  if (!response.success) {
    return {
      status: 'failed',
      error: response.error || i18n.t('MSG_KRONOS_PREDICTION_REQUEST_FAILED', { ns: 'errors' }),
    };
  }

  // Handle synchronous result (TICKET_206)
  if (response.strategyCode) {
    return {
      status: 'completed',
      strategy_code: response.strategyCode,
    };
  }

  // For async task, we need to wait for completion
  // This is handled by IPC events in the background
  if (response.taskId) {
    // Wait for completion via polling or return processing status
    return {
      status: 'processing',
    };
  }

  return {
    status: 'failed',
    error: 'MSG_KRONOS_UNKNOWN_ERROR',
  };
}

/**
 * Validate Kronos prediction config
 */
function validateKronosConfig(config: KronosPredictionRequest): { valid: boolean; error?: string } {
  // Check if at least one filter is enabled
  const filters = config.signal_filter.filters;
  const hasFilter =
    filters.confidence.enabled ||
    filters.expected_return.enabled ||
    filters.direction_filter.enabled ||
    filters.magnitude.enabled ||
    filters.consistency.enabled;

  if (!hasFilter) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_SIGNAL_FILTER_REQUIRED' };
  }

  if (config.lookback < 10) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_KRONOS_LOOKBACK_MIN' };
  }

  if (config.pred_len < 1) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_PREDICTION_LENGTH_MIN' };
  }

  return { valid: true };
}

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

/**
 * Build API config from page state
 */
function buildApiConfig(state: KronosPredictorState, strategyName: string): KronosPredictionRequest {
  return {
    model: state.selectedModel,
    lookback: state.lookback,
    pred_len: state.predLen,
    temperature: state.temperature,
    top_p: state.topP,
    top_k: state.topK,
    sample_count: state.sampleCount,
    time_range: state.timeRangeMode,
    start_time: state.timeRangeMode === 'custom' ? state.customTime : undefined,
    strategy_name: strategyName,
    signal_filter: {
      filters: {
        confidence: {
          enabled: state.signalFilter.confidence.enabled,
          min_value: state.signalFilter.confidence.value / 100,
        },
        expected_return: {
          enabled: state.signalFilter.expectedReturn.enabled,
          min_value: state.signalFilter.expectedReturn.value / 100,
        },
        direction_filter: {
          enabled: state.signalFilter.direction.enabled,
          mode: state.signalFilter.direction.mode,
        },
        magnitude: {
          enabled: state.signalFilter.magnitude.enabled,
          min_value: state.signalFilter.magnitude.value / 100,
        },
        consistency: {
          enabled: state.signalFilter.consistency.enabled,
          min_value: state.signalFilter.consistency.value / 100,
        },
      },
      combination_logic: state.signalFilter.combinationLogic,
    },
  };
}

/**
 * Build storage request from API result
 */
async function buildStorageRequestFromResult(
  result: GenerationResult,
  state: KronosPredictorState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdAsString();
  return buildKronosPredictorRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      model_version: state.selectedModel,
      lookback: state.lookback,
      pred_len: state.predLen,
      temperature: state.temperature,
      top_p: state.topP,
      top_k: state.topK,
      sample_count: state.sampleCount,
      signal_filter: {
        filters: {
          confidence: {
            enabled: state.signalFilter.confidence.enabled,
            min_value: state.signalFilter.confidence.value / 100,
          },
          expected_return: {
            enabled: state.signalFilter.expectedReturn.enabled,
            min_value: state.signalFilter.expectedReturn.value / 100,
          },
          direction_filter: {
            enabled: state.signalFilter.direction.enabled,
            mode: state.signalFilter.direction.mode,
          },
          magnitude: {
            enabled: state.signalFilter.magnitude.enabled,
            min_value: state.signalFilter.magnitude.value / 100,
          },
          consistency: {
            enabled: state.signalFilter.consistency.enabled,
            min_value: state.signalFilter.consistency.value / 100,
          },
        },
        combination_logic: state.signalFilter.combinationLogic,
      },
    },
    userId
  );
}

// getKronosErrorMessage: moved inside component (needs access to translated errorMessages)

// -----------------------------------------------------------------------------
// KronosPredictorPage Component
// -----------------------------------------------------------------------------

export const KronosPredictorPage: React.FC<KronosPredictorPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'KRONOS',
  llmModel = 'kronos-small',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.kronosPredictor.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // TICKET_422_3: i18n'd constants (moved from module scope to use t())
  const MODEL_PRESETS: PresetOption[] = useMemo(() => [
    { id: 'quick', label: t('pages.kronosPredictor.presets.quickPreview'), icon: <Zap className="w-5 h-5" />, description: t('pages.kronosPredictor.presets.quickPreviewDesc') },
    { id: 'standard', label: t('pages.kronosPredictor.presets.standard'), icon: <TrendingUp className="w-5 h-5" />, description: t('pages.kronosPredictor.presets.standardDesc') },
    { id: 'precision', label: t('pages.kronosPredictor.presets.highPrecision'), icon: <CheckCircle className="w-5 h-5" />, description: t('pages.kronosPredictor.presets.highPrecisionDesc') },
    { id: 'explore', label: t('pages.kronosPredictor.presets.exploreMode'), icon: <Shuffle className="w-5 h-5" />, description: t('pages.kronosPredictor.presets.exploreModeDesc') },
  ], [t]);

  const KRONOS_ERROR_MESSAGES: Record<string, string> = useMemo(() => ({
    KRONOS_SERVICE_UNAVAILABLE: t('pages.kronosPredictor.errors.serviceUnavailable'),
    MODEL_NOT_FOUND: t('pages.kronosPredictor.errors.modelNotFound'),
    INVALID_PARAMETERS: t('pages.kronosPredictor.errors.invalidParameters'),
    PREDICTION_TIMEOUT: t('pages.kronosPredictor.errors.predictionTimeout'),
    AUTH_REQUIRED: t('pages.kronosPredictor.errors.authRequired'),
  }), [t]);

  const getKronosErrorMessage = useCallback((result: GenerationResult): string => {
    if (result.reason_code && KRONOS_ERROR_MESSAGES[result.reason_code]) {
      return KRONOS_ERROR_MESSAGES[result.reason_code];
    }
    if (typeof result.error === 'string') {
      return result.error;
    }
    if (result.error && typeof result.error === 'object') {
      return result.error.message || result.error.error_message || t('pages.kronosPredictor.errors.predictionFailed');
    }
    return t('pages.kronosPredictor.errors.predictionFailed');
  }, [KRONOS_ERROR_MESSAGES, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State (UI inputs)
  // ---------------------------------------------------------------------------

  const {
    selectedModel, setSelectedModel,
    lookback, setLookback,
    predLen, setPredLen,
    temperature, setTemperature,
    topP, setTopP,
    topK, setTopK,
    sampleCount, setSampleCount,
    signalFilter, setSignalFilter,
    timeRangeMode, setTimeRangeMode,
    customTime, setCustomTime,
    activePreset, setActivePreset,
  } = useKronosPredictorStore();

  // Hydrate customTime on first mount (store initialises to '' for persistence)
  useEffect(() => {
    if (!customTime) setCustomTime(getCurrentDateTimeLocal());
  }, []);

  // ---------------------------------------------------------------------------
  // Computed Values
  // ---------------------------------------------------------------------------

  const maxLookback = useMemo(() => {
    const model = KRONOS_MODELS.find(m => m.id === selectedModel);
    return model?.maxContext || 512;
  }, [selectedModel]);

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  // Current page state for workflow
  const currentState: KronosPredictorState = useMemo(() => ({
    selectedModel,
    lookback,
    predLen,
    temperature,
    topP,
    topK,
    sampleCount,
    signalFilter,
    timeRangeMode,
    customTime,
  }), [selectedModel, lookback, predLen, temperature, topP, topK, sampleCount, signalFilter, timeRangeMode, customTime]);

  // Validation items - at least one filter must be enabled
  const validationItems = useMemo(() => {
    const items: unknown[] = [];
    if (signalFilter.confidence.enabled) items.push({ type: 'filter', name: 'confidence' });
    if (signalFilter.expectedReturn.enabled) items.push({ type: 'filter', name: 'expectedReturn' });
    if (signalFilter.direction.enabled) items.push({ type: 'filter', name: 'direction' });
    if (signalFilter.magnitude.enabled) items.push({ type: 'filter', name: 'magnitude' });
    if (signalFilter.consistency.enabled) items.push({ type: 'filter', name: 'consistency' });
    return items;
  }, [signalFilter]);

  // Workflow config
  const workflowConfig = useMemo((): GenerateWorkflowConfig<KronosPredictionRequest, KronosPredictorState> => ({
    pageId: 'kronos-predictor-page',
    llmProvider,
    llmModel,
    defaultStrategyName: t('pages.kronosPredictor.defaultStrategyName'),
    validationErrorMessage: t('pages.kronosPredictor.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateKronosConfig,
    executeApi: executeKronosPrediction,
    buildStorageRequest: buildStorageRequestFromResult,
    errorMessages: KRONOS_ERROR_MESSAGES,
    getErrorMessage: getKronosErrorMessage,
  }), [llmProvider, llmModel, t, KRONOS_ERROR_MESSAGES, getKronosErrorMessage]);

  // ---------------------------------------------------------------------------
  // Unified Generate Workflow Hook
  // ---------------------------------------------------------------------------

  const { state, actions, llmAccess, codeDisplayRef } = useGenerateWorkflow(
    workflowConfig,
    { onSettingsClick },
    currentState,
    validationItems
  );

  // ---------------------------------------------------------------------------
  // Page-specific Handlers
  // ---------------------------------------------------------------------------

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    actions.setStrategyName(e.target.value);
  }, [actions]);

  const handleNewStrategy = useCallback(async () => {
    const confirmed = await globalThis.nexus?.window?.showConfirm(
      t('pages.common.newStrategyConfirmMsg'),
      { title: t('pages.common.newStrategyConfirmTitle') }
    );
    if (confirmed) {
      actions.resetNewStrategy();
      useKronosPredictorStore.getState().reset();
    }
  }, [actions, t]);

  const handleModelSelect = useCallback((model: string) => {
    setSelectedModel(model);
    const modelConfig = KRONOS_MODELS.find(m => m.id === model);
    const newMaxContext = modelConfig?.maxContext || 512;
    // Clamp lookback if it exceeds new model's max context
    if (lookback > newMaxContext) {
      setLookback(newMaxContext);
    }
  }, [lookback]);

  const handleApplyPreset = useCallback((presetId: string) => {
    const preset = PRESETS[presetId];
    if (!preset) return;

    setActivePreset(presetId);
    setLookback(Math.min(preset.lookback, maxLookback));
    setPredLen(preset.predLen);
    setTemperature(preset.temperature);
    setTopP(preset.topP);
    setTopK(preset.topK);
    setSampleCount(preset.sampleCount);
  }, [maxLookback]);

  // Build range text for lookback slider
  const lookbackRangeText = useMemo(() => {
    return t('pages.kronosPredictor.lookbackRangeText', { max: maxLookback });
  }, [maxLookback]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col bg-color-terminal-bg text-color-terminal-text">
      {/* TICKET_558: Zone A removed - title and settings icon merged into BreadcrumbBar */}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* ================================================================ */}
        {/* Zone B: Strategy Sidebar                                         */}
        {/* ================================================================ */}
        <div className="w-96 flex-shrink-0 border-r border-color-terminal-border bg-color-terminal-panel/30 p-4 overflow-y-auto">
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('pages.common.currentStrategy')}
            </label>
            <input
              type="text"
              value={state.strategyName}
              onChange={handleNameChange}
              placeholder={t('pages.kronosPredictor.strategyNamePlaceholder')}
              className="w-full px-3 py-2 text-xs border rounded focus:outline-none"
              style={{
                backgroundColor: THEME_COLORS.INPUT_BG,
                borderColor: THEME_COLORS.INPUT_BORDER,
                color: THEME_COLORS.INPUT_TEXT,
              }}
            />
            {/* Status Indicator + New Button */}
            <div className="flex items-center gap-2 text-[10px]">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  state.isSaved ? 'bg-color-terminal-accent-teal' : 'bg-color-terminal-text-muted'
                )}
              />
              <span
                className={cn(
                  state.isSaved ? 'text-color-terminal-accent-teal' : 'text-color-terminal-text-muted'
                )}
              >
                {state.isSaved ? t('pages.common.saved') : t('pages.common.unsaved')}
              </span>
              <button
                onClick={handleNewStrategy}
                disabled={state.isGenerating}
                className={cn(
                  'ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border transition-all',
                  'border-color-terminal-border text-color-terminal-text-muted hover:text-color-terminal-accent-teal hover:border-color-terminal-accent-teal',
                  state.isGenerating && 'opacity-40 pointer-events-none'
                )}
              >
                <Plus className="w-3 h-3" />
                {t('pages.common.newStrategy')}
              </button>
            </div>
          </div>
        </div>

        {/* Right Content Area (Zone C + Zone D) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ============================================================== */}
          {/* Zone C: Variable Content Area                                   */}
          {/* ============================================================== */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* TICKET_077_D3: Wrap input area with GenerateContentWrapper */}
            <GenerateContentWrapper
              isGenerating={state.isGenerating}
              loadingMessage={t('pages.kronosPredictor.loadingMessage')}
            >
              {/* Preset Configuration Buttons */}
              <PresetButtonGroup
                presets={MODEL_PRESETS}
                activePreset={activePreset}
                onSelect={handleApplyPreset}
                variant="full"
              />

              {/* Two-Column Layout for Config Panels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                {/* Left Column: Model & Prediction Config */}
                <div className="space-y-6">
                  {/* Model Selection */}
                  <div className="border border-color-terminal-border rounded-lg bg-color-terminal-surface p-4">
                    <ModelSelector
                      models={KRONOS_MODELS}
                      selectedModel={selectedModel}
                      onSelect={handleModelSelect}
                    />
                  </div>

                  {/* Prediction Configuration */}
                  <div className="border border-color-terminal-border rounded-lg bg-color-terminal-surface p-4">
                    <h3 className="font-mono text-sm font-bold uppercase tracking-widest text-color-terminal-accent-gold mb-4">
                      {t('pages.kronosPredictor.predictionConfigTitle')}
                    </h3>
                    <div className="space-y-4">
                      <SliderInputGroup
                        label={t('pages.kronosPredictor.historicalDataPointsLabel')}
                        value={lookback}
                        onChange={setLookback}
                        min={10}
                        max={maxLookback}
                        step={10}
                        rangeText={lookbackRangeText}
                      />
                      <SliderInputGroup
                        label={t('pages.kronosPredictor.predictionDataPointsLabel')}
                        value={predLen}
                        onChange={setPredLen}
                        min={1}
                        max={512}
                        step={1}
                        rangeText={t('pages.kronosPredictor.predLenRangeText')}
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column: Advanced Settings & Time Range */}
                <div className="space-y-6">
                  {/* Advanced Settings (Collapsible) */}
                  <CollapsiblePanel
                    title={t('pages.kronosPredictor.advancedSettingsTitle')}
                    defaultExpanded={false}
                  >
                    <div className="space-y-4">
                      <SliderInputGroup
                        label={t('pages.kronosPredictor.temperatureLabel')}
                        hint={t('pages.kronosPredictor.temperatureHint')}
                        value={temperature}
                        onChange={setTemperature}
                        min={0.1}
                        max={2.0}
                        step={0.1}
                        decimals={1}
                      />
                      <SliderInputGroup
                        label={t('pages.kronosPredictor.topPLabel')}
                        value={topP}
                        onChange={setTopP}
                        min={0.5}
                        max={1.0}
                        step={0.05}
                        decimals={2}
                      />
                      <SliderInputGroup
                        label={t('pages.kronosPredictor.topKLabel')}
                        hint={t('pages.kronosPredictor.topKHint')}
                        value={topK}
                        onChange={setTopK}
                        min={0}
                        max={256}
                        step={1}
                      />
                      {/* Sample Count */}
                      <div className="flex flex-col gap-2">
                        <label className="text-[13px] font-medium text-color-terminal-text">
                          {t('pages.kronosPredictor.sampleCountLabel')}
                          <span className="text-xs text-color-terminal-text-muted ml-1">
                            {t('pages.kronosPredictor.sampleCountHint')}
                          </span>
                        </label>
                        <select
                          value={sampleCount}
                          onChange={(e) => setSampleCount(Number(e.target.value))}
                          className={cn(
                            'w-full px-3 py-2',
                            'border border-color-terminal-border rounded',
                            'bg-color-terminal-surface text-color-terminal-text',
                            'text-[13px]',
                            'focus:outline-none focus:border-color-terminal-accent-teal',
                            'transition-colors duration-200'
                          )}
                        >
                          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </CollapsiblePanel>

                  {/* Time Range Selection */}
                  <div className="border border-color-terminal-border rounded-lg bg-color-terminal-surface p-4">
                    <TimeRangeSelector
                      mode={timeRangeMode}
                      customTime={customTime}
                      onModeChange={setTimeRangeMode}
                      onTimeChange={setCustomTime}
                    />
                  </div>
                </div>
              </div>

              {/* Signal Filter Panel (Full Width) */}
              <div className="mt-6">
                <SignalFilterPanel
                  config={signalFilter}
                  onChange={setSignalFilter}
                  sampleCount={sampleCount}
                  defaultExpanded={true}
                />
              </div>
            </GenerateContentWrapper>

            {/* ============================================================ */}
            {/* Result Display Area - component5: CodeDisplay                 */}
            {/* Shows when generating or when result is available             */}
            {/* ============================================================ */}
            {(state.generateResult || state.isGenerating) && (
              <div ref={codeDisplayRef} className="mt-8">
                <CodeDisplay
                  code={state.generateResult?.code || ''}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.kronosPredictor.generatedCodeTitle')}
                  language="python"
                  showLineNumbers={true}
                  maxHeight="400px"
                />
              </div>
            )}
          </div>

          {/* Zone D: Action Bar (TICKET_298) */}
          <GenerateActionBar
            isGenerating={state.isGenerating}
            hasResult={actions.hasResult}
            onGenerate={actions.handleStartGenerate}
            onCancel={actions.cancelGeneration}
            generateLabel={t('pages.kronosPredictor.generateLabel')}
            generatingLabel={t('pages.kronosPredictor.generatingLabel')}
            savedAlgorithmId={state.savedAlgorithmId}
            isCpp={state.isCpp}
          />
        </div>
      </div>

      {/* TICKET_518: BYOK First-Run Setup Dialog */}
      <BYOKSetupDialog
        isOpen={llmAccess.showSetupDialog}
        onComplete={llmAccess.onSetupComplete}
        onDismiss={llmAccess.closeSetupDialog}
      />

      {/* TICKET_190: API Key Prompt */}
      <ApiKeyPrompt
        isOpen={llmAccess.showPrompt}
        userTier={llmAccess.userTier}
        onConfigure={llmAccess.openSettings}
        onUpgrade={llmAccess.triggerUpgrade}
        onLogin={llmAccess.triggerLogin}
        onDismiss={llmAccess.closePrompt}
      />

      {/* TICKET_199: Naming Dialog */}
      <NamingDialog
        visible={state.namingDialogVisible}
        contextData={{ algorithm: t('pages.kronosPredictor.title') }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />
    </div>
  );
};

export default KronosPredictorPage;
