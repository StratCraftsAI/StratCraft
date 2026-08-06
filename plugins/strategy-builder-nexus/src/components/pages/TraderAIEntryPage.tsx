/**
 * TraderAIEntryPage Component (page36)
 *
 * Trader Mode AI Entry page for LLM-powered strategy generation.
 * Uses preset-based configuration (Baseline/Monk/Warrior/Bespoke) with full template management.
 *
 * Key difference from KronosAIEntryPage (page34):
 * - Uses /api/llm_trader instead of /api/kronos_llm_entry
 * - Full template save/load functionality with SaveTemplateDialog
 * - TraderModeConfig request format matching web implementation
 *
 * @see TICKET_214 - Page 36 - Trader Mode AI Entry
 * @see TICKET_077_19 - Kronos AI Entry Components (shared)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '../../lib/utils';
import { useTraderAIEntryStore } from './useTraderAIEntryStore';
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
  GenerateActionBar,
} from '../ui';

// TICKET_077_D2: Unified Generate Workflow Hook
import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

// TICKET_214: Trader AI Entry Service
import {
  executeTraderAIEntry,
  validateTraderAIEntryConfig,
  getTraderAIEntryErrorMessage,
  buildTraderAIEntryRequest as buildTraderAIEntryGenerationRequest,
  TraderAIEntryConfig,
  TraderAIEntryResult,
  loadTemplates,
  saveTemplate,
  getExistingTemplateNames,
} from '../../services/trader-ai-entry-service';

// TICKET_077_D1: Centralized Algorithm Storage Service
import {
  buildTraderAIEntryRequest,
  extractClassName,
  AlgorithmSaveRequest,
} from '../../services/algorithm-storage-service';
import { getCurrentUserIdAsString } from '../../utils/auth-utils';

// Import indicator data for RawIndicatorSelector
import { STRATEGY_INDICATOR_CATALOG as indicatorData } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface TraderAIEntryPageProps {
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
interface TraderAIEntryState {
  presetMode: TraderPresetMode;
  bespokeConfig: BespokeConfig;
  prompt: string;
  indicatorBlocks: RawIndicatorBlock[];
  storageMode: 'local' | 'remote' | 'hybrid';
  llmProvider: string;
  llmModel: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// TICKET_786_18: DEFAULT_PROMPT moved to i18n key pages.traderAIEntry.defaultPrompt

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

/**
 * Build API config from page state
 */
function buildApiConfig(state: TraderAIEntryState, strategyName: string): TraderAIEntryConfig {
  return {
    strategy_name: strategyName,
    preset_mode: state.presetMode,
    bespoke_config: state.presetMode === 'bespoke' ? state.bespokeConfig : undefined,
    prompt: state.prompt,
    indicators: state.indicatorBlocks,
    llm_provider: state.llmProvider,
    llm_model: state.llmModel,
    storage_mode: state.storageMode,
  };
}

/**
 * Execute API call using trader-ai-entry-service
 */
async function executeApi(config: TraderAIEntryConfig, signal?: AbortSignal): Promise<GenerationResult> {
  console.log('[TraderAIEntry] Execute API with config:', config);

  const result = await executeTraderAIEntry(config, signal);

  if (result.status === 'completed' && result.strategy_code) {
    return {
      status: 'completed',
      strategy_code: result.strategy_code,
    };
  }

  const errorMessage = getTraderAIEntryErrorMessage(result);
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
  state: TraderAIEntryState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdAsString();
  const request = buildTraderAIEntryRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      preset_mode: state.presetMode,
      bespoke_config: state.presetMode === 'bespoke' ? state.bespokeConfig : undefined,
      prompt: state.prompt,
      indicators: state.indicatorBlocks,
      llm_provider: state.llmProvider,
      llm_model: state.llmModel,
    },
    userId
  );
  request.language = result.language;
  return request;
}

// -----------------------------------------------------------------------------
// TraderAIEntryPage Component
// -----------------------------------------------------------------------------

