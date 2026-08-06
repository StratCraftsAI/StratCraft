import React, { useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores';
import { useStrategyCatalogStore } from './useStrategyCatalogStore';
import { cn } from '../../lib/utils';
import {
  CodeDisplay,
  ApiKeyPrompt,
  BYOKSetupDialog,
  NamingDialog,
  GenerateContentWrapper,
  GenerateActionBar,
} from '../ui';

import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

import {
  executeCatalogGeneration,
  validateCatalogConfig,
  getCatalogErrorMessage,
} from '../../services/catalog-strategy-service';
import type { CatalogGenerationConfig } from '../../services/catalog-strategy-service';

import {
  buildCatalogSaveRequest,
  extractClassName,
} from '../../services/algorithm-storage-service';
import type { AlgorithmSaveRequest } from '../../services/algorithm-storage-service';
import { getCurrentUserIdOrLocal } from '../../utils/auth-utils';

import {
  CATALOG_STRATEGIES,
  CATALOG_CATEGORIES,
} from '@shared/data/catalog-strategy-registry';
import { THEME_COLORS } from '@shared/constants/colors';

interface StrategyCatalogPageProps {
  onSettingsClick?: (tab?: string) => void;
  pageTitle?: string;
  llmProvider?: string;
  llmModel?: string;
}

interface CatalogPageState {
  selectedCategory: string;
  selectedStrategyId: string | null;
  searchQuery: string;
  customPreference: string;
  llmProvider: string;
  llmModel: string;
}

function buildApiConfig(state: CatalogPageState, strategyName: string): CatalogGenerationConfig {
  const strategy = CATALOG_STRATEGIES.find(s => s.id === state.selectedStrategyId);
  return {
    catalogId: state.selectedStrategyId || '',
    strategyName,
    category: strategy?.category || '',
    llmProvider: state.llmProvider,
    llmModel: state.llmModel,
    customization: state.customPreference
      ? { preference: state.customPreference }
      : undefined,
  };
}

async function buildStorageRequestFromResult(
  result: GenerationResult,
  state: CatalogPageState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdOrLocal();
  const strategy = CATALOG_STRATEGIES.find(s => s.id === state.selectedStrategyId);
  const request = buildCatalogSaveRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      catalog_id: state.selectedStrategyId || '',
      category: strategy?.category || '',
      llm_provider: state.llmProvider,
      llm_model: state.llmModel,
      customization: state.customPreference
        ? { preference: state.customPreference }
        : undefined,
    },
    userId
  );
  request.language = result.language;
  return request;
}

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-green-400 bg-green-400/10 border-green-400/30',
  MEDIUM: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  HIGH: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  EXTREME: 'text-red-400 bg-red-400/10 border-red-400/30',
};

