/**
 * VerifyButton
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5). Renders the "Test" button next to
 * a provider card when the contribution declares a `verify` function.
 * Owns the running/success/error visual state but delegates the actual
 * verifier call to its caller (so SecretsPanel can sequence
 * verify -> save -> postConfigureHook).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle, FlaskConical } from 'lucide-react';

import { cn } from '../../../lib/utils';

export type VerifyButtonStatus = 'idle' | 'running' | 'success' | 'error';

export interface VerifyButtonProps {
  status: VerifyButtonStatus;
  onClick: () => void;
  /** i18n-resolved label for the button (default: "Test"). */
  label?: string;
  /** Optional inline message shown next to the button on success/error. */
  message?: string;
  disabled?: boolean;
}

export function VerifyButton({
  status,
  onClick,
  label,
  message,
  disabled,
}: VerifyButtonProps): JSX.Element {
  const { t } = useTranslation('ui');
  const isRunning = status === 'running';

  let Icon = FlaskConical;
  let colorClass = 'text-color-terminal-accent-teal border-color-terminal-accent-teal/40 hover:bg-color-terminal-accent-teal/10';
  if (status === 'running') {
    Icon = Loader2;
    colorClass = 'text-color-terminal-accent-teal border-color-terminal-accent-teal/40';
  } else if (status === 'success') {
    Icon = CheckCircle2;
    colorClass = 'text-color-terminal-accent-green border-color-terminal-accent-green/40 hover:bg-color-terminal-accent-green/10';
  } else if (status === 'error') {
    Icon = XCircle;
    colorClass = 'text-color-terminal-accent-red border-color-terminal-accent-red/40 hover:bg-color-terminal-accent-red/10';
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isRunning}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border',
          'font-mono text-[11px] font-semibold uppercase tracking-wider',
          'transition-colors duration-150',
          colorClass,
          (disabled || isRunning) && 'opacity-60 cursor-not-allowed',
        )}
      >
        <Icon className={cn('w-3.5 h-3.5', isRunning && 'animate-spin')} />
        {label ?? t('settings.testButton')}
      </button>
      {message ? (
        <span
          className={cn(
            'font-mono text-[11px]',
            status === 'success' && 'text-color-terminal-accent-green',
            status === 'error' && 'text-color-terminal-accent-red',
            status === 'idle' && 'text-color-terminal-text-muted',
            status === 'running' && 'text-color-terminal-text-muted',
          )}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
