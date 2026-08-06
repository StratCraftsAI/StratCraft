/**
 * ApiKeyBanner - Awareness banner for API key configuration
 *
 * TICKET_190: BYOK Guest Mode and API Key Privacy
 *
 * Layer 1 prompt: Subtle banner on StrategyHub (Page 2)
 * Provides early awareness about API key requirements for AI features.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Key, Crown, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAMEPLATE_COLORS } from '@shared/constants/colors';

// =============================================================================
// Types
// =============================================================================

export interface ApiKeyBannerProps {
  /** Callback when user clicks "Configure Key" */
  onConfigure: () => void;
  /** Callback when user clicks "Upgrade" */
  onUpgrade: () => void;
  /** Additional CSS classes */
  className?: string;
}

interface LLMAccessResult {
  allowed: boolean;
  source: 'platform' | 'byok' | 'none';
  reason: string;
  requiresBYOK: boolean;
  userTier: string | null;
}

// Session storage key for banner dismissal
const BANNER_DISMISSED_KEY = 'apiKeyBanner_dismissed_session';

// =============================================================================
// Component
// =============================================================================

export function ApiKeyBanner({
  onConfigure,
  onUpgrade,
  className,
}: ApiKeyBannerProps): JSX.Element | null {
  const { t } = useTranslation('ui');
  const [visible, setVisible] = useState(false);
  const [isGuest, setIsGuest] = useState(true); // Track guest status explicitly

  // Check if banner should be shown
  useEffect(() => {
    const checkAccess = async () => {
      try {
        // Check if already dismissed this session
        const dismissed = sessionStorage.getItem(BANNER_DISMISSED_KEY);
        if (dismissed === 'true') {
          return;
        }

        // Check LLM access status
        const response = await window.electronAPI?.entitlement?.canAccessLLMFeatures();
        if (!response?.success || !response.data) {
          return;
        }

        const result: LLMAccessResult = response.data;

        // Determine if user is guest (not logged in)
        const guestUser = result.userTier === null;
        setIsGuest(guestUser);

        // Show banner if:
        // - Guest or Free user (no platform key)
        // - AND no BYOK configured
        if (
          (result.userTier === null || result.userTier === 'free') &&
          result.source !== 'byok'
        ) {
          setVisible(true);
        }
      } catch (error) {
        console.error('[E:UI:API_KEY_CHECK_FAILED] Failed to check access:', error);
      }
    };

    checkAccess();
  }, []);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(BANNER_DISMISSED_KEY, 'true');
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'relative flex items-center justify-between gap-4 px-4 py-3 rounded-md',
        'border border-color-terminal-accent-gold/50',
        className
      )}
      style={{ backgroundColor: NAMEPLATE_COLORS.ACCENT_BG }}
    >
      {/* Icon + Message */}
      <div className="flex items-center gap-3">
        <Key className="h-4 w-4 text-color-terminal-text-muted flex-shrink-0" />

        {/* Message */}
        <span className="text-xs text-color-terminal-text-secondary">
          {t('banner.apiKey.message')}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Configure Key Button */}
        <button
          onClick={onConfigure}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border border-color-terminal-accent-gold/50 text-color-terminal-accent-gold hover:bg-white hover:text-black hover:border-white transition-colors"
        >
          <Key className="h-3 w-3" />
          {t('banner.apiKey.configureKey')}
        </button>

        {/* Upgrade Button - only show "Login & Upgrade" for guest users */}
        <button
          onClick={onUpgrade}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border border-color-terminal-accent-gold/50 text-color-terminal-accent-gold hover:bg-white hover:text-black hover:border-white transition-colors"
        >
          <Crown className="h-3 w-3" />
          {isGuest ? t('banner.apiKey.loginUpgrade') : t('banner.apiKey.upgrade')}
        </button>

        {/* Dismiss Button */}
        <button
          onClick={handleDismiss}
          className="p-0.5 text-color-terminal-text-muted hover:text-color-terminal-text rounded transition-colors"
          title={t('banner.apiKey.dismiss')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default ApiKeyBanner;
