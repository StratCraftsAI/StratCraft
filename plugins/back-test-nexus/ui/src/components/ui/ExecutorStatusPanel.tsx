/**
 * ExecutorStatusPanel Component (component8)
 *
 * TICKET_152: Backtest Result Display
 * TICKET_077: StratCraftsAI UI Component Library
 *
 * Displays executor status, progress, and error messages during backtest execution.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v4" />
    <path d="m16.2 7.8 2.9-2.9" />
    <path d="M18 12h4" />
    <path d="m16.2 16.2 2.9 2.9" />
    <path d="M12 18v4" />
    <path d="m4.9 19.1 2.9-2.9" />
    <path d="M2 12h4" />
    <path d="m4.9 4.9 2.9 2.9" />
  </svg>
);

const CheckCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const AlertCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ExecutorStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExecutorStatusPanelProps {
  status: ExecutorStatus;
  progress?: number;
  message?: string;
  error?: string;
  className?: string;
}

// -----------------------------------------------------------------------------
// Status Config
// -----------------------------------------------------------------------------

const statusConfig: Record<ExecutorStatus, { labelKey: string; colorClass: string; icon: React.ReactNode }> = {
  idle: {
    labelKey: 'executorStatus.ready',
    colorClass: 'text-color-terminal-text-muted',
    icon: null,
  },
  pending: {
    labelKey: 'executorStatus.starting',
    colorClass: 'text-color-terminal-accent-gold',
    icon: <LoaderIcon className="w-5 h-5 animate-spin" />,
  },
  running: {
    labelKey: 'executorStatus.executing',
    colorClass: 'text-color-terminal-accent-gold',
    icon: <LoaderIcon className="w-5 h-5 animate-spin" />,
  },
  completed: {
    labelKey: 'executorStatus.completed',
    colorClass: 'text-green-400',
    icon: <CheckCircleIcon className="w-5 h-5" />,
  },
  failed: {
    labelKey: 'executorStatus.failed',
    colorClass: 'text-red-400',
    icon: <AlertCircleIcon className="w-5 h-5" />,
  },
  cancelled: {
    labelKey: 'executorStatus.cancelled',
    colorClass: 'text-yellow-400',
    icon: <AlertCircleIcon className="w-5 h-5" />,
  },
};

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ExecutorStatusPanel: React.FC<ExecutorStatusPanelProps> = ({
  status,
  progress = 0,
  message,
  error,
  className,
}) => {
  const { t } = useTranslation('backtest');
  const config = statusConfig[status];
  const isRunning = status === 'running' || status === 'pending';

  // Don't render if idle
  if (status === 'idle') {
    return null;
  }

  return (
    <div className={cn(
      'border border-color-terminal-border rounded-lg p-4 bg-color-terminal-panel/30',
      className
    )}>
      {/* Status Header */}
      <div className="flex items-center gap-3 mb-3">
        <span className={config.colorClass}>
          {config.icon}
        </span>
        <div className="flex-1">
          <div className={cn('text-sm font-medium', config.colorClass)}>
            {t(config.labelKey)}
          </div>
          {message && (
            <div className="text-xs text-color-terminal-text-muted mt-0.5">
              {message}
            </div>
          )}
        </div>
        {isRunning && (
          <div className="text-sm font-mono text-color-terminal-text-secondary">
            {progress.toFixed(0)}%
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {isRunning && (
        <div className="h-1.5 bg-color-terminal-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-color-terminal-accent-gold transition-all duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}

      {/* Error Message */}
      {error && status === 'failed' && (
        <div className="mt-3 p-3 rounded border border-red-500/50 bg-red-500/10 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}
    </div>
  );
};

export default ExecutorStatusPanel;
