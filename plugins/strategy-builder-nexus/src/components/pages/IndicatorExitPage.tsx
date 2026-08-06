/**
 * IndicatorExitPage Component (Risk Manager)
 *
 * Risk Override Exit Generator page following TICKET_077 layout specification.
 * Zones: A (Header), B (Sidebar), C (Content), D (Action Bar)
 *
 * Generates Python risk override rules (Layer 1) that operate above
 * the Alpha Factory combinator. Users configure emergency protection,
 * NOT daily exit logic - normal exit is implicit in the combinator.
 *
 * TICKET_077_D2: Uses unified useGenerateWorkflow hook
 *
 * @see TICKET_274 - Indicator Exit Generator Page (Risk Manager)
 * @see TICKET_247 - Alpha Factory Architecture (Simons-style)
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores';
import { Plus, ShieldAlert, OctagonX, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  CodeDisplay,
  ApiKeyPrompt,
  BYOKSetupDialog,
  NamingDialog,
  GenerateContentWrapper,
  PortalDropdown,
  GenerateActionBar,
} from '../ui';
import { RiskOverrideRuleCard } from '../ui/RiskOverrideRuleCard';
import { HardSafetyConfig } from '../ui/HardSafetyConfig';
import { useIndicatorExitStore } from './useIndicatorExitStore';

// Hooks
import {
  useGenerateWorkflow,
  GenerateWorkflowConfig,
  GenerationResult,
} from '../../hooks';

// Services
import {
  executeRiskOverrideExit,
  validateRiskOverrideExitConfig,
  getExitErrorMessage,
  RISK_RULE_TYPES,
  RULE_DEFAULTS,
  MAX_RISK_RULES,
  buildRiskOverrideExitRequest as buildRiskOverrideExitGenerationRequest,
} from '../../services/risk-override-exit-service';
import type {
  RiskOverrideExitConfig,
  RiskOverrideExitResult,
  RiskOverrideRule,
  RiskRuleType,
  IndicatorExitState,
} from '../../services/risk-override-exit-service';
import {
  buildRiskOverrideExitRequest,
  extractClassName,
} from '../../services/algorithm-storage-service';
import type { AlgorithmSaveRequest } from '../../services/algorithm-storage-service';
import { getCurrentUserIdOrLocal } from '../../utils/auth-utils';
import { THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface IndicatorExitPageProps {
  onSettingsClick?: (tab?: string) => void;
  pageTitle?: string;
  llmProvider?: string;
  llmModel?: string;
}

// Rule type descriptions are loaded from i18n in the component render

// -----------------------------------------------------------------------------
// Rule Factory
// -----------------------------------------------------------------------------

let ruleIdCounter = 0;

function createRule(type: RiskRuleType, priority: number): RiskOverrideRule {
  const id = `rule-${Date.now()}-${++ruleIdCounter}`;
  const base = { id, enabled: true, priority };

  switch (type) {
    case 'circuit_breaker':
      return {
        ...base,
        type: 'circuit_breaker',
        triggerPnlPercent: RULE_DEFAULTS.circuit_breaker.triggerPnlPercent,
        scope: 'per_position',
        action: 'close_all',
        cooldownBars: RULE_DEFAULTS.circuit_breaker.cooldownBars,
      };
    case 'time_limit':
      return {
        ...base,
        type: 'time_limit',
        maxHolding: RULE_DEFAULTS.time_limit.maxHolding,
        unit: RULE_DEFAULTS.time_limit.unit,
        decay: 'none',
        action: 'close_all',
      };
    case 'regime_detection':
      return {
        ...base,
        type: 'regime_detection',
        indicator: { name: '', parameters: {} },
        condition: '>',
        threshold: RULE_DEFAULTS.regime_detection.threshold,
        action: 'reduce_all',
        reducePercent: RULE_DEFAULTS.regime_detection.reducePercent,
        recovery: 'auto',
      };
    case 'drawdown_limit':
      return {
        ...base,
        type: 'drawdown_limit',
        maxDrawdownPercent: RULE_DEFAULTS.drawdown_limit.maxDrawdownPercent,
        action: 'halt_trading',
        recovery: 'auto',
      };
    case 'indicator_guard':
      return {
        ...base,
        type: 'indicator_guard',
        indicator: { name: '', parameters: {} },
        condition: '>',
        threshold: RULE_DEFAULTS.indicator_guard.threshold,
        appliesTo: 'both',
        action: 'close_position',
      };
  }
}

// -----------------------------------------------------------------------------
// Workflow Config Builders
// -----------------------------------------------------------------------------

function buildApiConfig(state: IndicatorExitState, strategyName: string): RiskOverrideExitConfig {
  return {
    strategy_name: strategyName,
    rules: state.rules,
    hard_safety: {
      max_loss_percent: state.hardSafety.maxLossPercent,
    },
    llm_provider: state.llmProvider,
    llm_model: state.llmModel,
    storage_mode: state.storageMode,
  };
}

async function buildStorageRequestFromResult(
  result: GenerationResult,
  state: IndicatorExitState,
  strategyName: string
): Promise<AlgorithmSaveRequest> {
  const userId = await getCurrentUserIdOrLocal();
  return buildRiskOverrideExitRequest(
    {
      strategy_name: strategyName,
      strategy_code: result.strategy_code || '',
      class_name: extractClassName(result.strategy_code || ''),
    },
    {
      rules: state.rules,
      hard_safety: { max_loss_percent: state.hardSafety.maxLossPercent },
      llm_provider: state.llmProvider,
      llm_model: state.llmModel,
    },
    userId
  );
}

// -----------------------------------------------------------------------------
// IndicatorExitPage Component
// -----------------------------------------------------------------------------

export const IndicatorExitPage: React.FC<IndicatorExitPageProps> = ({
  onSettingsClick,
  pageTitle,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
}) => {
  const { t } = useTranslation('strategy-builder');
  const setPageTitle = useAppStore(s => s.setPageTitle);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.indicatorExit.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // ---------------------------------------------------------------------------
  // Page-specific State (TICKET_1208 P6: Zustand store survives unmount)
  // ---------------------------------------------------------------------------

  const {
    rules, setRules,
    hardSafetyMaxLoss, setHardSafetyMaxLoss,
  } = useIndicatorExitStore();

  // Add Rule dropdown
  const addRuleRef = useRef<HTMLButtonElement>(null);
  const [addRuleOpen, setAddRuleOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Rule Management
  // ---------------------------------------------------------------------------

  const handleAddRule = useCallback((type: RiskRuleType) => {
    if (rules.length >= MAX_RISK_RULES) return;
    const newRule = createRule(type, rules.length + 1);
    setRules(prev => [...prev, newRule]);
    setAddRuleOpen(false);
  }, [rules.length]);

  const handleUpdateRule = useCallback((index: number, updatedRule: RiskOverrideRule) => {
    setRules(prev => {
      const next = [...prev];
      next[index] = updatedRule;
      return next;
    });
  }, []);

  const handleDeleteRule = useCallback((index: number) => {
    setRules(prev => {
      const next = prev.filter((_, i) => i !== index);
      // Re-assign priorities
      return next.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  }, []);

  const handleToggleRule = useCallback((index: number, enabled: boolean) => {
    setRules(prev => {
      const next = [...prev];
      next[index] = { ...next[index], enabled };
      return next;
    });
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setRules(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setRules(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Workflow Configuration
  // ---------------------------------------------------------------------------

  const currentState: IndicatorExitState = useMemo(() => ({
    rules,
    hardSafety: { maxLossPercent: hardSafetyMaxLoss },
    storageMode: 'local',
    llmProvider,
    llmModel,
  }), [rules, hardSafetyMaxLoss, llmProvider, llmModel]);

  // Validation items (enabled rules)
  const enabledRules = useMemo(() => rules.filter(r => r.enabled), [rules]);

  const workflowConfig = useMemo((): GenerateWorkflowConfig<RiskOverrideExitConfig, IndicatorExitState> => ({
    pageId: 'indicator-exit-page',
    llmProvider,
    llmModel,
    defaultStrategyName: t('pages.indicatorExit.defaultStrategyName'),
    validationErrorMessage: t('pages.indicatorExit.validationError'),
    buildConfig: buildApiConfig,
    validateConfig: validateRiskOverrideExitConfig,
    executeApi: executeRiskOverrideExit as (config: RiskOverrideExitConfig, signal?: AbortSignal) => Promise<GenerationResult>,
    buildGenerationRequest: buildRiskOverrideExitGenerationRequest,
    buildStorageRequest: buildStorageRequestFromResult,
    getErrorMessage: (result) => getExitErrorMessage(result as unknown as RiskOverrideExitResult),
  }), [llmProvider, llmModel]);

  // ---------------------------------------------------------------------------
  // Unified Generate Workflow Hook
  // ---------------------------------------------------------------------------

  const { state, actions, llmAccess, codeDisplayRef } = useGenerateWorkflow(
    workflowConfig,
    { onSettingsClick },
    currentState,
    enabledRules
  );

  // ---------------------------------------------------------------------------
  // Handlers
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
      useIndicatorExitStore.getState().reset();
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
              placeholder={t('pages.indicatorExit.strategyNamePlaceholder')}
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

          {/* Architecture Summary */}
          <div className="mt-6 space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('pages.indicatorExit.configurationLabel')}
            </label>

            {/* Active Rules */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-color-terminal-text-muted">{t('pages.indicatorExit.activeRulesLabel')}</span>
              <span className={cn(
                'px-1.5 py-0.5 rounded font-medium',
                enabledRules.length > 0
                  ? 'bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal'
                  : 'bg-color-terminal-text-muted/20 text-color-terminal-text-muted'
              )}>
                {enabledRules.length} / {rules.length}
              </span>
            </div>

            {/* Hard Safety */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-color-terminal-text-muted">{t('pages.indicatorExit.hardSafetyLabel')}</span>
              <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-medium">
                {hardSafetyMaxLoss}%
              </span>
            </div>
          </div>

          {/* Mini Architecture Diagram */}
          <div className="mt-6 p-3 rounded border border-color-terminal-border/50 bg-color-terminal-bg/50">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-2">
              {t('pages.indicatorExit.exitArchitectureLabel')}
            </label>
            <div className="space-y-1.5 text-[10px]">
              <div className="text-color-terminal-text-muted">
                {t('pages.indicatorExit.l0Combinator')}
              </div>
              <div className="text-color-terminal-text-muted pl-2">
                &#8595;
              </div>
              <div className="text-color-terminal-accent-primary font-medium">
                {t('pages.indicatorExit.l1RiskOverride', { count: enabledRules.length })}
              </div>
              <div className="text-color-terminal-text-muted pl-2">
                &#8595;
              </div>
              <div className="text-red-400 font-medium">
                {t('pages.indicatorExit.l2HardSafety')}
              </div>
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
              loadingMessage={t('pages.indicatorExit.loadingMessage')}
            >
              {/* ======================================================== */}
              {/* Layer 1: Risk Override Rules                               */}
              {/* ======================================================== */}
              <div className="mb-8">
                {/* Section Header */}
                <div className="flex items-center gap-2 mb-1 pb-2 border-b border-color-terminal-border/30">
                  <ShieldAlert className="w-4 h-4 text-color-terminal-accent-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-color-terminal-text">
                    {t('pages.indicatorExit.layer1Title')}
                  </span>
                  <span className={cn(
                    'ml-auto text-[10px] px-2 py-0.5 rounded font-medium',
                    enabledRules.length > 0
                      ? 'bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal'
                      : 'bg-color-terminal-text-muted/20 text-color-terminal-text-muted'
                  )}>
                    {t('pages.indicatorExit.enabledTotal', { enabled: enabledRules.length, total: rules.length })}
                  </span>
                </div>

                {/* Rule Execution Info */}
                <p className="text-[10px] text-color-terminal-text-muted mb-4 mt-2">
                  {t('pages.indicatorExit.ruleExecutionInfo')}
                </p>

                {/* Rule List or Empty State */}
                {rules.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Shield className="w-10 h-10 text-color-terminal-text-muted/30 mb-3" />
                    <p className="text-xs text-color-terminal-text-muted mb-1">
                      {t('pages.indicatorExit.noRulesConfigured')}
                    </p>
                    <p className="text-[10px] text-color-terminal-text-muted/70 mb-4">
                      {t('pages.indicatorExit.noRulesHint')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    {rules.map((rule, index) => (
                      <RiskOverrideRuleCard
                        key={rule.id}
                        rule={rule}
                        onChange={(updated) => handleUpdateRule(index, updated)}
                        onDelete={() => handleDeleteRule(index)}
                        onToggle={(enabled) => handleToggleRule(index, enabled)}
                        onMoveUp={index > 0 ? () => handleMoveUp(index) : undefined}
                        onMoveDown={index < rules.length - 1 ? () => handleMoveDown(index) : undefined}
                      />
                    ))}
                  </div>
                )}

                {/* Add Rule Button */}
                {rules.length < MAX_RISK_RULES && (
                  <div className="relative">
                    <button
                      ref={addRuleRef}
                      onClick={() => setAddRuleOpen(!addRuleOpen)}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium border border-dashed border-color-terminal-border rounded-lg hover:border-color-terminal-accent-primary/50 hover:bg-white/5 text-color-terminal-text-muted hover:text-color-terminal-text transition-all w-full justify-center"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('pages.indicatorExit.addRule')}
                    </button>
                    <PortalDropdown
                      isOpen={addRuleOpen}
                      triggerRef={addRuleRef}
                      onClose={() => setAddRuleOpen(false)}
                      maxHeight={320}
                    >
                      {RISK_RULE_TYPES.map(rt => (
                        <button
                          key={rt.value}
                          onClick={() => handleAddRule(rt.value as RiskRuleType)}
                          className="w-full px-3 py-2.5 text-left hover:bg-white/10 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'w-2 h-2 rounded-full flex-shrink-0',
                              rt.color === 'red' && 'bg-red-500',
                              rt.color === 'teal' && 'bg-teal-500',
                              rt.color === 'warning' && 'bg-amber-500',
                              rt.color === 'primary' && 'bg-blue-500',
                            )} />
                            <span className="text-xs text-[#e6f1ff] font-medium">{t(rt.labelKey, { defaultValue: rt.label })}</span>
                          </div>
                          <p className="text-[10px] text-color-terminal-text-muted ml-4 mt-0.5">
                            {t(`pages.indicatorExit.ruleDescriptions.${rt.value}`)}
                          </p>
                        </button>
                      ))}
                    </PortalDropdown>
                  </div>
                )}
              </div>

              {/* ======================================================== */}
              {/* Layer 2: Hard Safety Net                                   */}
              {/* ======================================================== */}
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-color-terminal-border/30">
                  <OctagonX className="w-4 h-4 text-red-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-color-terminal-text">
                    {t('pages.indicatorExit.layer2Title')}
                  </span>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-medium">
                    {t('pages.indicatorExit.alwaysActive')}
                  </span>
                </div>
                <HardSafetyConfig
                  maxLossPercent={hardSafetyMaxLoss}
                  onChange={setHardSafetyMaxLoss}
                />
              </div>
            </GenerateContentWrapper>

            {/* ============================================================ */}
            {/* Result Display Area - CodeDisplay                             */}
            {/* (Outside wrapper - always visible during generation)          */}
            {/* ============================================================ */}
            {(state.generateResult || state.isGenerating) && (
              <div ref={codeDisplayRef} className="mt-8">
                <CodeDisplay
                  code={state.generateResult?.code || ''}
                  state={actions.getCodeDisplayState()}
                  errorMessage={state.generateResult?.error}
                  title={t('pages.indicatorExit.generatedCodeTitle')}
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
            generateLabel={t('pages.indicatorExit.generateLabel')}
            generatingLabel={t('pages.indicatorExit.generatingLabel')}
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
        contextData={{ algorithm: 'RiskOverride' }}
        onConfirm={actions.handleConfirmNaming}
        onCancel={actions.handleCancelNaming}
      />
    </div>
  );
};

export default IndicatorExitPage;
