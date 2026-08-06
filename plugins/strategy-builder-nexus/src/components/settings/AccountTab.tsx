/**
 * AccountTab - Account & Subscription display in Builder plugin settings
 *
 * TICKET_519_1: Moved from Host AccountSettings to Builder plugin.
 * Read-only display of plan info and credit status via IPC.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CreditCard,
  ArrowUpCircle,
  ExternalLink,
  LogIn,
  RefreshCw,
  UserCircle,
  Coins,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getIntlLocale } from '@shared/utils/format-locale';
import { AUTH_UPGRADE_URL } from '@StratCraft/types';

// TICKET_1023_4: URL constants from @StratCraft/types (Tier 0)
const UPGRADE_URL = AUTH_UPGRADE_URL;
const LOW_THRESHOLD_PERCENT = 20;
const CRITICAL_THRESHOLD_PERCENT = 5;

// =============================================================================
// Types
// =============================================================================

interface AccountTabProps {
  pluginId: string;
  /** TICKET_646_2: When true, skip rendering own sidebar (used in unified sidebar layout) */
  embedded?: boolean;
}

type AuthPlan = 'FREE' | 'PRO' | 'GOLD';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: AuthPlan;
  levelExpiresAt?: string;
}

interface CreditData {
  hasCredit: boolean;
  remaining: number;
  totalRecharged?: number;
  totalConsumed?: number;
  updatedAt?: string;
  resetDate?: string;
}

// =============================================================================
// Plan Badge Styles
// =============================================================================

const planStyles: Record<AuthPlan, string> = {
  FREE: 'bg-white/10 text-color-terminal-text-muted border-white/20',
  PRO: 'bg-color-terminal-accent-gold/20 text-color-terminal-accent-gold border-color-terminal-accent-gold/30',
  GOLD: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
};

// =============================================================================
// Nav Items
// =============================================================================

interface NavItem {
  id: string;
  labelKey: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'plan', labelKey: 'accountTab.nav.plan', icon: UserCircle },
  { id: 'credit', labelKey: 'accountTab.nav.credit', icon: Coins },
];

// =============================================================================
// Component
// =============================================================================

