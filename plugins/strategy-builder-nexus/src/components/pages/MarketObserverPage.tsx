/**
 * MarketObserverPage Component (Page 35)
 *
 * Market Observer workspace page for defining market preconditions
 * and watchlist operations within Trader Mode.
 *
 * @see TICKET_077_1 - Page Hierarchy (page35)
 * @see TICKET_202 - Builder Page Base Class Mapping
 */

import React, { useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores';
import { cn } from '../../lib/utils';
import { useMarketObserverStore } from './useMarketObserverStore';
import {
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

// Services
import {
  executeMarketObserverGeneration,
  validateMarketObserverConfig,
  getErrorMessage,
  buildMarketObserverRequest as buildMarketObserverGenerationRequest,
} from '../../services/market-observer-service';
import type {
  MarketObserverConfig,
  MarketObserverResult,
  MarketObserverRule,
} from '../../services/market-observer-service';
import {
  buildMarketObserverRequest,
  extractClassName,
} from '../../services/algorithm-storage-service';
import type { AlgorithmSaveRequest } from '../../services/algorithm-storage-service';
import { getCurrentUserIdOrLocal } from '../../utils/auth-utils';

// Import indicator data
import {
  STRATEGY_INDICATOR_CATALOG as indicatorData,
  STRATEGY_TEMPLATE_CATALOG as strategyTemplates,
} from '@StratCraft/types';
import { THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface MarketObserverPageProps {
  onSettingsClick?: (tab?: string) => void;
  pageTitle?: string;
  llmProvider?: string;
  llmModel?: string;
}

interface MarketObserverState {
  indicatorBlocks: IndicatorBlock[];
  storageMode: 'local' | 'remote' | 'hybrid';
  llmProvider: string;
  llmModel: string;
}

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

function buildRulesFromState(state: MarketObserverState): MarketObserverRule[] {
  const rules: MarketObserverRule[] = [];

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

  return rules;
}

function buildApiConfig(state: MarketObserverState, strategyName: string): MarketObserverConfig {
  return {
    rules: buildRulesFromState(state),
    strategy_name: strategyName,
    llm_provider: state.llmProvider,
    llm_model: state.llmModel,
    storage_mode: state.storageMode,
  };
}

async function buildStorageRequestFromResult(
  result: GenerationResult,
  state: MarketObserverState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdOrLocal();
  return buildMarketObserverRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      llm_provider: state.llmProvider,
      llm_model: state.llmModel,
      indicators: state.indicatorBlocks,
      rules: [],
    },
    userId
  );
}

// -----------------------------------------------------------------------------
// MarketObserverPage Component
// -----------------------------------------------------------------------------

export const MarketObserverPage: React.FC<MarketObserverPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.marketObserver.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State
  // ---------------------------------------------------------------------------

  const { indicatorBlocks, setIndicatorBlocks } = useMarketObserverStore();

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  const currentState: MarketObserverState = useMemo(() => ({
    indicatorBlocks,
    storageMode: 'local',
    llmProvider,
    llmModel,
  }), [indicatorBlocks, llmProvider, llmModel]);

  // Validation items
  const allRules = useMemo(() => [
    ...indicatorBlocks,
  ], [indicatorBlocks]);

  // Workflow config
  const workflowConfig = useMemo((): GenerateWorkflowConfig<MarketObserverConfig, MarketObserverState> => ({
    pageId: 'market-observer-page',
    llmProvider,
    llmModel,
    defaultStrategyName: t('pages.marketObserver.defaultStrategyName'),
    validationErrorMessage: t('pages.marketObserver.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateMarketObserverConfig,
    executeApi: executeMarketObserverGeneration as (config: MarketObserverConfig, signal?: AbortSignal) => Promise<GenerationResult>,
    buildGenerationRequest: buildMarketObserverGenerationRequest,
    buildStorageRequest: buildStorageRequestFromResult,
    getErrorMessage: (result) => getErrorMessage(result as unknown as MarketObserverResult),
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

  const handleNewStrategy = useCallback(async () => {
    const confirmed = await globalThis.nexus?.window?.showConfirm(
      t('pages.common.newStrategyConfirmMsg'),
      { title: t('pages.common.newStrategyConfirmTitle') }
    );
    if (confirmed) {
      actions.resetNewStrategy();
      useMarketObserverStore.getState().reset();
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
        {/* Zone B: Strategy Sidebar */}
        <div className="w-96 flex-shrink-0 border-r border-color-terminal-border bg-color-terminal-panel/30 p-4 overflow-y-auto">
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('pages.common.currentStrategy')}
            </label>
            <input
              type="text"
              value={state.strategyName}
              onChange={handleNameChange}
              placeholder={t('pages.marketObserver.strategyNamePlaceholder')}
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
          {/* Zone C: Variable Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            <GenerateContentWrapper
              isGenerating={state.isGenerating}
              loadingMessage={t('pages.marketObserver.loadingMessage')}
            >
              {/* Indicator Selector */}
              <IndicatorSelector
                indicators={indicatorData as IndicatorDefinition[]}
                templates={strategyTemplates as Record<string, StrategyTemplate>}
                blocks={indicatorBlocks}
                onChange={setIndicatorBlocks}
                context="watchlist"
                className="mb-8"
              />
            </GenerateContentWrapper>

            {/* Result Display Area */}
            {(state.generateResult || state.isGenerating) && (
              <div ref={codeDisplayRef} className="mt-8">
                <CodeDisplay
                  code={state.generateResult?.code || ''}
                  language={state.generateResult?.language === 'cpp' ? 'cpp' : 'python'}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.marketObserver.generatedCodeTitle')}
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
            generateLabel={t('pages.marketObserver.generateLabel')}
            generatingLabel={t('pages.marketObserver.generatingLabel')}
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

      {/* API Key Prompt */}
      <ApiKeyPrompt
        isOpen={llmAccess.showPrompt}
        userTier={llmAccess.userTier}
        onConfigure={llmAccess.openSettings}
        onUpgrade={llmAccess.triggerUpgrade}
        onLogin={llmAccess.triggerLogin}
        onDismiss={llmAccess.closePrompt}
      />

      {/* Naming Dialog */}
      <NamingDialog
        visible={state.namingDialogVisible}
        contextData={{ algorithm: 'Market Observer' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />
    </div>
  );
};

export default MarketObserverPage;
