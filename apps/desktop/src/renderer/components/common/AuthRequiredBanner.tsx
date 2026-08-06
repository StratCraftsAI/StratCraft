/**
 * AuthRequiredBanner Component
 *
 * TICKET_571: Unified amber warning banner shown when authentication is required.
 * Dispatches nexus:auth-required event on login click to highlight the login button.
 *
 * @see TICKET_289 - Symbol Search Auth Error Feedback
 * @see TICKET_293 - Auth-Aware UI Gating
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

export interface AuthRequiredBannerProps {
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /** Custom message override (defaults to i18n auth.loginRequiredBanner) */
  message?: string;
  /** Additional CSS class name */
  className?: string;
}

/**
 * Compact amber warning badge with AlertTriangle icon.
 * Designed for BreadcrumbBar rightContent placement.
 * Auto-hides when authenticated.
 */
export const AuthRequiredBanner: React.FC<AuthRequiredBannerProps> = ({
  isAuthenticated,
  message,
  className,
}) => {
  const { t } = useTranslation('ui');

  if (isAuthenticated) return null;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        fontSize: 12,
        borderRadius: 4,
        background: 'rgba(245, 158, 11, 0.1)',
        color: 'rgb(245, 158, 11)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      <AlertTriangle size={12} style={{ flexShrink: 0 }} />
      <span>
        {message || t('auth.loginRequiredBanner')}
      </span>
    </div>
  );
};