export function AccountTab({ pluginId: _pluginId, embedded }: AccountTabProps): JSX.Element {
  const { t } = useTranslation('strategy-builder');
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [creditData, setCreditData] = useState<CreditData | null>(null);
  const [activeSection, setActiveSection] = useState('plan');

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch user info via plugin-available auth API
      const userResult = await window.electronAPI.auth?.getUser();
      if (userResult?.success && userResult.data) {
        setIsAuthenticated(true);
        setUser(userResult.data as AuthUser);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }

      // Fetch credit status (only if authenticated)
      if (userResult?.success && userResult.data) {
        const creditResult = await (window.electronAPI as any).credit?.getStatus();
        if (creditResult?.success && creditResult.data) {
          setCreditData(creditResult.data as CreditData);
        }
      }
    } catch (e) {
      console.error('[E:SETTINGS:ACCOUNT_DATA_LOAD_FAILED] [AccountTab] Failed to load account data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleLogin = useCallback(async () => {
    try {
      await window.electronAPI.auth?.login();
    } catch {
      // Error handled by auth flow
    }
  }, []);

  const handleUpgrade = useCallback(() => {
    nexus?.window?.openExternal?.(UPGRADE_URL);
  }, []);

  // Scroll to section
  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(`account-${sectionId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not authenticated
  // -------------------------------------------------------------------------

  if (!isAuthenticated || !user) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="rounded-lg border border-white/10 p-8 text-center space-y-4 max-w-sm">
          <LogIn className="w-8 h-8 text-color-terminal-text-muted mx-auto" />
          <p className="text-sm text-color-terminal-text-muted">
            {t('accountTab.loginRequired')}
          </p>
          <button
            onClick={handleLogin}
            className={cn(
              'px-4 py-2 rounded-md text-xs font-semibold',
              'bg-color-terminal-accent-primary/20 text-color-terminal-accent-primary',
              'border border-color-terminal-accent-primary/30',
              'hover:bg-color-terminal-accent-primary/30 transition-colors'
            )}
          >
            <LogIn className="w-3 h-3 inline mr-1.5" />
            {t('accountTab.actions.login')}
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Compute credit thresholds
  // -------------------------------------------------------------------------

  const total = creditData?.totalRecharged ?? 0;
  const percentRemaining = creditData && total > 0
    ? (creditData.remaining / total) * 100
    : creditData ? (creditData.remaining > 0 ? 100 : 0) : 100;

  const isLow = creditData !== null
    && percentRemaining <= LOW_THRESHOLD_PERCENT
    && percentRemaining > CRITICAL_THRESHOLD_PERCENT;

  const isCritical = creditData !== null
    && percentRemaining <= CRITICAL_THRESHOLD_PERCENT
    && percentRemaining > 0;

  const isExhausted = creditData !== null
    && creditData.remaining <= 0;

  const progressColor = isExhausted || isCritical
    ? 'bg-red-500'
    : isLow
      ? 'bg-amber-500'
      : 'bg-color-terminal-accent-teal';

  const dateFormatter = new Intl.DateTimeFormat(getIntlLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // TICKET_646_2: Shared content renderer (used in both standalone and embedded modes)
  const renderContent = () => (
    <>
      {/* Plan Section */}
      <div id="account-plan" className="rounded-lg border border-white/10 scroll-mt-4">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <CreditCard className="w-4 h-4 text-color-terminal-accent-teal" />
          <h3 className="font-medium">{t('accountTab.plan.title')}</h3>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border',
                  planStyles[user.plan] || planStyles.FREE,
                )}>
                  {user.plan}
                </span>
                <span className="text-sm text-white">{user.name}</span>
              </div>
              <p className="text-xs text-color-terminal-text-muted">{user.email}</p>
              {user.levelExpiresAt ? (
                <p className="text-xs text-color-terminal-text-muted">
                  {t('accountTab.plan.expires')}: {dateFormatter.format(new Date(user.levelExpiresAt))}
                </p>
              ) : (
                <p className="text-xs text-color-terminal-text-muted">
                  {t('accountTab.plan.neverExpires')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Credit Section */}
      {creditData && (
        <div id="account-credit" className="rounded-lg border border-white/10 scroll-mt-4">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <Coins className="w-4 h-4 text-color-terminal-accent-teal" />
            <h3 className="font-medium">{t('accountTab.credit.title')}</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* Numeric display */}
            <div className="flex items-baseline justify-between">
              <p className={cn(
                'text-sm font-semibold',
                isExhausted || isCritical
                  ? 'text-red-400'
                  : isLow
                    ? 'text-amber-400'
                    : 'text-white'
              )}>
                {isExhausted
                  ? t('accountTab.credit.exhausted')
                  : total > 0
                    ? t('accountTab.credit.remaining', {
                      remaining: creditData.remaining,
                      total: total,
                    })
                    : t('accountTab.credit.remainingOnly', {
                      remaining: creditData.remaining,
                    })
                }
              </p>
              {creditData.resetDate && (
                <p className="text-xs text-color-terminal-text-muted">
                  {t('accountTab.credit.resetsOn', {
                    date: dateFormatter.format(new Date(creditData.resetDate)),
                  })}
                </p>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-300', progressColor)}
                style={{ width: `${Math.max(0, Math.min(100, percentRemaining))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {user.plan === 'FREE' && (
          <button
            onClick={handleUpgrade}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold',
              'bg-color-terminal-accent-primary/20 text-color-terminal-accent-primary',
              'border border-color-terminal-accent-primary/30',
              'hover:bg-color-terminal-accent-primary/30 transition-colors'
            )}
          >
            <ArrowUpCircle className="w-3 h-3" />
            {t('accountTab.actions.upgradePlan')}
          </button>
        )}
        <button
          onClick={handleUpgrade}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold',
            'bg-white/5 text-color-terminal-text-secondary',
            'border border-white/10',
            'hover:bg-white/10 transition-colors'
          )}
        >
          <ExternalLink className="w-3 h-3" />
          {t('accountTab.actions.manageSubscription')}
        </button>
      </div>

      {/* Refresh */}
      <div className="flex justify-end">
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          {t('accountTab.refresh')}
        </button>
      </div>
    </>
  );

  // TICKET_646_2: Embedded mode - content only, no sidebar wrapper
  if (embedded) {
    return <>{renderContent()}</>;
  }

  return (
    <div className="h-full flex">
      {/* Left Navigation */}
      <nav className="w-96 flex-shrink-0 border-r border-white/10 p-4">
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                  isActive
                    ? 'text-color-terminal-accent-teal'
                    : 'text-muted-foreground hover:text-color-terminal-accent-teal'
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Right Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default AccountTab;
