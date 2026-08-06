/**
 * AILiberoPage Component (page37)
 *
 * Agent Mode AI Libero workspace page for LLM-powered strategy generation
 * with advanced configuration options.
 *
 * Key difference from TraderAIEntryPage (page36):
 * - Uses /api/agent_llm instead of /api/llm_trader
 * - Includes AdvancedConfigPanel (component26) for Prediction Configuration
 * - signal_source: aiLibero
 *
 * @see TICKET_077_26 - AI Libero Page (page37)
 * @see TICKET_214 - Page 36 - Trader AI Entry (reference)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '../../lib/utils';
import { useAILiberoStore } from './useAILiberoStore';
import {
  TemplateToolbar,
  RawIndicatorSelector,
  RawIndicatorBlock,
  TraderPresetSelector,
  TraderPresetMode,
  ModeDetailsPanel,
  BespokeConfigPanel,
  BespokeConfig,
  DEFAULT_BESPOKE_CONFIG,
  PromptTextarea,
  CodeDisplay,
  ApiKeyPrompt,
  BYOKSetupDialog,
  NamingDialog,
  GenerateContentWrapper,
  IndicatorDefinition,
  IndicatorTemplateSelectorDialog,
  IndicatorTemplate,
  SaveTemplateDialog,
  UserIndicatorTemplate,
  AdvancedConfigPanel,
  PredictionConfig,
  DEFAULT_PREDICTION_CONFIG,
  getPresetPredictionConfig,
  GenerateActionBar,
} from '../ui';

// TICKET_077_D2: Unified Generate Workflow Hook
import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

// TICKET_077_26: AI Libero Service
import {
  executeAILibero,
  validateAILiberoConfig,
  getAILiberoErrorMessage,
  buildAILiberoRequest as buildAILiberoGenerationRequest,
  AILiberoConfig,
  AILiberoResult,
  loadTemplates,
  saveTemplate,
  getExistingTemplateNames,
} from '../../services/ai-libero-service';

// TICKET_077_D1: Centralized Algorithm Storage Service
import {
  buildAILiberoRequest,
  extractClassName,
  AlgorithmSaveRequest,
} from '../../services/algorithm-storage-service';
import { getCurrentUserIdAsString } from '../../utils/auth-utils';

// Import indicator data for RawIndicatorSelector
import { STRATEGY_INDICATOR_CATALOG as indicatorData } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface AILiberoPageProps {
  onSettingsClick?: (tab?: string) => void;
  /** Page title from navigation */
  pageTitle?: string;
  /** LLM provider setting from plugin config */
  llmProvider?: string;
  /** LLM model setting from plugin config */
  llmModel?: string;
}

/**
 * Page state for workflow config
 */
interface AILiberoState {
  presetMode: TraderPresetMode;
  bespokeConfig: BespokeConfig;
  predictionConfig: PredictionConfig;
  prompt: string;
  indicatorBlocks: RawIndicatorBlock[];
  storageMode: 'local' | 'remote' | 'hybrid';
  llmProvider: string;
  llmModel: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// TICKET_786_18: DEFAULT_PROMPT moved to i18n key pages.aiLibero.defaultPrompt

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

/**
 * Build API config from page state
 */
function buildApiConfig(state: AILiberoState, strategyName: string): AILiberoConfig {
  return {
    strategy_name: strategyName,
    preset_mode: state.presetMode,
    bespoke_config: state.presetMode === 'bespoke' ? state.bespokeConfig : undefined,
    prediction_config: state.predictionConfig,
    prompt: state.prompt,
    indicators: state.indicatorBlocks,
    llm_provider: state.llmProvider,
    llm_model: state.llmModel,
    storage_mode: state.storageMode,
  };
}

/**
 * Execute API call using ai-libero-service
 */
async function executeApi(config: AILiberoConfig, signal?: AbortSignal): Promise<GenerationResult> {
  console.log('[AILibero] Execute API with config:', config);

  const result = await executeAILibero(config, signal);

  if (result.status === 'completed' && result.strategy_code) {
    return {
      status: 'completed',
      strategy_code: result.strategy_code,
    };
  }

  const errorMessage = getAILiberoErrorMessage(result);
  return {
    status: 'failed',
    error: errorMessage,
    reason_code: result.reason_code || result.error?.error_code,
  };
}

/**
 * Build storage request from result
 */
async function buildStorageRequest(
  result: GenerationResult,
  state: AILiberoState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdAsString();
  return buildAILiberoRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      preset_mode: state.presetMode,
      bespoke_config: state.presetMode === 'bespoke' ? state.bespokeConfig : undefined,
      prediction_config: state.predictionConfig,
      prompt: state.prompt,
      indicators: state.indicatorBlocks,
      llm_provider: state.llmProvider,
      llm_model: state.llmModel,
    },
    userId
  );
}

