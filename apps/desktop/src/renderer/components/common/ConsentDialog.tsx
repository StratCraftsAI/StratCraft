/**
 * ConsentDialog - First-Launch Privacy Consent (TICKET_573 Phase 4A)
 *
 * Crash reports are always-on (text declaration, not checkbox).
 * Analytics is opt-in (GDPR Article 7 - explicit opt-in required).
 * Dismiss (ESC/close) = "No Thanks" (crash ON, analytics OFF).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, X, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { THEME_COLORS } from '@shared/constants/colors';

// =============================================================================
// Types
// =============================================================================

interface ConsentDialogProps {
  open: boolean;
  onComplete: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ConsentDialog({ open, onComplete }: ConsentDialogProps): JSX.Element | null {
  const { t } = useTranslation('settings');
  const [analytics, setAnalytics] = useState(false);

  const handleDecline = useCallback(async () => {
    try {
      await window.electronAPI.consent.setConsent(true, false);
    } catch (error) {
      console.error('[E:UI:CONSENT_SET_FAILED] Failed to set consent:', error);
    }
    onComplete();
  }, [onComplete]);

  const handleAccept = useCallback(async () => {
    try {
      await window.electronAPI.consent.setConsent(true, analytics);
    } catch (error) {
      console.error('[E:UI:CONSENT_SET_FAILED] Failed to set consent:', error);
    }
    onComplete();
  }, [analytics, onComplete]);

  // ESC key = decline
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDecline();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleDecline]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-md rounded-xl border border-white/10 bg-[${THEME_COLORS.DROPDOWN_BG}] shadow-2xl animate-in fade-in zoom-in-95`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-color-terminal-accent-teal/10">
              <Shield className="h-5 w-5 text-color-terminal-accent-teal" />
            </div>
            <h2 className="text-lg font-semibold text-color-terminal-text-primary">
              {t('consent.title')}
            </h2>
          </div>
          <button
            onClick={handleDecline}
            className="rounded-lg p-2 hover:bg-white/10 text-color-terminal-text-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-color-terminal-text-muted">
            {t('consent.description')}
          </p>

          {/* Crash reports: always-on declaration */}
          <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <Activity className="h-4 w-4 text-color-terminal-accent-teal mt-0.5 shrink-0" />
            <div>
              <span className="text-sm font-medium text-color-terminal-text-primary">
                {t('consent.crashReports')}
              </span>
              <p className="text-xs text-color-terminal-text-muted mt-0.5">
                {t('consent.crashReportsAlwaysOn')}
              </p>
            </div>
          </div>

          {/* Separator: optional data sharing */}
          <div className="text-xs font-medium uppercase tracking-wider text-color-terminal-text-muted">
            {t('consent.optionalDataSharing')}
          </div>

          {/* Analytics: opt-in checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 text-color-terminal-accent-teal focus:ring-color-terminal-accent-teal"
            />
            <div>
              <span className="text-sm font-medium text-color-terminal-text-primary">
                {t('consent.analytics')}
              </span>
              <p className="text-xs text-color-terminal-text-muted mt-0.5">
                {t('consent.analyticsDescription')}
              </p>
            </div>
          </label>

          {/* Privacy note */}
          <div className="rounded-lg border border-color-terminal-accent-teal/30 bg-color-terminal-accent-teal/5 p-3">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-color-terminal-accent-teal mt-0.5 shrink-0" />
              <p className="text-xs text-color-terminal-text-muted">
                {t('consent.privacyNote')}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
          <button
            onClick={handleDecline}
            className="rounded-lg px-4 py-2 text-sm font-medium text-color-terminal-text-muted hover:bg-white/10"
          >
            {t('consent.noThanks')}
          </button>
          <button
            onClick={handleAccept}
            disabled={!analytics}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium",
              analytics
                ? "bg-color-terminal-accent-teal text-black hover:bg-color-terminal-accent-teal/80"
                : "bg-white/10 text-color-terminal-text-muted cursor-not-allowed opacity-50"
            )}
          >
            {t('consent.enableSelected')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentDialog;
