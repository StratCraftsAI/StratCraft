/**
 * BacktestPage Component - Host Shell
 *
 * TICKET_173: Simplified Host Shell after business logic moved to Plugin layer.
 * TICKET_209: Added BacktestPluginHub (page21) as entry point.
 * TICKET_233: Integrated global backtest status for status bar display.
 * TICKET_234: Bridge plugin data to global store for independent result page.
 *
 * Host Shell is now a thin orchestrator that manages:
 * - Breadcrumb navigation
 * - Hub/Cockpit routing (page21 -> page4)
 * - API references passed to Plugin
 * - Global backtest status updates
 * - Bridging plugin data to global store (TICKET_234)
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library (Four-quadrant layout)
 * @see TICKET_173 - Host-Plugin Separation Refactor
 * @see TICKET_209 - Backtest Plugin Hub Navigation
 * @see TICKET_233 - Global Backtest Status and Notification System
 * @see TICKET_234 - Independent Backtest Result Page
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { useAppStore, useBacktestStatusStore, useBacktestConfigStore } from '@/stores';
import type { BacktestConfigSnapshot } from '@/stores';
import { PLUGIN_IDS } from '@shared/constants';
import type { WorkflowTimeframes, WorkflowExportData, BacktestConfigSummary, PipelineArtifacts } from '@/stores/useBacktestStatusStore';
import { BreadcrumbBar } from '@/components/host';
import { MiniNameplate } from '@/components/common';
import { VIEW_REGISTRY } from '@/config/view-registry';
import { useMessage } from '@/hooks/useMessage';
import { useUserTier } from '@/hooks/useAuth';
import { useBacktestPageStore } from './useBacktestPageStore';
import type { ViewState } from './useBacktestPageStore';

// Plugin layer components
import { BacktestPage as BacktestContent, BacktestPluginHub } from '@plugins/back-test-nexus/ui/components/pages';
import { PluginSettingsPage as BacktestPluginSettingsPage } from '@plugins/back-test-nexus/ui/components/settings';

// TICKET_499: Centralized cockpit view configuration
interface CockpitViewConfig {
  breadcrumbKey: string;
  titleKey: string;
}

const COCKPIT_CONFIGS: Record<Exclude<ViewState, 'hub'>, CockpitViewConfig> = {
  indicators: { breadcrumbKey: 'breadcrumb.indicatorsCockpit', titleKey: 'cockpitSelector.indicatorsCockpit' },
  kronos:     { breadcrumbKey: 'breadcrumb.kronosCockpit',     titleKey: 'cockpitSelector.kronosCockpit' },
  trader:     { breadcrumbKey: 'breadcrumb.traderCockpit',     titleKey: 'cockpitSelector.traderCockpit' },
  aiLibero:   { breadcrumbKey: 'breadcrumb.aiLiberoCockpit',   titleKey: 'cockpitSelector.aiLiberoCockpit' },
  aiStudio:   { breadcrumbKey: 'breadcrumb.aiStudioCockpit',   titleKey: 'cockpitSelector.aiStudioCockpit' },
  catalog:    { breadcrumbKey: 'breadcrumb.catalogCockpit',   titleKey: 'cockpitSelector.catalogCockpit' },
};

// -----------------------------------------------------------------------------
// BacktestPage Component - Host Shell
// -----------------------------------------------------------------------------

export const BacktestPage: React.FC = () => {
  const { t } = useTranslation('backtest');
  const { setActiveView, pushSubPage, resetSubPages } = useAppStore();
  const message = useMessage();

  // TICKET_352_5: Create tab immediately with caller-generated ID
  const createPreparingTab = useBacktestStatusStore((state) => state.createPreparingTab);
  const startTask = useBacktestStatusStore((state) => state.startTask);

  // TICKET_410: Save pipeline artifacts for dry run GO reuse
  const setTaskPipelineArtifacts = useBacktestStatusStore((state) => state.setTaskPipelineArtifacts);
  const handleSavePipelineArtifacts = useCallback((taskId: string, artifacts: PipelineArtifacts) => {
    setTaskPipelineArtifacts(taskId, artifacts);
  }, [setTaskPipelineArtifacts]);

  // TICKET_704: Dynamic entitlement tier for cockpit gating
  const userTier = useUserTier();

  // TICKET_1208 P3: Cockpit state preserved across view switches via Zustand
  const viewState = useBacktestPageStore((s) => s.viewState);
  const selectedCockpit = useBacktestPageStore((s) => s.selectedCockpit);
  const setViewState = useBacktestPageStore((s) => s.setViewState);
  const setSelectedCockpit = useBacktestPageStore((s) => s.setSelectedCockpit);
  const resetCockpitToHub = useBacktestPageStore((s) => s.resetToHub);

  // TICKET_365: Restore config snapshot on mount (cancel -> go back flow)
  // Read snapshot once on mount via useState initializer (safe under StrictMode --
  // React only calls useState initializer once regardless of double-invocation)
  const [restoredSnapshot] = useState(() => useBacktestConfigStore.getState().snapshot);
  // Clear store in useEffect (side effect must not live in useMemo/render phase)
  useEffect(() => {
    if (restoredSnapshot) {
      useBacktestConfigStore.getState().clearSnapshot();
      // TICKET_365: Snapshot cockpit overrides store on mount
      const cockpit = restoredSnapshot.cockpit as ViewState | undefined;
      if (cockpit) {
        setViewState(cockpit);
        setSelectedCockpit(cockpit);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // TICKET_173: Only track result view state for breadcrumb (received from Plugin)
  const [isResultView, setIsResultView] = useState(false);
  // TICKET_164: Reset key to trigger plugin state clear on breadcrumb navigation
  const [resetKey, setResetKey] = useState(0);

  // TICKET_209: Handle cockpit selection from hub
  const handleSelectCockpit = useCallback((cockpitId: string) => {
    console.debug('[BacktestPage] Cockpit selected:', cockpitId);
    setSelectedCockpit(cockpitId);
    // Route to appropriate cockpit view
    const targetView = (cockpitId in COCKPIT_CONFIGS ? cockpitId : 'indicators') as ViewState;
    setViewState(targetView);
  }, []);

  // TICKET_209: Handle locked cockpit click
  const handleLockedClick = useCallback(async (cockpit: { nameKey: string; tier: 'free' | 'basic' | 'pro' }) => {
    const confirmed = await message.showModal({
      title: t(cockpit.nameKey),
      content: t('locked.requiresTier', { tier: cockpit.tier.toUpperCase() }),
      type: 'warning',
      showCancel: true,
      okText: t('auth.loginToUnlock'),
      cancelText: t('common.cancel'),
    });
    if (confirmed) {
      window.dispatchEvent(new Event('nexus:auth-required'));
    }
  }, [message, t]);

  // TICKET_308: Plugin settings overlay (same pattern as Strategy Builder)
  const [showPluginSettings, setShowPluginSettings] = useState(false);

  const handleSettingsClick = useCallback(() => {
    setShowPluginSettings(true);
  }, []);

  // TICKET_591: Settings icon + page title nameplate for BreadcrumbBar rightContent
  const settingsIconButton = useMemo(() => {
    return (
      <button
        onClick={() => handleSettingsClick()}
        title={t('settings.title')}
        className="p-1.5 rounded transition-all text-color-terminal-text-muted hover:text-color-terminal-text hover:bg-white/5"
      >
        <Settings className="w-4 h-4" />
      </button>
    );
  }, [handleSettingsClick, t]);

  const breadcrumbRightContent = useMemo(() => {
    const config = viewState !== 'hub' ? COCKPIT_CONFIGS[viewState as Exclude<ViewState, 'hub'>] : undefined;
    // TICKET_786_4: prefer translated shortLabel
    const registryEntry = VIEW_REGISTRY.backtest;
    const fallbackTitle = registryEntry.shortLabelKey
      ? t(registryEntry.shortLabelKey, { ns: 'ui' })
      : (registryEntry.shortLabel || '');
    const title = config ? t(config.titleKey) : fallbackTitle;
    return (
      <div className="flex items-center gap-2">
        {settingsIconButton}
        {title && <MiniNameplate text={title} />}
      </div>
    );
  }, [viewState, settingsIconButton, t]);

  // TICKET_209: Handle back to hub from breadcrumb
  const handleBackToHub = useCallback(() => {
    console.debug('[BacktestPage] Back to hub');
    resetCockpitToHub();
    setIsResultView(false);
    setResetKey(prev => prev + 1);
  }, [resetCockpitToHub]);

  // TICKET_164: Handle back to config from breadcrumb (within cockpit)
  const handleBackToConfig = useCallback(() => {
    console.debug('[BacktestPage] handleBackToConfig called');
    setIsResultView(false);
    setResetKey(prev => prev + 1);
  }, []);

  // TICKET_365: Config snapshot store for cancel -> go back preservation
  const saveSnapshot = useBacktestConfigStore((s) => s.saveSnapshot);

  // TICKET_327: Navigate to result page immediately when execution begins (before download).
  // This ensures the pipeline DOWNLOAD phase is visible to the user.
  // TICKET_352_5: Create tab immediately with caller-generated taskId to eliminate stale flash.
  // TICKET_365: Accept config snapshot and save before unmount.
  // TICKET_398: Accept isDryRun flag and pass to createPreparingTab
  const handleExecutionBegin = useCallback((strategyName: string, taskId: string, configSnapshot?: BacktestConfigSnapshot, isDryRun?: boolean) => {
    if (configSnapshot) {
      saveSnapshot(configSnapshot);
    }
    createPreparingTab({ taskId, strategyName, isDryRun });
    setActiveView('backtestResult');
  }, [createPreparingTab, setActiveView, saveSnapshot]);

  // TICKET_233: Global status callbacks for Plugin
  // TICKET_352_5: Tab already exists from handleExecutionBegin (preparing status).
  // Transition to 'running' and merge workflow metadata.
  const handleBacktestStart = useCallback((
    taskId: string,
    _strategyName: string,
    workflowTimeframes?: WorkflowTimeframes,
    workflowExportData?: WorkflowExportData,
    backtestConfig?: BacktestConfigSummary
  ) => {
    console.debug('[BacktestPage] Backtest started, transitioning tab to running:', { taskId, workflowTimeframes });
    startTask(taskId, { workflowTimeframes, workflowExportData, backtestConfig });
  }, [startTask]);

  // TICKET_300: Update sub-page path based on view state
  useEffect(() => {
    // Reset sub-pages first, then build path based on current state
    resetSubPages();

    if (viewState !== 'hub') {
      const config = COCKPIT_CONFIGS[viewState as Exclude<ViewState, 'hub'>];
      const cockpitLabel = config ? t(config.breadcrumbKey) : t('breadcrumb.indicatorsCockpit');

      // Push cockpit sub-page
      pushSubPage({
        label: cockpitLabel,
        onNavigate: handleBackToHub,
      });

      if (isResultView) {
        // Push result sub-page
        pushSubPage({
          label: t('breadcrumb.result'),
          onNavigate: handleBackToConfig,
        });
      }
    }
  }, [viewState, isResultView, resetSubPages, pushSubPage, handleBackToHub, handleBackToConfig, t]);

  // TICKET_300: Clean up on unmount
  useEffect(() => resetSubPages, [resetSubPages]);

  // TICKET_327: data:progress pipeline subscription moved to BacktestResultPage.
  // BacktestPage unmounts on navigation to result page (setActiveView('backtestResult')),
  // so data:progress events must be handled by BacktestResultPage which stays mounted.
  // Navigation now happens in handleExecutionBegin BEFORE download starts.

  // TICKET_308: Show plugin settings page (same pattern as Strategy Builder)
  if (showPluginSettings) {
    return (
      <BacktestPluginSettingsPage
        pluginId={PLUGIN_IDS.BACKTEST}
        pluginName={viewState !== 'hub' ? t(COCKPIT_CONFIGS[viewState as Exclude<ViewState, 'hub'>].titleKey) : t('breadcrumb.backtestNexus')}
        onBack={() => setShowPluginSettings(false)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden terminal-theme bg-color-terminal-bg">
      {/* [A] Header: Breadcrumb Bar */}
      <BreadcrumbBar
        showHome={true}
        homeLabel={t('breadcrumb.home')}
        onHomeClick={() => setActiveView('nexus')}
        rightContent={breadcrumbRightContent}
      />

      {/* Content based on view state */}
      <div className="flex-1 overflow-hidden">
        {viewState === 'hub' && (
          // TICKET_209: page21 - BacktestPluginHub
          // TICKET_704: Pass userTier for tier-level cockpit gating
          <BacktestPluginHub
            onSelectCockpit={handleSelectCockpit}
            onLockedClick={handleLockedClick}
            userTier={userTier === 'gold' ? 'pro' : userTier}
          />
        )}
        {/* TICKET_499: Data-driven cockpit rendering */}
        {(Object.keys(COCKPIT_CONFIGS) as Array<Exclude<ViewState, 'hub'>>).map((mode) =>
          viewState === mode && (
            <BacktestContent
              key={mode}
              executorAPI={window.electronAPI?.executor}
              dataAPI={window.electronAPI?.data}
              messageAPI={message}
              onResultViewChange={setIsResultView}
              resetKey={resetKey}
              cockpitMode={mode}
              onBacktestStart={handleBacktestStart}
              onExecutionBegin={handleExecutionBegin}
              initialConfig={restoredSnapshot ? { dataConfig: restoredSnapshot.dataConfig, workflowRows: restoredSnapshot.workflowRows } : undefined}
              onSavePipelineArtifacts={handleSavePipelineArtifacts}
            />
          )
        )}
      </div>
    </div>
  );
};

export default BacktestPage;
