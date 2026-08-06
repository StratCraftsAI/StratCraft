/**
 * StrategyStudioPage Component - Host Shell
 *
 * Main page container for Strategy-Nexus feature.
 * TICKET_135: V3 architecture - simplified, no plugin mode detection.
 *
 * @see TICKET_079 - Dynamic Page Routing
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileBarChart, Settings } from 'lucide-react';
import { useAppStore } from '@/stores';
import { BreadcrumbBar, LockedPagePlaceholder } from '@/components/host';
import { MiniNameplate } from '@/components/common';
// TICKET_093: Use plugin's settings page instead of Host's generic one
import { PluginSettingsPage } from '@plugins/strategy-builder-nexus/components/settings';
import type { SettingsTab } from '@plugins/strategy-builder-nexus/components/settings/PluginSettingsPage';
import { WEBSITE_PRICING_URL } from '@StratCraft/types'; // TICKET_1023_6
import { PLUGIN_IDS } from '@shared/constants';
import { useServicesByCategory } from '@/hooks';
import type { TierLevel } from '@/components/host';
import { VIEW_REGISTRY } from '@/config/view-registry';

// TICKET_1208 P1: Page state preservation across view switches
import { useStrategyStudioStore } from './useStrategyStudioStore';
import type { ContentLevel } from './useStrategyStudioStore';

// Direct imports for V3 rendering
import { StrategyHub, ProviderPortal, StrategyGroupList } from './components/hub';
import { AuditReportPage } from './components/audit';

// Dynamic editor resolution (TICKET_079)
import { getEditorByServiceName } from '@/lib/plugin-editor-resolver';

// -----------------------------------------------------------------------------
// StrategyStudioPage Component
// TICKET_135: V3 removed plugin mode detection
// -----------------------------------------------------------------------------

export const StrategyStudioPage: React.FC = () => {
  const { t } = useTranslation('ui');
  const { setActiveView, pushSubPage, resetSubPages, pageTitle } = useAppStore();

  // TICKET_1208 P1: Navigation depth preserved across view switches via Zustand
  const {
    currentLevel, setCurrentLevel,
    selectedNode, setSelectedNode,
    featureName, setFeatureName,
    resetToHub,
  } = useStrategyStudioStore();
  const [showPluginSettings, setShowPluginSettings] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('config');

  // Get translated Strategy Builder label
  const strategyBuilderLabel = t('nav.strategyBuilder');

  // TICKET_105: Load service entitlements for navigation guard
  const { services } = useServicesByCategory(PLUGIN_IDS.STRATEGY);

  // TICKET_300: Reset sub-pages on unmount
  useEffect(() => resetSubPages, [resetSubPages]);

  // TICKET_727: Open plugin settings LLM tab when byok-required modal action navigates here
  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab === 'llm') {
        setSettingsDefaultTab('llm');
      }
      setShowPluginSettings(true);
    };
    window.addEventListener('nexus:open-settings', handleOpenSettings);
    return () => window.removeEventListener('nexus:open-settings', handleOpenSettings);
  }, []);

  // TICKET_298: Handle openView('strategy.hub') from plugin components (e.g. GenerateActionBar RETURN)
  useEffect(() => {
    const handleViewChange = (event: CustomEvent<{ viewId: string }>) => {
      if (event.detail.viewId === 'strategy.hub') {
        resetToHub();
        resetSubPages();
      }
    };
    window.addEventListener('nexus:view-change', handleViewChange as EventListener);
    return () => window.removeEventListener('nexus:view-change', handleViewChange as EventListener);
  }, [resetToHub, resetSubPages]);

  // Strategy info state
  const [strategyInfo] = useState({
    strategyId: `strategy-${Date.now()}`,
    strategyName: 'New Strategy',
    isTemporary: true,
  });

  // TICKET_135: V3 removed plugin mode detection

  // TICKET_091: handleGenerate moved to Plugin layer
  // Plugin now directly calls API service (CSP relaxed)

  // Handle reset
  // Handle plugin settings click
  const handleSettingsClick = useCallback((tab?: SettingsTab) => {
    if (tab) {
      setSettingsDefaultTab(tab);
    }
    setShowPluginSettings(true);
  }, []);

  // TICKET_135: V3 removed getHubLabel (no plugin manager), use translation
  const hubLabel = t('strategyStudio.strategyNona');

  // Handle manual navigation from sub-components
  const handleNavigate = useCallback((level: ContentLevel, name?: string, label?: string) => {
    setCurrentLevel(level);
    if (name) {
      setFeatureName(name);
      // TICKET_300: Push sub-page for breadcrumb display (use label for display, name is service ID)
      pushSubPage({
        label: label || name,
        onNavigate: () => resetToHub(),
      });
    }
  }, [setCurrentLevel, setFeatureName, resetToHub, pushSubPage]);

  // TICKET_135: V3 removed plugin mode editor opening effect

  // Content Rendering (V3: always direct rendering)
  // ---------------------------------------------------------------------------

  const renderContent = useCallback(() => {
    switch (currentLevel) {
      case 'hub':
        return <StrategyHub onNavigate={handleNavigate} onSettingsClick={handleSettingsClick} />;
      case 'provider':
        return <ProviderPortal providerId={selectedNode?.id || ''} providerName={selectedNode?.label || ''} />;
      case 'group':
        return <StrategyGroupList />;
      case 'audit':
        return <AuditReportPage />;
      case 'generator':
        // Dynamic editor resolution (TICKET_079)
        // No hardcoded imports - resolve component by service name
        if (featureName) {
          // TICKET_105: Check if service is locked before rendering
          const service = services.find(s => s.id === featureName || s.name === featureName);

          if (service?.locked) {
            // Show locked page placeholder
            return (
              <LockedPagePlaceholder
                serviceName={service.name}
                tier={service.tier as TierLevel}
                description={service.lockReason || t('strategyStudio.tierAccessRequired', { tier: service.tier.toUpperCase() })}
                userHasEnabled={service.enabled}
                onLogin={() => {
                  // TODO: Implement OAuth flow (TICKET_074)
                  console.log('Open login dialog');
                }}
                onViewPlans={() => {
                  window.electronAPI?.marketplace?.openPurchaseUrl(WEBSITE_PRICING_URL);
                }}
              />
            );
          }

          const EditorComponent = getEditorByServiceName(PLUGIN_IDS.STRATEGY, featureName);
          if (EditorComponent) {
            // TICKET_091: Plugin directly calls API (CSP relaxed)
            // Host provides LLM settings, Plugin handles API calls and state
            return (
              <EditorComponent
                onSettingsClick={handleSettingsClick}
                pageTitle={featureName}
              />
            );
          }
          // Editor component not found for this feature
          return (
            <div className="flex items-center justify-center h-full text-color-terminal-text-muted">
              <span>{t('error.editorNotFound', { feature: featureName })}</span>
            </div>
          );
        }
        // No featureName - return to hub
        return <StrategyHub onNavigate={handleNavigate} onSettingsClick={handleSettingsClick} />;
      default:
        return <StrategyHub onNavigate={handleNavigate} onSettingsClick={handleSettingsClick} />;
    }
  }, [currentLevel, selectedNode, handleNavigate, handleSettingsClick, featureName, services]);

  // TICKET_135: V3 removed renderFallbackContent, using renderContent directly

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Auth widget login handler
  const handleLogin = useCallback(() => {
    // TODO: Implement OAuth flow or modal for Strategy provider authentication
    console.debug('[StrategyStudioPage] Login requested');
  }, []);


  // Audit icon button for BreadcrumbBar (hidden when already on audit page)
  const auditIconButton = useMemo(() => {
    if (currentLevel === 'audit') return undefined;
    return (
      <button
        onClick={() => handleNavigate('audit', t('strategy.audit.title'))}
        title={t('strategy.audit.title')}
        className="p-1.5 rounded transition-all text-color-terminal-text-muted hover:text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/10"
      >
        <FileBarChart className="w-4 h-4" />
      </button>
    );
  }, [currentLevel, handleNavigate, t]);

  // TICKET_558: Plugin-level settings icon for BreadcrumbBar (visible across all Strategy pages)
  const settingsIconButton = useMemo(() => {
    if (currentLevel === 'audit') return undefined;
    return (
      <button
        onClick={() => handleSettingsClick()}
        title={t('settings.title')}
        className="p-1.5 rounded transition-all text-color-terminal-text-muted hover:text-color-terminal-text hover:bg-white/5"
      >
        <Settings className="w-4 h-4" />
      </button>
    );
  }, [currentLevel, handleSettingsClick, t]);

  // TICKET_558 + TICKET_591: Combined right content -- icons + page title nameplate
  const breadcrumbRightContent = useMemo(() => {
    const hasIcons = auditIconButton || settingsIconButton;
    // TICKET_786_4: prefer translated shortLabel
    const registryEntry = VIEW_REGISTRY.strategy;
    const fallbackName = registryEntry.shortLabelKey
      ? t(registryEntry.shortLabelKey)
      : (registryEntry.shortLabel || '');
    const nameplateText = pageTitle || fallbackName;
    if (!hasIcons && !nameplateText) return undefined;
    return (
      <div className="flex items-center gap-2">
        {settingsIconButton}
        {auditIconButton}
        {nameplateText && <MiniNameplate text={nameplateText} />}
      </div>
    );
  }, [auditIconButton, settingsIconButton, pageTitle, t]);

  // Show plugin settings page
  if (showPluginSettings) {
    return (
      <PluginSettingsPage
        pluginId={PLUGIN_IDS.STRATEGY}
        pluginName={strategyBuilderLabel}
        onBack={() => setShowPluginSettings(false)}
        defaultTab={settingsDefaultTab}
      />
    );
  }

  return (
    <div className="flex h-full overflow-hidden terminal-theme bg-color-terminal-bg">
      {/* Main Workbench Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header: Breadcrumb Bar (Now synced with global state) */}
        <BreadcrumbBar
          showHome={true}
          homeLabel={t('breadcrumb.nexusHub')}
          onHomeClick={() => {
            setActiveView('nexus');
          }}
          rightContent={breadcrumbRightContent}
        />

        {/* Content Area - TICKET_135: V3 always uses direct rendering */}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default StrategyStudioPage;
