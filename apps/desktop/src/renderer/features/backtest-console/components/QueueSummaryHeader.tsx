/**
 * Queue Summary Header Component
 *
 * Displays color-coded summary stats for backtest queue state.
 *
 * @see TICKET_353 - Backtest Console Modal
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useBacktestStatusStore } from '@/stores/useBacktestStatusStore';

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function QueueSummaryHeader() {
  const { t } = useTranslation('ui');
  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const pendingTasks = useBacktestStatusStore((state) => state.pendingTasks);

  const runningCount = runningTasks.filter((t) => t.status === 'running').length;
  const queuedCount = pendingTasks.length;
  const doneCount = runningTasks.filter((t) => t.status === 'completed').length;
  const failedCount = runningTasks.filter((t) => t.status === 'failed').length;

  return (
    <div className="flex items-center gap-3">
      <StatBadge label={t('backtestConsole.summary.running')} count={runningCount} colorClass="text-color-terminal-accent-teal bg-color-terminal-accent-teal/10 border-color-terminal-accent-teal/30" />
      <StatBadge label={t('backtestConsole.summary.queued')} count={queuedCount} colorClass="text-color-terminal-accent-gold bg-color-terminal-accent-gold/10 border-color-terminal-accent-gold/30" />
      <StatBadge label={t('backtestConsole.summary.done')} count={doneCount} colorClass="text-green-400 bg-green-400/10 border-green-400/30" />
      <StatBadge label={t('backtestConsole.summary.failed')} count={failedCount} colorClass="text-red-400 bg-red-400/10 border-red-400/30" />
    </div>
  );
}

// -----------------------------------------------------------------------------
// StatBadge
// -----------------------------------------------------------------------------

interface StatBadgeProps {
  label: string;
  count: number;
  colorClass: string;
}

function StatBadge({ label, count, colorClass }: StatBadgeProps) {
  if (count === 0) return null;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[10px] font-medium ${colorClass}`}>
      {count} {label}
    </span>
  );
}
