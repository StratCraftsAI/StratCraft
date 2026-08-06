/**
 * DryRunExecuteButton Component
 *
 * TICKET_398: Embedded sliding toggle for dry run / direct execution.
 *
 * Two-segment pill:
 * - DRY RUN mode (default): Runs backtest with LLM calls stubbed for estimation
 * - DIRECT mode: Runs actual backtest with real API calls
 *
 * Click toggle area -> slide animation; click EXECUTE area -> execute with current mode.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { PlayIcon, LoaderIcon } from 'lucide-react';

export interface DryRunExecuteButtonProps {
  dryRunEnabled: boolean;
  onToggle: () => void;
  onExecute: () => void;
  isExecuting: boolean;
  executeLabel?: string;
  executingLabel?: string;
}

export const DryRunExecuteButton: React.FC<DryRunExecuteButtonProps> = ({
  dryRunEnabled,
  onToggle,
  onExecute,
  isExecuting,
  executeLabel,
  executingLabel,
}) => {
  const { t } = useTranslation('backtest');
  
  // Use provided labels or fall back to translations
  const resolvedExecuteLabel = executeLabel ?? t('dryRunExecute.execute');
  const resolvedExecutingLabel = executingLabel ?? t('dryRunExecute.executing');

  return (
    <div className="flex items-center gap-2">
      {/* Toggle pill */}
      <button
        type="button"
        onClick={isExecuting ? undefined : onToggle}
        disabled={isExecuting}
        className={[
          'relative flex items-center h-[34px] rounded border text-[10px] font-bold uppercase tracking-wider transition-all duration-200',
          isExecuting
            ? 'border-color-terminal-border bg-color-terminal-surface cursor-not-allowed opacity-50'
            : 'border-color-terminal-accent-primary/40 bg-color-terminal-surface/80 cursor-pointer hover:border-color-terminal-accent-primary/60',
        ].join(' ')}
        style={{ minWidth: '148px' }}
      >
        {/* Sliding indicator */}
        <span
          className={[
            'absolute top-[2px] bottom-[2px] rounded transition-all duration-200 ease-out',
            dryRunEnabled
              ? 'bg-color-terminal-accent-primary/20 border border-color-terminal-accent-primary/50'
              : 'bg-color-terminal-accent-gold/20 border border-color-terminal-accent-gold/50',
          ].join(' ')}
          style={{
            width: 'calc(50% - 4px)',
            left: dryRunEnabled ? '2px' : 'calc(50% + 2px)',
          }}
        />
        {/* Labels */}
        <span
          className={[
            'relative z-10 flex-1 text-center px-3 py-1 transition-colors duration-150',
            dryRunEnabled ? 'text-color-terminal-accent-primary' : 'text-color-terminal-text-muted',
          ].join(' ')}
        >
          {t('dryRunExecute.dryRun')}
        </span>
        <span
          className={[
            'relative z-10 flex-1 text-center px-3 py-1 transition-colors duration-150',
            !dryRunEnabled ? 'text-color-terminal-accent-gold' : 'text-color-terminal-text-muted',
          ].join(' ')}
        >
          {t('dryRunExecute.direct')}
        </span>
      </button>

      {/* Execute button */}
      <button
        type="button"
        onClick={onExecute}
        disabled={isExecuting}
        className={[
          'flex items-center justify-center gap-2 px-6 py-2 text-xs font-bold uppercase tracking-wider border rounded transition-all',
          isExecuting
            ? 'border-color-terminal-border bg-color-terminal-surface text-color-terminal-text-muted cursor-not-allowed'
            : dryRunEnabled
              ? 'border-color-terminal-accent-primary bg-color-terminal-accent-primary/10 text-color-terminal-accent-primary hover:bg-color-terminal-accent-primary/20'
              : 'border-color-terminal-accent-gold bg-color-terminal-accent-gold/10 text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/20',
        ].join(' ')}
      >
        {isExecuting ? (
          <>
            <LoaderIcon className="w-3 h-3 animate-spin" />
            {resolvedExecutingLabel}
          </>
        ) : (
          <>
            <PlayIcon className="w-3 h-3" />
            {resolvedExecuteLabel}
          </>
        )}
      </button>
    </div>
  );
};