// -----------------------------------------------------------------------------
// AILiberoPage Component
// -----------------------------------------------------------------------------

export const AILiberoPage: React.FC<AILiberoPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.aiLibero.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State (TICKET_1208 P6: Zustand store for form state)
  // ---------------------------------------------------------------------------

  const {
    presetMode, setPresetMode,
    bespokeConfig, setBespokeConfig,
    predictionConfig, setPredictionConfig,
    prompt, setPrompt,
    indicatorBlocks, setIndicatorBlocks,
  } = useAILiberoStore();

  // Store initializes prompt as ''; seed with i18n default on first mount
  useEffect(() => {
    if (!prompt) setPrompt(t('pages.aiLibero.defaultPrompt'));
  }, []);

  // Template dialog states
  const [isLoadDialogOpen, setIsLoadDialogOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [existingTemplateNames, setExistingTemplateNames] = useState<string[]>([]);

  // Sync prediction config with preset mode changes
  useEffect(() => {
    if (presetMode !== 'bespoke') {
      setPredictionConfig(getPresetPredictionConfig(presetMode));
    }
  }, [presetMode]);

  // ---------------------------------------------------------------------------
  // Template Toolbar Handlers
  // ---------------------------------------------------------------------------

  // Handle indicator template selection from Load Template dialog
  const handleSelectTemplate = useCallback((template: IndicatorTemplate) => {
    console.log('[AILibero] Loading indicator template:', template.name);

    if (template.indicators && template.indicators.length > 0) {
      const indicatorsWithNewIds = template.indicators.map((ind, index) => ({
        ...ind,
        id: `template_${Date.now()}_${index}`,
        field: ind.field || 'close',
      }));
      setIndicatorBlocks(indicatorsWithNewIds);
    }

    window.nexus?.window?.showNotification(
      t('pages.aiLibero.templateLoaded', { name: template.name, count: template.indicators.length }),
      'success'
    );
  }, [t]);

  const handleLoadTemplate = useCallback(() => {
    setIsLoadDialogOpen(true);
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    // Load existing names for duplicate check
    const names = await getExistingTemplateNames();
    setExistingTemplateNames(names);
    setIsSaveDialogOpen(true);
  }, []);

  const handleSaveTemplateConfirm = useCallback(async (template: UserIndicatorTemplate) => {
    try {
      await saveTemplate(template);
      setIsSaveDialogOpen(false);
      window.nexus?.window?.showNotification(
        t('pages.aiLibero.templateSaved', { name: template.name }),
        'success'
      );
    } catch (error) {
      console.error('[E:STRATEGY:AI_LIBERO_SAVE_TEMPLATE_FAILED] [AILibero] Failed to save template:', error);
      window.nexus?.window?.showNotification(
        t('pages.aiLibero.templateSaveFailed'),
        'error'
      );
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setPresetMode('monk');
    setBespokeConfig(DEFAULT_BESPOKE_CONFIG);
    setPredictionConfig(DEFAULT_PREDICTION_CONFIG);
    setPrompt(t('pages.aiLibero.defaultPrompt'));
    setIndicatorBlocks([]);
  }, [t]);

  const handleAddIndicator = useCallback(() => {
    const newBlock: RawIndicatorBlock = {
      id: `ind_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      indicatorSlug: null,
      field: 'close',
      paramValues: {},
    };
    setIndicatorBlocks(prev => [...prev, newBlock]);
  }, []);

  // Handle prediction config reset
  const handlePredictionConfigReset = useCallback(() => {
    setPredictionConfig(getPresetPredictionConfig(presetMode));
  }, [presetMode]);

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  const currentState: AILiberoState = useMemo(() => ({
    presetMode,
    bespokeConfig,
    predictionConfig,
    prompt,
    indicatorBlocks,
    storageMode: 'local',
    llmProvider,
    llmModel,
  }), [presetMode, bespokeConfig, predictionConfig, prompt, indicatorBlocks, llmProvider, llmModel]);

  // TICKET_396: Validation requires both prompt and at least one indicator
  const validationItems = useMemo(() => {
    const hasPrompt = prompt && prompt.trim().length >= 10;
    const hasIndicators = indicatorBlocks.some(b => b.indicatorSlug !== null);
    if (!hasPrompt || !hasIndicators) return [];
    return [{ prompt }, ...indicatorBlocks];
  }, [prompt, indicatorBlocks]);

  const workflowConfig = useMemo((): GenerateWorkflowConfig<AILiberoConfig, AILiberoState> => ({
    pageId: 'ai-libero-page',
    llmProvider,
    llmModel,
    defaultStrategyName: t('pages.aiLibero.defaultStrategyName'),
    validationErrorMessage: t('pages.aiLibero.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateAILiberoConfig,
    executeApi,
    buildGenerationRequest: buildAILiberoGenerationRequest,
    buildStorageRequest,
    getErrorMessage: (result) => getAILiberoErrorMessage(result as unknown as AILiberoResult),
  }), [llmProvider, llmModel]);

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
      useAILiberoStore.getState().reset();
    }
  }, [actions, t]);

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
              placeholder={t('pages.aiLibero.strategyNamePlaceholder')}
              className={cn(
                'w-full px-3 py-2 text-xs border rounded focus:outline-none',
                'bg-color-terminal-bg border-color-terminal-border text-color-terminal-text',
                'focus:border-color-terminal-accent-teal'
              )}
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
          <div className="flex-1 overflow-y-auto p-6">
            <GenerateContentWrapper
              isGenerating={state.isGenerating}
              loadingMessage={t('pages.aiLibero.loadingMessage')}
            >
              {/* component19: Template Toolbar */}
              <TemplateToolbar
                onLoadTemplate={handleLoadTemplate}
                onSave={handleSaveTemplate}
                onClearAll={handleClearAll}
                onAdd={handleAddIndicator}
                className="mb-6"
              />

              {/* component20: Raw Indicator Selector (Optional context) */}
              {indicatorBlocks.length > 0 && (
                <div className="mb-6">
                  <RawIndicatorSelector
                    indicators={indicatorData as IndicatorDefinition[]}
                    blocks={indicatorBlocks}
                    onChange={setIndicatorBlocks}
                    title={t('pages.aiLibero.indicatorContextTitle')}
                  />
                </div>
              )}

              {/* component21: Trader Preset Selector */}
              <TraderPresetSelector
                selectedPreset={presetMode}
                onSelect={setPresetMode}
                className="mb-6"
              />

              {/* component22: Mode Details Panel (hidden when bespoke) */}
              <ModeDetailsPanel
                mode={presetMode}
                className="mb-6"
              />

              {/* component23: Bespoke Config Panel (shown when bespoke) */}
              {presetMode === 'bespoke' && (
                <BespokeConfigPanel
                  config={bespokeConfig}
                  onChange={setBespokeConfig}
                  className="mb-6"
                />
              )}

              {/* component24: Prompt Textarea */}
              <PromptTextarea
                title={t('pages.aiLibero.analysisPromptTitle')}
                value={prompt}
                onChange={setPrompt}
                placeholder={t('pages.aiLibero.analysisPromptPlaceholder')}
                rows={8}
                className="mb-6"
              />

              {/* component26: Advanced Config Panel */}
              <AdvancedConfigPanel
                presetMode={presetMode}
                predictionConfig={predictionConfig}
                onPredictionConfigChange={setPredictionConfig}
                onReset={handlePredictionConfigReset}
                className="mb-6"
              />
            </GenerateContentWrapper>

            {/* ============================================================ */}
            {/* Result Display Area - component5: CodeDisplay                 */}
            {/* ============================================================ */}
            {(state.generateResult || state.isGenerating) && (
              <div ref={codeDisplayRef} className="mt-8">
                <CodeDisplay
                  code={state.generateResult?.code || ''}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.aiLibero.generatedCodeTitle')}
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
            generateLabel={t('pages.aiLibero.generateLabel')}
            generatingLabel={t('pages.aiLibero.generatingLabel')}
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
        contextData={{ algorithm: 'AILibero' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />

      {/* TICKET_212: Load Indicator Template Dialog */}
      <IndicatorTemplateSelectorDialog
        isOpen={isLoadDialogOpen}
        onClose={() => setIsLoadDialogOpen(false)}
        onSelect={handleSelectTemplate}
        title={t('pages.aiLibero.loadIndicatorTemplateTitle')}
        emptyMessage={t('pages.aiLibero.noTemplatesAvailable')}
      />

      {/* TICKET_214: Save Template Dialog */}
      <SaveTemplateDialog
        isOpen={isSaveDialogOpen}
        onClose={() => setIsSaveDialogOpen(false)}
        onSave={handleSaveTemplateConfirm}
        indicators={indicatorBlocks}
        existingNames={existingTemplateNames}
      />
    </div>
  );
};

export default AILiberoPage;
