/**
 * RegimeDetectorPage Component
 *
 * Market Regime Detector page following TICKET_077 layout specification.
 * Zones: A (Header), B (Sidebar), C (Content), D (Action Bar)
 *
 * TICKET_077_D2: Uses unified useGenerateWorkflow hook
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_077_D2 - Unified Generate Workflow
 * @see TICKET_078 - Input Theming and Portal Patterns
 */

import React, { useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '../../lib/utils';
import {
  RegimeSelector,
  BespokeData,
  ExpressionInput,
  StrategyCard,
  IndicatorSelector,
  IndicatorBlock,
  IndicatorDefinition,
  StrategyTemplate,
  CodeDisplay,
  ApiKeyPrompt,
  BYOKSetupDialog,
  NamingDialog,
  GenerateContentWrapper,
  SignalModeSelector,
  SignalMode,
  GenerateActionBar,
} from '../ui';

// TICKET_077_D2: Unified Generate Workflow Hook
import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

// TICKET_1208 P6: Form state preserved across view switches
import { useRegimeDetectorStore } from './useRegimeDetectorStore';

// Services - import from specific modules for consistency
import {
  executeMarketRegimeAnalysis,
  validateMarketRegimeConfig,
  getErrorMessage,
  buildMarketRegimeRequest,
} from '../../services/market-regime-service';
import type { MarketRegimeRule, MarketRegimeConfig, MarketRegimeResult } from '../../services/market-regime-service';
import {
  buildRegimeDetectorRequest,
  extractClassName,
} from '../../services/algorithm-storage-service';
import type { AlgorithmSaveRequest } from '../../services/algorithm-storage-service';
import { getCurrentUserIdOrLocal } from '../../utils/auth-utils';

// Import indicator data
import {
  STRATEGY_INDICATOR_CATALOG as indicatorData,
  STRATEGY_TEMPLATE_CATALOG as strategyTemplates,
  resolveRegimeStrategyName,
} from '@StratCraft/types';
import { THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

import type { Strategy } from './useRegimeDetectorStore';

interface RegimeDetectorPageProps {
  onSettingsClick?: (tab?: string) => void;
  /** Page title from navigation - uses feature name from PluginHub button */
  pageTitle?: string;
  /** LLM provider setting from plugin config */
  llmProvider?: string;
  /** LLM model setting from plugin config */
  llmModel?: string;
}

/**
 * Page state passed to workflow config builders
 */
interface RegimeDetectorState {
  selectedRegime: string;
  bespokeData: BespokeData;
  indicatorBlocks: IndicatorBlock[];
  strategies: Strategy[];
  storageMode: 'local' | 'remote' | 'hybrid';
  llmProvider: string;
  llmModel: string;
  /** TICKET_260: Signal mode for auto-reverse feature */
  signalMode: SignalMode;
}

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

/**
 * Build rules array from page state
 */
function buildRulesFromState(state: RegimeDetectorState): MarketRegimeRule[] {
  const rules: MarketRegimeRule[] = [];

  // Add indicator-based rules
  for (const ind of state.indicatorBlocks) {
    if (!ind.indicatorSlug) continue;

    const thresholdValue = ind.ruleThresholdValue;
    const validThreshold = (thresholdValue !== undefined && thresholdValue !== null)
      ? thresholdValue
      : 0;

    rules.push({
      rule_type: 'template_based',
      indicator: {
        slug: ind.indicatorSlug,
        name: ind.indicatorSlug,
        params: ind.paramValues as Record<string, unknown>,
      },
      strategy: {
        logic: {
          type: ind.templateKey || 'threshold_level',
          operator: ind.ruleOperator || '>',
          threshold_value: validThreshold,
        },
      },
      // TICKET_260: Pass category for manual mode support
      category: ind.category,
    });
  }

  // Add custom expression rules
  for (const expr of state.strategies) {
    rules.push({
      rule_type: 'custom_expression',
      expression: expr.expression,
    });
  }

  return rules;
}

/**
 * Build API config from page state
 */
function buildApiConfig(state: RegimeDetectorState, strategyName: string): MarketRegimeConfig {
  // Build regime value
  let regimeValue = state.selectedRegime;
  if (regimeValue === 'bespoke' && state.bespokeData?.name) {
    regimeValue = `bespoke_${state.bespokeData.name}`;
  }

  return {
    regime: regimeValue,
    rules: buildRulesFromState(state),
    strategy_name: strategyName,
    bespoke_notes: state.bespokeData?.notes,
    llm_provider: state.llmProvider,
    llm_model: state.llmModel,
    storage_mode: state.storageMode,
    // TICKET_260: Auto-reverse mode
    auto_reverse: state.signalMode === 'auto-reverse',
  };
}

/**
 * Build storage request from API result
 */
async function buildStorageRequestFromResult(
  result: GenerationResult,
  state: RegimeDetectorState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdOrLocal();
  const request = buildRegimeDetectorRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      regime: state.selectedRegime,
      llm_provider: state.llmProvider,
      llm_model: state.llmModel,
      indicators: state.indicatorBlocks,
      rules: state.strategies.map(s => ({ expression: s.expression })),
    },
    userId
  );
  request.language = result.language;
  return request;
}

// -----------------------------------------------------------------------------
// RegimeDetectorPage Component
// -----------------------------------------------------------------------------

