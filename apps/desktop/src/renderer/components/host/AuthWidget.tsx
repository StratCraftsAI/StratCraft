/**
 * AuthWidget - Global authentication status widget (Toolbar level)
 *
 * TICKET_555: Promoted from BreadcrumbBar to Toolbar for global visibility.
 * Displays login button when not authenticated, or user info when logged in.
 * Always rendered (no authRequired gating) so auth is accessible from all pages.
 * Uses useAuth hook to manage OAuth authentication flow.
 *
 * @see TICKET_555 - Global AuthWidget Toolbar Promotion
 * @see TICKET_066_1 - Remote User Authentication
 * @see TICKET_066 - Service Entitlements
 * @see TICKET_067 - Unified Navigation & Toolbar Architecture
 */

import React, { useState, useCallback, useEffect } from 'react';
import { LogIn, User, ChevronDown, Loader2, ArrowUpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAuth, useCreditStatus, type AuthPlan } from '@/hooks';
import { AUTH_HIGHLIGHT_DURATION_MS } from '@shared/constants/timing';
import { AUTH_CONFIG } from '@shared/constants';
import { getIntlLocale } from '@shared/utils/format-locale';
import { InlineAuth } from './InlineAuth';  // TICKET_564
import { useDropdown } from '../../hooks/useDropdown';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AuthWidgetProps {
  className?: string;
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

interface PlanBadgeProps {
  plan: AuthPlan;
}

const PlanBadge: React.FC<PlanBadgeProps> = ({ plan }) => {
  const planStyles: Record<AuthPlan, string> = {
    FREE: 'bg-white/10 text-color-terminal-text-muted border-white/20',
    BASIC: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    PRO: 'bg-color-terminal-accent-gold/20 text-color-terminal-accent-gold border-color-terminal-accent-gold/30',
    GOLD: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  };

  return (
    <span className={cn(
      'px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded border',
      planStyles[plan]
    )}>
      {plan}
    </span>
  );
};

// -----------------------------------------------------------------------------
// AuthWidget Component
// -----------------------------------------------------------------------------

export const AuthWidget: React.FC<AuthWidgetProps> = ({
  className,
}) => {
  const { t } = useTranslation('ui');
  const { isOpen: showDropdown, toggle: toggleDropdown, close: closeDropdown, triggerRef: avatarRef, dropdownRef: menuRef, triggerProps } = useDropdown<HTMLButtonElement, HTMLDivElement>();
  // TICKET_564: Inline auth modal state
  const [showInlineAuth, setShowInlineAuth] = useState(false);
  // TICKET_201: Highlight state for auth-required event
  const [highlight, setHighlight] = useState(false);

  // Use the auth hook for state and actions
  const {
    isAuthenticated,
    user,
    isLoading,
    isLoggingIn,
    isLoggingOut,
    login,
    logout,
  } = useAuth();

  // TICKET_519: Credit status for dropdown display
  const { data: creditData, isLow, isCritical, isExhausted } = useCreditStatus();

  // TICKET_564: Open inline auth modal instead of browser OAuth
  const handleLoginClick = useCallback(() => {
    setShowInlineAuth(true);
  }, []);

  // TICKET_201: Listen for auth-required events from plugins
  useEffect(() => {
    const handleAuthRequired = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      // TICKET_678: action 'open-login' directly opens InlineAuth modal
      if (detail?.action === 'open-login') {
        setShowInlineAuth(true);
        return;
      }
      // Default: highlight the login button to draw attention
      setHighlight(true);
      // Remove highlight after animation
      setTimeout(() => setHighlight(false), AUTH_HIGHLIGHT_DURATION_MS);
    };

    window.addEventListener('nexus:auth-required', handleAuthRequired);
    return () => {
      window.removeEventListener('nexus:auth-required', handleAuthRequired);
    };
  }, []);

  const handleAvatarClick = useCallback(() => {
    toggleDropdown();
  }, [toggleDropdown]);

  const handleLogout = useCallback(async () => {
    closeDropdown();
    try {
      await logout();
    } catch (error) {
      // Error is handled by the hook
      console.error('[E:AUTH:LOGOUT_FAILED] Logout failed:', error);
    }
  }, [logout, closeDropdown]);

  // TICKET_491: Open upgrade plan page in browser
  const handleUpgradePlan = useCallback(() => {
    closeDropdown();
    window.electronAPI?.marketplace?.openPurchaseUrl(AUTH_CONFIG.UPGRADE_URL);
  }, [closeDropdown]);

  // Loading state
  if (isLoading) {
    return (
      <div className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded',
        'bg-white/5 border border-white/10',
        className
      )}>
        <Loader2 className="w-3 h-3 animate-spin text-color-terminal-text-muted" />
        <span className="text-[10px] text-color-terminal-text-muted">{t('common.loading')}</span>
      </div>
    );
  }

  // Not authenticated - show login button
  if (!isAuthenticated || !user) {
    return (
      <>
        <button
          onClick={handleLoginClick}
          disabled={isLoggingIn}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded',
            'bg-color-terminal-accent-teal/10 border border-color-terminal-accent-teal/30',
            'text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/20',
            'transition-all duration-200 group',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            // TICKET_201: Highlight animation when auth is required
            highlight && 'animate-pulse ring-2 ring-color-terminal-accent-teal ring-offset-2 ring-offset-color-terminal-bg',
            className
          )}
        >
          {isLoggingIn ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <LogIn className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {isLoggingIn ? t('common.loggingIn') : t('common.loginSignup')}
          </span>
        </button>
        {/* TICKET_564: Inline auth modal */}
        <InlineAuth isOpen={showInlineAuth} onClose={() => setShowInlineAuth(false)} />
      </>
    );
  }

  // Authenticated - show user info with dropdown
  return (
    <div className={cn('relative', className)}>
      <button
        ref={avatarRef}
        onClick={handleAvatarClick}
        disabled={isLoggingOut}
        className={cn(
          'flex items-center gap-2 px-2 py-1 rounded',
          'bg-white/5 border border-white/10',
          'hover:bg-white/10 hover:border-white/20',
          'transition-all duration-200',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
        {...triggerProps}
      >
        <PlanBadge plan={user.plan} />

        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.name}
            className="w-4 h-4 rounded-full border border-white/20"
          />
        ) : (
          <div className="w-4 h-4 rounded-full bg-color-terminal-accent-teal/30 flex items-center justify-center">
            <User className="w-2.5 h-2.5 text-color-terminal-accent-teal" />
          </div>
        )}

        <ChevronDown className={cn(
          'w-2.5 h-2.5 text-color-terminal-text-muted transition-transform duration-200',
          showDropdown && 'rotate-180'
        )} />
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
          <div ref={menuRef} role="menu" className={cn(
            'absolute right-0 top-full mt-1 z-50',
            'min-w-[160px] py-1 rounded-md',
            'bg-color-terminal-panel border border-color-terminal-border',
            'shadow-lg shadow-black/50'
          )}>
            {/* User Info Header */}
            <div className="px-3 py-2 border-b border-color-terminal-border">
              <p className="text-[10px] font-bold text-white truncate">{user.name}</p>
              <p className="text-[8px] text-color-terminal-text-muted truncate">{user.email}</p>
              <p className="text-[8px] text-color-terminal-text-muted uppercase tracking-wider mt-0.5">
                {t('auth.plan', { plan: user.plan })}
              </p>
              {/* TICKET_519: Credit status display */}
              {creditData && (
                <>
                  <p className={cn(
                    'text-[8px] mt-0.5',
                    isExhausted || isCritical
                      ? 'text-red-400'
                      : isLow
                        ? 'text-amber-400'
                        : 'text-color-terminal-text-muted'
                  )}>
                    {(creditData.totalRecharged ?? 0) > 0
                      ? t('auth.credits', { remaining: creditData.remaining, total: creditData.totalRecharged })
                      : t('auth.creditsRemaining', { remaining: creditData.remaining })
                    }
                  </p>
                  {creditData.resetDate && (
                    <p className="text-[8px] text-color-terminal-text-muted">
                      {t('auth.renews', {
                        date: new Intl.DateTimeFormat(getIntlLocale(), {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        }).format(new Date(creditData.resetDate)),
                      })}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Menu Items */}
            <div className="py-1">
              {/* TICKET_491: Upgrade Plan - visible for non-GOLD tiers */}
              {user.plan !== 'GOLD' && (
                <button
                  onClick={handleUpgradePlan}
                  className={cn(
                    'w-full px-3 py-1.5 text-left flex items-center gap-2',
                    'text-[10px] text-color-terminal-accent-primary font-semibold',
                    'hover:bg-color-terminal-accent-primary/10',
                    'transition-colors'
                  )}
                >
                  <ArrowUpCircle className="w-3 h-3" />
                  {t('common.upgradePlan')}
                </button>
              )}
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className={cn(
                  'w-full px-3 py-1.5 text-left flex items-center gap-2',
                  'text-[10px] text-color-terminal-text-secondary',
                  'hover:bg-white/5 hover:text-white',
                  'transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isLoggingOut && <Loader2 className="w-3 h-3 animate-spin" />}
                {isLoggingOut ? t('common.signingOut') : t('common.signOut')}
              </button>
            </div>
          </div>
      )}
    </div>
  );
};

export default AuthWidget;