export const StrategyCatalogPage: React.FC<StrategyCatalogPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  useEffect(() => {
    setPageTitle(t('pages.catalog.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  const {
    selectedCategory, setSelectedCategory,
    selectedStrategyId, setSelectedStrategyId,
    searchQuery, setSearchQuery,
    customPreference, setCustomPreference,
  } = useStrategyCatalogStore();

  const selectedStrategy = useMemo(
    () => CATALOG_STRATEGIES.find(s => s.id === selectedStrategyId) || null,
    [selectedStrategyId]
  );

  /** Resolve a strategy-level i18n key, falling back to the hardcoded English value. */
  const tStrat = useCallback(
    (id: string, field: string, fallback: string) =>
      t(`catalogRegistry.strategies.${id}.${field}`, fallback),
    [t],
  );

  /** Resolve a category-level i18n key, falling back to the hardcoded English value. */
  const tCat = useCallback(
    (id: string, field: string, fallback: string) =>
      t(`catalogRegistry.categories.${id}.${field}`, fallback),
    [t],
  );

  /** Resolve a pipeline stage i18n key. */
  const tPipeline = useCallback(
    (strategyId: string, stageIndex: number, field: string, fallback: string) =>
      t(`catalogRegistry.strategies.${strategyId}.pipeline.stage${stageIndex}.${field}`, fallback),
    [t],
  );

  /** Resolve an array-element i18n key (worksIn, failsIn, entryRules, etc.). */
  const tArray = useCallback(
    (strategyId: string, arrayName: string, index: number, fallback: string) =>
      t(`catalogRegistry.strategies.${strategyId}.${arrayName}.${index}`, fallback),
    [t],
  );

  const filteredStrategies = useMemo(() => {
    let strategies = CATALOG_STRATEGIES.filter(s => s.category === selectedCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      strategies = CATALOG_STRATEGIES.filter(s => {
        const title = tStrat(s.id, 'title', s.title);
        const subtitle = tStrat(s.id, 'subtitle', s.subtitle);
        const catTitle = tCat(s.category, 'title', s.categoryTitle);
        return (
          title.toLowerCase().includes(q) ||
          subtitle.toLowerCase().includes(q) ||
          catTitle.toLowerCase().includes(q)
        );
      });
    }
    return strategies;
  }, [selectedCategory, searchQuery, tStrat, tCat]);

  const currentState: CatalogPageState = useMemo(() => ({
    selectedCategory,
    selectedStrategyId,
    searchQuery,
    customPreference,
    llmProvider,
    llmModel,
  }), [selectedCategory, selectedStrategyId, searchQuery, customPreference, llmProvider, llmModel]);

  const validationItems = useMemo(() => {
    return selectedStrategyId ? [{ type: 'catalog', id: selectedStrategyId }] : [];
  }, [selectedStrategyId]);

  const workflowConfig = useMemo((): GenerateWorkflowConfig<CatalogGenerationConfig, CatalogPageState> => ({
    pageId: 'strategy-catalog-page',
    llmProvider,
    llmModel,
    defaultStrategyName: (selectedStrategy ? tStrat(selectedStrategy.id, 'title', selectedStrategy.title) : null) || t('pages.catalog.defaultStrategyName'),
    buildConfig: buildApiConfig,
    validateConfig: validateCatalogConfig,
    executeApi: executeCatalogGeneration as (config: CatalogGenerationConfig, signal?: AbortSignal) => Promise<GenerationResult>,
    buildStorageRequest: buildStorageRequestFromResult,
    getErrorMessage: getCatalogErrorMessage,
  }), [llmProvider, llmModel, selectedStrategy, t, tStrat]);

  const { state, actions, llmAccess, codeDisplayRef } = useGenerateWorkflow(
    workflowConfig,
    { onSettingsClick },
    currentState,
    validationItems
  );

  const handleSelectStrategy = useCallback((id: string) => {
    setSelectedStrategyId(selectedStrategyId === id ? null : id);
  }, [selectedStrategyId, setSelectedStrategyId]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleNewStrategy = useCallback(async () => {
    const confirmed = await globalThis.nexus?.window?.showConfirm(
      t('pages.common.newStrategyConfirmMsg'),
      { title: t('pages.common.newStrategyConfirmTitle') }
    );
    if (confirmed) {
      actions.resetNewStrategy();
      useStrategyCatalogStore.getState().reset();
    }
  }, [actions, t]);

  return (
    <div className="h-full flex flex-col bg-color-terminal-bg text-color-terminal-text">
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Zone B: Sidebar */}
        <div className="w-96 flex-shrink-0 border-r border-color-terminal-border bg-color-terminal-panel/30 p-4 overflow-y-auto">
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('pages.common.currentStrategy')}
            </label>
            <input
              type="text"
              value={state.strategyName}
              onChange={(e) => actions.setStrategyName(e.target.value)}
              placeholder={(selectedStrategy ? tStrat(selectedStrategy.id, 'title', selectedStrategy.title) : null) || t('pages.catalog.strategyNamePlaceholder')}
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

          {/* Category Filter */}
          <div className="mt-6 space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('catalog.category')}
            </label>
            {CATALOG_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setSearchQuery('');
                  setSelectedStrategyId(null);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 rounded text-xs transition-colors border',
                  selectedCategory === cat.id && !searchQuery
                    ? 'bg-color-terminal-accent-gold/10 text-color-terminal-accent-gold border-color-terminal-accent-gold/30'
                    : 'bg-transparent text-color-terminal-text-secondary border-color-terminal-border hover:bg-white/5'
                )}
              >
                {tCat(cat.id, 'title', cat.title)} ({cat.count})
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="mt-6">
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={t('catalog.searchPlaceholder')}
              className="w-full px-3 py-2 text-xs border rounded focus:outline-none"
              style={{
                backgroundColor: THEME_COLORS.INPUT_BG,
                borderColor: THEME_COLORS.INPUT_BORDER,
                color: THEME_COLORS.INPUT_TEXT,
              }}
            />
          </div>
        </div>

        {/* Right Content Area (Zone C + Zone D) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Zone C: Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <GenerateContentWrapper
              isGenerating={state.isGenerating}
            >
              {/* Strategy Card Grid */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {filteredStrategies.map(s => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectStrategy(s.id)}
                    className={cn(
                      'text-left p-3 rounded-md border transition-all',
                      selectedStrategyId === s.id
                        ? 'border-color-terminal-accent-gold/60 bg-color-terminal-accent-gold/10'
                        : 'border-color-terminal-border hover:border-color-terminal-accent-gold/30 hover:bg-white/5'
                    )}
                  >
                    <div className="text-xs font-medium text-color-terminal-text mb-1 truncate">
                      {tStrat(s.id, 'title', s.title)}
                    </div>
                    <div className="text-[10px] text-color-terminal-text-secondary mb-2 line-clamp-1">
                      {tStrat(s.id, 'subtitle', s.subtitle)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', RISK_COLORS[s.riskLevel])}>
                        {s.riskLevel}
                      </span>
                      <span className="text-[10px] text-color-terminal-text-secondary">
                        {s.timeframe.slice(0, 3).join(' ')}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Selected Strategy Detail */}
              {selectedStrategy && (
                <div className="border border-color-terminal-border rounded-md p-4 mb-6" style={{ borderRadius: 6 }}>
                  <div className="mb-3">
                    <div className="text-sm font-medium text-color-terminal-text">
                      {tStrat(selectedStrategy.id, 'title', selectedStrategy.title)}
                    </div>
                    <div className="text-xs text-color-terminal-text-secondary">
                      {tStrat(selectedStrategy.id, 'subtitle', selectedStrategy.subtitle)}
                    </div>
                  </div>

                  {/* Pipeline Preview */}
                  <div className="mb-3">
                    <div className="text-[10px] font-medium text-color-terminal-text uppercase tracking-wider mb-1.5">
                      {t('catalog.decisionPipeline')}
                    </div>
                    <div className="flex items-center gap-1">
                      {selectedStrategy.pipeline.map((stage, i) => (
                        <React.Fragment key={stage.title}>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-color-terminal-panel text-color-terminal-text border border-color-terminal-border">
                            {i + 1}. {tPipeline(selectedStrategy.id, i, 'title', stage.title)}
                          </span>
                          {i < selectedStrategy.pipeline.length - 1 && (
                            <span className="text-color-terminal-text-secondary">&rarr;</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  {/* Suitability */}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <div className="text-[10px] font-medium text-green-400 uppercase tracking-wider mb-1">
                        {t('catalog.worksIn')}
                      </div>
                      {selectedStrategy.worksIn.map((w, i) => (
                        <div key={i} className="text-[10px] text-color-terminal-text-secondary mb-0.5 leading-tight">
                          {tArray(selectedStrategy.id, 'worksIn', i, w)}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-red-400 uppercase tracking-wider mb-1">
                        {t('catalog.failsIn')}
                      </div>
                      {selectedStrategy.failsIn.map((f, i) => (
                        <div key={i} className="text-[10px] text-color-terminal-text-secondary mb-0.5 leading-tight">
                          {tArray(selectedStrategy.id, 'failsIn', i, f)}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Indicators */}
                  <div className="mb-3">
                    <div className="text-[10px] font-medium text-color-terminal-text uppercase tracking-wider mb-1">
                      {t('catalog.keyIndicators')}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedStrategy.indicators.map((ind, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-color-terminal-panel text-color-terminal-text border border-color-terminal-border"
                        >
                          {ind.name}: {ind.formula}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Customization */}
                  <div>
                    <div className="text-[10px] font-medium text-color-terminal-text uppercase tracking-wider mb-1">
                      {t('catalog.customization')}
                    </div>
                    <textarea
                      value={customPreference}
                      onChange={e => setCustomPreference(e.target.value)}
                      placeholder={t('catalog.customizationPlaceholder')}
                      rows={2}
                      className="w-full px-3 py-1.5 text-xs rounded border resize-none focus:outline-none"
                      style={{
                        backgroundColor: THEME_COLORS.INPUT_BG,
                        borderColor: THEME_COLORS.INPUT_BORDER,
                        color: THEME_COLORS.INPUT_TEXT,
                      }}
                    />
                  </div>
                </div>
              )}
            </GenerateContentWrapper>

            {/* Code Display - outside wrapper, always visible during generation */}
            {(state.generateResult || state.isGenerating) && (
              <div ref={codeDisplayRef} className="mt-8">
                <CodeDisplay
                  code={state.generateResult?.code || ''}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  language={state.generateResult?.language}
                />
              </div>
            )}
          </div>

          {/* Zone D: Action Bar - fixed at bottom */}
          <GenerateActionBar
            isGenerating={state.isGenerating}
            hasResult={actions.hasResult}
            onGenerate={actions.handleStartGenerate}
            onCancel={actions.cancelGeneration}
            generateLabel={t('catalog.generateLabel')}
            savedAlgorithmId={state.savedAlgorithmId}
            isCpp={state.isCpp}
          />
        </div>
      </div>

      {/* Naming Dialog */}
      <NamingDialog
        visible={state.namingDialogVisible}
        contextData={{ algorithm: (selectedStrategy ? tStrat(selectedStrategy.id, 'title', selectedStrategy.title) : null) || 'CatalogStrategy' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />

      {/* LLM Access Prompt */}
      <ApiKeyPrompt
        isOpen={llmAccess.showPrompt}
        userTier={llmAccess.userTier}
        onConfigure={llmAccess.openSettings}
        onUpgrade={llmAccess.triggerUpgrade}
        onLogin={llmAccess.triggerLogin}
        onDismiss={llmAccess.closePrompt}
      />

      {/* BYOK Setup Dialog */}
      <BYOKSetupDialog
        isOpen={llmAccess.showSetupDialog}
        onComplete={llmAccess.onSetupComplete}
        onDismiss={llmAccess.closeSetupDialog}
      />
    </div>
  );
};
