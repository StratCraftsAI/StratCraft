/**
 * KronosIndicatorEntryPage Component (page33)
 *
 * Kronos Indicator Entry page following TICKET_077 layout specification.
 * Zones: A (Header), B (Sidebar), C (Content), D (Action Bar)
 *
 * Key difference from EntrySignalPage:
 * - NO RegimeSelector component (Kronos uses time-series prediction, not market state)
 * - Uses kronos-indicator-entry-service instead of regime-indicator-entry-service
 *
 * TICKET_208: Kronos Indicator Entry Page Migration
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_077_D2 - Unified Generate Workflow
 * @see TICKET_208 - Kronos Indicator Entry Page Migration
 */

import React, { useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '../../lib/utils';
import {
  // NO RegimeSelector - Kronos mode does not use market regime
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
  GenerateActionBar,
} from '../ui';

// TICKET_077_D2: Unified Generate Workflow Hook
import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

// Services - Kronos specific service
import {
  executeKronosIndicatorEntry,
  validateKronosIndicatorEntryConfig,
  KronosIndicatorRule,
  getKronosEntryErrorMessage,
  buildKronosIndicatorEntryRequest as buildKronosIndicatorEntryGenerationRequest,
} from '../../services/kronos-indicator-entry-service';
import type { KronosIndicatorEntryConfig, KronosIndicatorEntryResult } from '../../services/kronos-indicator-entry-service';
import {
  buildKronosIndicatorEntryRequest,
  extractClassName,
} from '../../services/algorithm-storage-service';
import type { AlgorithmSaveRequest } from '../../services/algorithm-storage-service';
import { getCurrentUserIdAsString } from '../../utils/auth-utils';

// Import indicator data
import {
  STRATEGY_INDICATOR_CATALOG as indicatorData,
  STRATEGY_TEMPLATE_CATALOG as strategyTemplates,
} from '@StratCraft/types';
import { THEME_COLORS } from '@shared/constants/colors';
import { useKronosIndicatorEntryStore } from './useKronosIndicatorEntryStore';
import type { Strategy } from './useKronosIndicatorEntryStore';


// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface KronosIndicatorEntryPageProps {
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
interface KronosIndicatorEntryState {
  // NO selectedRegime - Kronos mode does not use market regime
  indicatorBlocks: IndicatorBlock[];
  strategies: Strategy[];
  storageMode: 'local' | 'remote' | 'hybrid';
  llmProvider: string;
  llmModel: string;
}

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

/**
 * Build rules array from page state
 */
function buildRulesFromState(state: KronosIndicatorEntryState): KronosIndicatorRule[] {
  const rules: KronosIndicatorRule[] = [];

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
 * Key difference: NO entry_signal_base parameter
 */
function buildApiConfig(state: KronosIndicatorEntryState, strategyName: string): KronosIndicatorEntryConfig {
  return {
    strategy_name: strategyName,
    rules: buildRulesFromState(state),
    // NO entry_signal_base - Kronos mode does not use market regime
    llm_provider: state.llmProvider,
    llm_model: state.llmModel,
    storage_mode: state.storageMode,
  };
}

/**
 * Build storage request from API result
 * Converts page state to algorithm-storage-service format
 */
async function buildStorageRequestFromResult(
  result: GenerationResult,
  state: KronosIndicatorEntryState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdAsString();
  // Convert indicatorBlocks to longEntryIndicators format
  const longEntryIndicators = state.indicatorBlocks.map(block => ({
    indicator: {
      slug: block.indicatorSlug,
      name: block.indicatorSlug,
      params: block.paramValues,
    },
    strategy: {
      type: block.templateKey || 'threshold_level',
      logic: {
        operator: block.ruleOperator || '>',
        threshold_value: block.ruleThresholdValue ?? 0,
      },
    },
  }));

  return buildKronosIndicatorEntryRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
      entry_signal_base: 'kronos', // Kronos mode indicator entry
    },
    {
      longEntryIndicators,
      shortEntryIndicators: [],
    },
    userId
  );
}

// -----------------------------------------------------------------------------
// KronosIndicatorEntryPage Component
// -----------------------------------------------------------------------------

export const KronosIndicatorEntryPage: React.FC<KronosIndicatorEntryPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.kronosIndicatorEntry.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State (UI inputs)
  // NO selectedRegime, NO bespokeData - Kronos mode does not use market regime
  // TICKET_1208 P6: Zustand store preserves form inputs across view switches
  // ---------------------------------------------------------------------------

  const {
    strategies, setStrategies,
    indicatorBlocks, setIndicatorBlocks,
  } = useKronosIndicatorEntryStore();

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  // Current page state for workflow
  const currentState: KronosIndicatorEntryState = useMemo(() => ({
    indicatorBlocks,
    strategies,
    storageMode: 'local',
    llmProvider,
    llmModel,
  }), [indicatorBlocks, strategies, llmProvider, llmModel]);

  // Validation items
  const allRules = useMemo(() => [
    ...indicatorBlocks,
    ...strategies.map(s => ({ type: 'custom_expression', expression: s.expression })),
  ], [indicatorBlocks, strategies]);

  // Workflow config
  const workflowConfig = useMemo((): GenerateWorkflowConfig<KronosIndicatorEntryConfig, KronosIndicatorEntryState> => ({
    pageId: 'kronos-indicator-entry-page',
    llmProvider,
    llmModel,
    defaultStrategyName: t('pages.kronosIndicatorEntry.defaultStrategyName'),
    validationErrorMessage: t('pages.kronosIndicatorEntry.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateKronosIndicatorEntryConfig,
    executeApi: executeKronosIndicatorEntry as (config: KronosIndicatorEntryConfig, signal?: AbortSignal) => Promise<GenerationResult>,
    buildGenerationRequest: buildKronosIndicatorEntryGenerationRequest,
    buildStorageRequest: buildStorageRequestFromResult,
    getErrorMessage: (result) => getKronosEntryErrorMessage(result as unknown as KronosIndicatorEntryResult),
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
      useKronosIndicatorEntryStore.getState().reset();
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
              placeholder={t('pages.kronosIndicatorEntry.strategyNamePlaceholder')}
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
          {/* KEY DIFFERENCE: NO RegimeSelector component                     */}
          {/* ============================================================== */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* TICKET_077_D3: Wrap input area with GenerateContentWrapper */}
            <GenerateContentWrapper
              isGenerating={state.isGenerating}
              loadingMessage={t('pages.kronosIndicatorEntry.loadingMessage')}
            >
              {/* NO RegimeSelector - Kronos mode does not use market regime */}

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
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.kronosIndicatorEntry.generatedCodeTitle')}
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
            generateLabel={t('pages.kronosIndicatorEntry.generateLabel')}
            generatingLabel={t('pages.kronosIndicatorEntry.generatingLabel')}
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
        contextData={{ algorithm: 'KronosIndicatorEntry' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />
    </div>
  );
};

export default KronosIndicatorEntryPage;