export const RegimeDetectorPage: React.FC<RegimeDetectorPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.regimeDetector.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State (UI inputs) — TICKET_1208 P6: preserved via Zustand
  // ---------------------------------------------------------------------------

  const {
    strategies, setStrategies,
    selectedRegime, setSelectedRegime,
    bespokeData, setBespokeData,
    indicatorBlocks, setIndicatorBlocks,
    signalMode, setSignalMode,
  } = useRegimeDetectorStore();

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  // Current page state for workflow
  const currentState: RegimeDetectorState = useMemo(() => ({
    selectedRegime,
    bespokeData,
    indicatorBlocks,
    strategies,
    storageMode: 'local',
    llmProvider,
    llmModel,
    signalMode,
  }), [selectedRegime, bespokeData, indicatorBlocks, strategies, llmProvider, llmModel, signalMode]);

  // Validation items
  const allRules = useMemo(() => [
    ...indicatorBlocks,
    ...strategies.map(s => ({ type: 'custom_expression', expression: s.expression })),
  ], [indicatorBlocks, strategies]);

  // Workflow config
  const workflowConfig = useMemo((): GenerateWorkflowConfig<MarketRegimeConfig, RegimeDetectorState> => ({
    pageId: 'regime-detector-page',
    llmProvider,
    llmModel,
    defaultStrategyName: resolveRegimeStrategyName(
      undefined,
      t('pages.regimeDetector.defaultStrategyName'),
    ),
    validationErrorMessage: t('pages.regimeDetector.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateMarketRegimeConfig,
    executeApi: executeMarketRegimeAnalysis as (config: MarketRegimeConfig, signal?: AbortSignal) => Promise<GenerationResult>,
    buildGenerationRequest: buildMarketRegimeRequest,
    buildStorageRequest: buildStorageRequestFromResult,
    getErrorMessage: (result) => getErrorMessage(result as unknown as MarketRegimeResult),
  }), [llmProvider, llmModel]);

  // ---------------------------------------------------------------------------
  // Unified Generate Workflow Hook
  // ---------------------------------------------------------------------------

  const { state, actions, llmAccess, codeDisplayRef } = useGenerateWorkflow(
    workflowConfig,
    { onSettingsClick },
    currentState,
    allRules
  );

  // ---------------------------------------------------------------------------
  // Page-specific Handlers
  // ---------------------------------------------------------------------------

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    actions.setStrategyName(e.target.value);
  }, [actions]);

  const handleAddStrategy = useCallback((expression: string) => {
    const newStrategy: Strategy = {
      id: `strategy-${Date.now()}`,
      expression,
    };
    setStrategies(prev => [...prev, newStrategy]);
  }, []);

  const handleDeleteStrategy = useCallback((id: string) => {
    setStrategies(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleNewStrategy = useCallback(async () => {
    const confirmed = await globalThis.nexus?.window?.showConfirm(
      t('pages.common.newStrategyConfirmMsg'),
      { title: t('pages.common.newStrategyConfirmTitle') }
    );
    if (confirmed) {
      actions.resetNewStrategy();
      useRegimeDetectorStore.getState().reset();
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
              placeholder={t('pages.regimeDetector.strategyNamePlaceholder')}
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

          {/* TICKET_260: Signal Mode Selector */}
          <SignalModeSelector
            value={signalMode}
            onChange={setSignalMode}
            context="detector"
            className="mt-6"
          />
        </div>

        {/* Right Content Area (Zone C + Zone D) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ============================================================== */}
          {/* Zone C: Variable Content Area                                   */}
          {/* ============================================================== */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* TICKET_077_D3: Wrap input area with GenerateContentWrapper */}
            <GenerateContentWrapper
              isGenerating={state.isGenerating}
              loadingMessage={t('pages.regimeDetector.loadingMessage')}
            >
              {/* component2: Regime Selector */}
              <RegimeSelector
                selectedRegime={selectedRegime}
                onSelect={setSelectedRegime}
                bespokeData={bespokeData}
                onBespokeChange={setBespokeData}
                className="mb-8"
              />

              {/* component3: Indicator Selector */}
              <IndicatorSelector
                indicators={indicatorData as IndicatorDefinition[]}
                templates={strategyTemplates as Record<string, StrategyTemplate>}
                blocks={indicatorBlocks}
                onChange={setIndicatorBlocks}
                className="mb-8"
              />

              {/* component1: Expression Builder (Input + Cards) */}
              <ExpressionInput
                onAdd={handleAddStrategy}
                className="mb-6"
              />

              {/* Strategy Cards */}
              {strategies.length > 0 && (
                <div className="space-y-3">
                  {strategies.map((strategy) => (
                    <StrategyCard
                      key={strategy.id}
                      id={strategy.id}
                      expression={strategy.expression}
                      onDelete={handleDeleteStrategy}
                    />
                  ))}
                </div>
              )}
            </GenerateContentWrapper>

            {/* ============================================================ */}
            {/* Result Display Area - component5: CodeDisplay                 */}
            {/* (Outside wrapper - always visible during generation)          */}
            {/* ============================================================ */}
            {(state.generateResult || state.isGenerating) && (
              <div ref={codeDisplayRef} className="mt-8">
                <CodeDisplay
                  code={state.generateResult?.code || ''}
                  language={state.generateResult?.language === 'cpp' ? 'cpp' : 'python'}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.regimeDetector.generatedCodeTitle')}
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
            generateLabel={t('pages.regimeDetector.generateLabel')}
            generatingLabel={t('pages.regimeDetector.generatingLabel')}
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
        contextData={{ algorithm: selectedRegime || 'Regime' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />
    </div>
  );
};

export default RegimeDetectorPage;
