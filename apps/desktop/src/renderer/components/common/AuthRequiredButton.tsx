/**
 * AuthRequiredButton Component
 *
 * TICKET_571: Button that shows "Login Required" when unauthenticated
 * and dispatches nexus:auth-required event on click. Shows normal label
 * and delegates to onClick when authenticated.
 *
 * @see TICKET_289 - Symbol Search Auth Error Feedback
 * @see TICKET_293 - Auth-Aware UI Gating
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { RENDERER_EVENTS } from '@shared/constants/events';

export interface AuthRequiredButtonProps {
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /** Click handler when authenticated */
  onClick: () => void;
  /** Button label when authenticated */
  label: string;
  /** Whether the button is disabled (independent of auth state) */
  disabled?: boolean;
  /** Inline style override */
  style?: React.CSSProperties;
  /** Additional CSS class name */
  className?: string;
}

/**
 * Button that gates actions behind authentication.
 * When unauthenticated: shows "Login Required" text and dispatches auth-required event.
 * When authenticated: shows normal label and calls onClick.
 */
export const AuthRequiredButton: React.FC<AuthRequiredButtonProps> = ({
  isAuthenticated,
  onClick,
  label,
  disabled = false,
  style,
  className,
}) => {
  const { t } = useTranslation('ui');

  const handleClick = () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new Event(RENDERER_EVENTS.AUTH_REQUIRED));
      return;
    }
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      disabled={isAuthenticated ? disabled : false}
      className={className}
      style={style}
    >
      {isAuthenticated ? label : t('auth.loginRequired')}
    </button>
  );
};
