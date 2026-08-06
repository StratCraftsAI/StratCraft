/**
 * App - Main application component
 *
 * Uses VIEW_REGISTRY for centralized view configuration and lazy loading.
 *
 * @see TICKET_069 - Centralized View Registry
 * @see TICKET_573 Phase 4A - First-launch consent dialog
 */

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/layouts';
import { useAppStore } from '@/stores';
import { VIEW_REGISTRY, type ViewId } from '@/config';
import { ConsentDialog } from '@/components/common/ConsentDialog';
import {
  PersistenceErrorListener,
  CompileGateRejectedListener,
  ToolSweepBlockedListener,
} from '@/components/host';
import { initRendererSentry } from './services/sentry-renderer';
import { initTelemetry } from './services/telemetry-renderer';
import { useOnboarding } from '@/hooks/useOnboarding';

// -----------------------------------------------------------------------------
// Loading Fallback
// -----------------------------------------------------------------------------

function ViewLoading() {
  const { t } = useTranslation('ui');

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-color-terminal-accent-teal border-t-transparent" />
        <span className="text-xs text-color-terminal-text-muted uppercase tracking-wider">
          {t('common.loading')}
        </span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// App Component
// -----------------------------------------------------------------------------

export default function App() {
  const { activeView } = useAppStore();
  const { t } = useTranslation('ui');
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const { enabled: onboardingEnabled, loading: onboardingLoading, startTour, isCompleted } = useOnboarding();
  const onboardingTriggered = useRef(false);

  const setActiveView = useAppStore((s) => s.setActiveView);

  // TICKET_727: Navigate to Strategy Builder so plugin settings can open the LLM tab
  useEffect(() => {
    const handleOpenSettings = () => {
      setActiveView('strategy');
    };
    window.addEventListener('nexus:open-settings', handleOpenSettings);
    return () => window.removeEventListener('nexus:open-settings', handleOpenSettings);
  }, [setActiveView]);

  // TICKET_1055: host-navigate from plugin (e.g. DownloadSummaryStrip -> Data Management)
  const setDataManagementTab = useAppStore((s) => s.setDataManagementTab);
  useEffect(() => {
    const handleHostNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.view) {
        setActiveView(detail.view);
      }
      if (detail?.tab && detail.view === 'dataManagement') {
        setDataManagementTab(detail.tab);
      }
    };
    window.addEventListener('nexus:host-navigate', handleHostNavigate);
    return () => window.removeEventListener('nexus:host-navigate', handleHostNavigate);
  }, [setActiveView, setDataManagementTab]);

  // Check consent status on mount; always init renderer Sentry (crash reports always-on)
  useEffect(() => {
    initRendererSentry();
    // TICKET_196_6 Phase 6: load analytics-consent snapshot for telemetry helper.
    void initTelemetry();
    window.electronAPI.consent.getStatus().then((result) => {
      if (result.success && result.isFirstLaunch) {
        setShowConsentDialog(true);
      }
    }).catch((error) => {
      console.error('[E:AUTH:CONSENT_CHECK_FAILED] Failed to check consent status:', error);
    });
  }, []);

  // TICKET_593: Auto-trigger welcome tour after ConsentDialog closes
  useEffect(() => {
    if (
      !showConsentDialog &&
      !onboardingLoading &&
      onboardingEnabled &&
      !isCompleted('welcome') &&
      !onboardingTriggered.current
    ) {
      onboardingTriggered.current = true;
      // Delay slightly to let the UI settle after consent dialog closes
      const timer = setTimeout(() => startTour('welcome'), 500);
      return () => clearTimeout(timer);
    }
  }, [showConsentDialog, onboardingLoading, onboardingEnabled, isCompleted, startTour]);

  const handleConsentComplete = useCallback(() => {
    setShowConsentDialog(false);
  }, []);

  // Get the component from registry
  const viewConfig = VIEW_REGISTRY[activeView as ViewId];
  const ViewComponent = viewConfig?.component;

  return (
    <MainLayout>
      <Suspense fallback={<ViewLoading />}>
        {ViewComponent ? (
          <ViewComponent />
        ) : (
          <div className="flex h-full items-center justify-center text-color-terminal-text-muted">
            <p>{t('error.viewNotFound', { view: activeView })}</p>
          </div>
        )}
      </Suspense>
      <ConsentDialog open={showConsentDialog} onComplete={handleConsentComplete} />
      {/* TICKET_775: bridge nexus:persistence-error events to in-app toast */}
      <PersistenceErrorListener />
      {/* TICKET_782_1: bridge nexus:compile-gate-rejected events to in-app toast */}
      <CompileGateRejectedListener />
      {/* TICKET_811: bridge nexus:tool-sweep-blocked events to in-app toast */}
      <ToolSweepBlockedListener />
    </MainLayout>
  );
}