export const TraderAIEntryPage: React.FC<TraderAIEntryPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.traderAIEntry.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State (TICKET_1208 P6: form state in Zustand store)
  // ---------------------------------------------------------------------------

  const {
    presetMode, setPresetMode,
    bespokeConfig, setBespokeConfig,
    prompt, setPrompt,
    indicatorBlocks, setIndicatorBlocks,
  } = useTraderAIEntryStore();

  // Seed default prompt on first mount if store is empty
  useEffect(() => {
    if (!prompt) setPrompt(t('pages.traderAIEntry.defaultPrompt'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Template dialog states
  const [isLoadDialogOpen, setIsLoadDialogOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [existingTemplateNames, setExistingTemplateNames] = useState<string[]>([]);

  // ---------------------------------------------------------------------------
  // Template Toolbar Handlers
  // ---------------------------------------------------------------------------

  // Handle indicator template selection from Load Template dialog
  const handleSelectTemplate = useCallback((template: IndicatorTemplate) => {
    console.log('[TraderAIEntry] Loading indicator template:', template.name);

    if (template.indicators && template.indicators.length > 0) {
      const indicatorsWithNewIds = template.indicators.map((ind, index) => ({
        ...ind,
        id: `template_${Date.now()}_${index}`,
        field: ind.field || 'close',
      }));
      setIndicatorBlocks(indicatorsWithNewIds);
    }

    window.nexus?.window?.showNotification(
      t('pages.traderAIEntry.templateLoaded', { name: template.name, count: template.indicators.length }),
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
        t('pages.traderAIEntry.templateSaved', { name: template.name }),
        'success'
      );
    } catch (error) {
      console.error('[E:STRATEGY:TRADER_AI_SAVE_TEMPLATE_FAILED] [TraderAIEntry] Failed to save template:', error);
      window.nexus?.window?.showNotification(
        t('pages.traderAIEntry.templateSaveFailed'),
        'error'
      );
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setPresetMode('monk');
    setBespokeConfig(DEFAULT_BESPOKE_CONFIG);
    setPrompt(t('pages.traderAIEntry.defaultPrompt'));
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

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  const currentState: TraderAIEntryState = useMemo(() => ({
    presetMode,
    bespokeConfig,
    prompt,
    indicatorBlocks,
    storageMode: 'local',
    llmProvider,
    llmModel,
  }), [presetMode, bespokeConfig, prompt, indicatorBlocks, llmProvider, llmModel]);

  // TICKET_396: Validation requires both prompt and at least one indicator
  const validationItems = useMemo(() => {
    const hasPrompt = prompt && prompt.trim().length >= 10;
    const hasIndicators = indicatorBlocks.some(b => b.indicatorSlug !== null);
    if (!hasPrompt || !hasIndicators) return [];
    return [{ prompt }, ...indicatorBlocks];
  }, [prompt, indicatorBlocks]);

  const workflowConfig = useMemo((): GenerateWorkflowConfig<TraderAIEntryConfig, TraderAIEntryState> => ({
    pageId: 'trader-ai-entry-page',
    llmProvider,
    llmModel,
    defaultStrategyName: t('pages.traderAIEntry.defaultStrategyName'),
    validationErrorMessage: t('pages.traderAIEntry.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateTraderAIEntryConfig,
    executeApi,
    buildGenerationRequest: buildTraderAIEntryGenerationRequest,
    buildStorageRequest,
    getErrorMessage: (result) => getTraderAIEntryErrorMessage(result as unknown as TraderAIEntryResult),
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
      useTraderAIEntryStore.getState().reset();
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
              placeholder={t('pages.traderAIEntry.strategyNamePlaceholder')}
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
              loadingMessage={t('pages.traderAIEntry.loadingMessage')}
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
                    title={t('pages.traderAIEntry.indicatorContextTitle')}
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
                title={t('pages.traderAIEntry.analysisPromptTitle')}
                value={prompt}
                onChange={setPrompt}
                placeholder={t('pages.traderAIEntry.analysisPromptPlaceholder')}
                rows={8}
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
                  language={state.generateResult?.language === 'cpp' ? 'cpp' : 'python'}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.traderAIEntry.generatedCodeTitle')}
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
            generateLabel={t('pages.traderAIEntry.generateLabel')}
            generatingLabel={t('pages.traderAIEntry.generatingLabel')}
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
        contextData={{ algorithm: 'TraderAIEntry' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />

      {/* TICKET_212: Load Indicator Template Dialog */}
      <IndicatorTemplateSelectorDialog
        isOpen={isLoadDialogOpen}
        onClose={() => setIsLoadDialogOpen(false)}
        onSelect={handleSelectTemplate}
        title={t('pages.traderAIEntry.loadIndicatorTemplateTitle')}
        emptyMessage={t('pages.traderAIEntry.noTemplatesAvailable')}
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

export default TraderAIEntryPage;
