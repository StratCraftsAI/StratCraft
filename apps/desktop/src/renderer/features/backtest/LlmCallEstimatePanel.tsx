/**
 * LlmCallEstimatePanel Component
 *
 * TICKET_398: Displays dry run LLM call estimation results.
 * Shows total bars processed, per-source LLM call counts, and total.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@shared/utils/format-locale';
import type { DryRunResult } from '@/stores/useBacktestStatusStore';

interface LlmCallEstimatePanelProps {
  dryRunResult: DryRunResult;
}

export const LlmCallEstimatePanel: React.FC<LlmCallEstimatePanelProps> = ({ dryRunResult }) => {
  const { t } = useTranslation('ui');
  const locale = getIntlLocale();
  return (
    <div className="mx-4 mb-3 rounded border border-color-terminal-accent-primary/30 bg-color-terminal-accent-primary/5 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-color-terminal-accent-primary mb-2">
        {t('llmEstimate.title')}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        {/* Total bars */}
        <div className="text-color-terminal-text-muted">{t('llmEstimate.barsProcessed')}</div>
        <div className="text-color-terminal-text font-mono">{dryRunResult.totalBars.toLocaleString(locale)}</div>

        {/* Per-source counts */}
        {dryRunResult.llmCalls.map((call, idx) => (
          <React.Fragment key={idx}>
            <div className="text-color-terminal-text-muted">{call.label}</div>
            <div className="text-color-terminal-text font-mono">{call.count.toLocaleString(locale)} {t('llmEstimate.calls')}</div>
          </React.Fragment>
        ))}

        {/* Separator */}
        <div className="col-span-2 border-t border-color-terminal-border/30 my-1" />

        {/* Total */}
        <div className="text-color-terminal-text font-bold">{t('llmEstimate.totalLlmCalls')}</div>
        <div className="text-color-terminal-accent-primary font-mono font-bold">
          {dryRunResult.totalLlmCalls.toLocaleString(locale)}
        </div>
      </div>
    </div>
  );
};
