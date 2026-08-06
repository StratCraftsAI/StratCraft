/**
 * StatusBar Component
 *
 * Bottom status bar with system status indicator.
 * TICKET_194: Added LLM Provider Selector
 * TICKET_233: Added Backtest Status Indicator
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';
import { useAppStore } from '@/stores';
import { LanguageSelector, LLMProviderSelector } from '@/components/common';
import { BacktestStatusIndicator, DownloadStatusIndicator } from '@/components/StatusBar';
import { BacktestConsoleModal } from '@/features/backtest-console/BacktestConsoleModal';
import { useOnboarding } from '@/hooks/useOnboarding';

export function StatusBar() {
  const { t } = useTranslation('ui');
  const { isLoading, error, setActiveView } = useAppStore();
  const { enabled: onboardingEnabled, startTour, isCompleted } = useOnboarding();

  // TICKET_354: Navigation to result page (used by BacktestConsoleModal)
  const handleNavigateToResult = useCallback(() => {
    setActiveView('backtestResult');
  }, [setActiveView]);

  // TICKET_354: Cancel backtest (used by BacktestConsoleModal)
  const handleCancelBacktest = useCallback(async (taskId: string) => {
    const api = (window as any).electronAPI?.executor;
    if (api?.cancelBacktest) {
      try {
        await api.cancelBacktest(taskId);
        console.log('[StatusBar] Cancelled backtest:', taskId);
      } catch (error) {
        console.error('[E:UI:BACKTEST_CANCEL_FAILED] Failed to cancel backtest:', error);
      }
    }
  }, []);

  return (
    <footer className="flex h-6 items-center justify-between border-t border-border bg-card px-4 text-[10px] terminal-theme">
      {/* Left: Status indicator */}
      <div className="flex items-center gap-2">
        {error ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-glow-red" />
            <span className="text-destructive font-mono uppercase tracking-widest">{error}</span>
          </>
        ) : isLoading ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-muted-foreground font-mono uppercase tracking-widest">{t('common.loading')}</span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-glow-teal animate-pulse" />
            <span className="text-muted-foreground font-mono uppercase tracking-widest">{t('status.ready')}</span>
          </>
        )}

        {/* Separator */}
        <span className="text-muted-foreground/50 mx-1">|</span>

        {/* Language Selector */}
        <span data-onboarding="statusbar-language">
          <LanguageSelector />
        </span>

        {/* Separator */}
        <span className="text-muted-foreground/50 mx-1">|</span>

        {/* TICKET_194: LLM Provider Selector */}
        <span data-onboarding="statusbar-llm">
          <LLMProviderSelector />
        </span>
      </div>

      {/* Right: Status Indicators */}
      <div className="flex items-center gap-2 text-muted-foreground">
        {/* TICKET_593: Onboarding toggle */}
        <button
          onClick={() => {
            if (onboardingEnabled && !isCompleted('welcome')) {
              startTour('welcome');
            } else if (onboardingEnabled) {
              startTour('welcome');
            }
          }}
          className="flex items-center justify-center p-0.5 rounded transition-colors hover:text-color-terminal-accent-teal"
          title={t('onboarding.toggleTooltip')}
        >
          <HelpCircle className={`w-3.5 h-3.5 ${onboardingEnabled ? 'text-color-terminal-accent-teal' : 'text-muted-foreground/50'}`} />
        </button>

        {/* Separator */}
        <span className="text-muted-foreground/50">|</span>

        {/* TICKET_348: Download Status Indicator */}
        <DownloadStatusIndicator />

        {/* TICKET_354: Simplified backtest indicator - click opens console */}
        <BacktestStatusIndicator />

      </div>

      {/* TICKET_353: Backtest Console Modal (Portal) */}
      <BacktestConsoleModal
        onNavigateToResult={handleNavigateToResult}
        onCancelBacktest={handleCancelBacktest}
      />
    </footer>
  );
}
