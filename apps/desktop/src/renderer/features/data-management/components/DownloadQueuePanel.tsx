/**
 * DownloadQueuePanel - Download form + queue list
 *
 * TICKET_340: Data Management Center - Download queue UI
 * TICKET_341: Symbol search autocomplete + date auto-fill from COMPONENT8 pattern
 * TICKET_340_1: Timeframe-DateRange mutual constraint
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { Plus, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessage } from '@/hooks/useMessage';
import { useAuthGatedOptions } from '@/hooks/useAuthGatedOptions';
import { useAuthGatedValue } from '@/hooks/useAuthGatedValue';
import { useProviderList } from '@/hooks/useProviderList';
import { SymbolSearchField, parseBackendDate } from '@/components/common/SymbolSearchField';
import type { SymbolSearchResult } from '@/components/common/SymbolSearchField';
import type { QueueTask } from '../hooks/useDownloadQueue';
import { parseLookbackMs, computeMinStartDate } from '@shared/utils/lookback-constraints';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
} from '@shared/constants/intervals';
import { PROVIDER_CLICKHOUSE, PROVIDER_YFINANCE } from '@StratCraft/types';
import { useDataManagementStore } from '../useDataManagementStore';

// =============================================================================
// Types
// =============================================================================

interface ProviderInfo {
  id: string;
  name: string;
  capabilities: {
    intervals: string[];
    supportsSearch: boolean;
    maxLookback?: Record<string, string>;
    requiresAuth?: boolean;
  };
  requiresAuth?: boolean;
  disabled?: boolean;
}

interface IntervalOption {
  interval: string;
  disabled: boolean;
  reason?: string;
}

// =============================================================================
// Timeframe-DateRange Constraint Utilities (TICKET_340_1)
// =============================================================================

const MS_PER_DAY = 86400000;

/**
 * Compute which intervals are valid given current date range.
 * Returns interval list with disabled state and reason.
 */
function computeIntervalConstraints(
  intervals: string[],
  maxLookback: Record<string, string> | undefined,
  startDate: string,
  endDate: string,
): IntervalOption[] {
  if (!maxLookback || !startDate || !endDate) {
    return intervals.map(i => ({ interval: i, disabled: false }));
  }
  const spanMs = new Date(endDate).getTime() - new Date(startDate).getTime();
  return intervals.map(interval => {
    const limit = maxLookback[interval];
    if (!limit) return { interval, disabled: false };
    const limitMs = parseLookbackMs(limit);
    if (spanMs > limitMs) {
      return { interval, disabled: true, reason: i18n.t('dataManagement.maxLookback', { ns: 'ui', limit }) };
    }
    return { interval, disabled: false };
  });
}

/**
 * Select best default interval given date range span.
 * Respects maxLookback constraints.
 */
function computeSmartDefault(
  intervals: string[],
  maxLookback: Record<string, string> | undefined,
  startDate: string,
  endDate: string,
): string {
  if (!startDate || !endDate || intervals.length === 0) return intervals[0] || INTERVAL_1d;

  const spanMs = new Date(endDate).getTime() - new Date(startDate).getTime();
  const spanDays = spanMs / MS_PER_DAY;

  // Heuristic: prefer finest granularity that fits the span
  const preference: string[] = [];
  if (spanDays <= 7) preference.push(INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d);
  else if (spanDays <= 60) preference.push(INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d);
  else if (spanDays <= 730) preference.push(INTERVAL_1h, INTERVAL_1d, INTERVAL_1w);
  else preference.push(INTERVAL_1d, INTERVAL_1w, INTERVAL_1M);

  for (const pref of preference) {
    if (!intervals.includes(pref)) continue;
    if (maxLookback?.[pref]) {
      const limitMs = parseLookbackMs(maxLookback[pref]);
      if (spanMs > limitMs) continue;
    }
    return pref;
  }

  return intervals[intervals.length - 1];
}

interface DownloadQueuePanelProps {
  tasks: QueueTask[];
  onEnqueue: (config: {
    symbol: string;
    interval: string;
    startDate: string;
    endDate: string;
    provider: string;
  }) => void;
  onCancel: (taskId: string) => void;
}

// =============================================================================
// Status Icon
// =============================================================================

/** Maps caller IDs to i18n keys under `dataManagement.callerBadge.*`. */
const CALLER_BADGE_KEY_MAP: Record<string, string> = {
  'alpha-factory-sweep': 'dataManagement.callerBadge.sweep',
  'alpha-factory-backtest': 'dataManagement.callerBadge.backtest',
  'signal-discovery': 'dataManagement.callerBadge.discovery',
  'statistical-validator': 'dataManagement.callerBadge.validation',
  'scoreboard': 'dataManagement.callerBadge.scoreboard',
  'fetch-candles': 'dataManagement.callerBadge.restore',
};

const SourceBadge: React.FC<{ callerId?: string }> = ({ callerId }) => {
  const { t } = useTranslation('ui');
  if (!callerId) return null;
  const labelKey = CALLER_BADGE_KEY_MAP[callerId];
  if (!labelKey) return null;
  return (
    <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider rounded bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal border border-color-terminal-accent-teal/20">
      {t(labelKey)}
    </span>
  );
};

const StatusIcon: React.FC<{ status: QueueTask['status'] }> = ({ status }) => {
  switch (status) {
    case 'queued':
      return <div className="w-2 h-2 rounded-full bg-color-terminal-text-muted" />;
    case 'downloading':
      return <Loader2 className="w-3.5 h-3.5 text-color-terminal-accent-teal animate-spin" />;
    case 'complete':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
    case 'partial':
      return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
    case 'error':
      return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
  }
};

// =============================================================================
// Component
// =============================================================================

export const DownloadQueuePanel: React.FC<DownloadQueuePanelProps> = ({
  tasks,
  onEnqueue,
  onCancel,
}) => {
  const { t } = useTranslation('ui');
  const message = useMessage();
  const draft = useDataManagementStore((s) => s.download);
  const setDraft = useDataManagementStore((s) => s.setDownloadDraft);
  const resetDraft = useDataManagementStore((s) => s.resetDownloadDraft);
  const { symbol, interval, startDate, endDate, provider } = draft;
  const setSymbol = useCallback((v: string) => setDraft({ symbol: v }), [setDraft]);
  const setInterval = useCallback((v: string) => setDraft({ interval: v }), [setDraft]);
  const setStartDate = useCallback((v: string) => setDraft({ startDate: v }), [setDraft]);
  const setEndDate = useCallback((v: string) => setDraft({ endDate: v }), [setDraft]);
  const setProvider = useCallback((v: string) => setDraft({ provider: v }), [setDraft]);
  const [lookbackHint, setLookbackHint] = useState('');

  // TICKET_883 Phase 2: unified provider hook
  const { providers: hookProviders } = useProviderList();
  const providers = useMemo<ProviderInfo[]>(() =>
    hookProviders.map(p => ({
      id: p.id,
      name: p.name,
      capabilities: {
        intervals: ((p.capabilities as { intervals?: string[] })?.intervals) ?? [],
        supportsSearch: ((p.capabilities as { supportsSearch?: boolean })?.supportsSearch) ?? false,
        maxLookback: (p.capabilities as { maxLookback?: Record<string, string> })?.maxLookback,
        requiresAuth: (p.capabilities as { requiresAuth?: boolean })?.requiresAuth,
      },
      requiresAuth: (p.capabilities as { requiresAuth?: boolean })?.requiresAuth ?? false,
    })),
    [hookProviders],
  );

  // TICKET_293: Auth-gated default provider selection
  const defaultProviderId = useAuthGatedValue({
    authenticated: PROVIDER_CLICKHOUSE,
    unauthenticated: PROVIDER_YFINANCE,
  });

  // TICKET_883: auto-select default provider when hook delivers data
  useEffect(() => {
    if (providers.length > 0 && !provider) {
      const defaultExists = providers.find(p => p.id === defaultProviderId);
      const selected = defaultExists ? defaultProviderId : providers[0].id;
      setProvider(selected);
      const sel = providers.find(p => p.id === selected);
      if (sel && sel.capabilities?.intervals?.length > 0) {
        setInterval(sel.capabilities.intervals[0]);
      }
    }
  }, [providers, defaultProviderId, provider]);

  // TICKET_293: Gate providers based on auth state
  const gatedProviders = useAuthGatedOptions(providers, { behavior: 'disable' });

  // Update available intervals when provider changes
  const selectedProvider = providers.find(p => p.id === provider);
  const availableIntervals = selectedProvider?.capabilities?.intervals || [];
  const maxLookback = selectedProvider?.capabilities?.maxLookback;

  // TICKET_340_1: Compute interval constraints based on current date range
  const constrainedIntervals = useMemo<IntervalOption[]>(
    () => computeIntervalConstraints(availableIntervals, maxLookback, startDate, endDate),
    [availableIntervals, maxLookback, startDate, endDate],
  );

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    // TICKET_314 pattern: clear dependent fields when provider changes
    setSymbol('');
    setStartDate('');
    setEndDate('');
    const p = providers.find(pr => pr.id === newProvider);
    if (p?.capabilities?.intervals?.length) {
      setInterval(p.capabilities.intervals[0]);
    }
  }, [providers]);

  /**
   * Symbol search handler - routes to data:searchSymbols IPC
   * Same pattern as BacktestPage.handleSymbolSearch (COMPONENT8)
   */
  const handleSymbolSearch = useCallback(async (query: string): Promise<{
    results: SymbolSearchResult[];
    totalCount: number;
    truncated: boolean;
  }> => {
    const api = window.electronAPI;
    if (!api?.data?.searchSymbols) return { results: [], totalCount: 0, truncated: false };

    // TICKET_641_10: IPC now returns { results, totalCount, truncated }
    const response = await api.data.searchSymbols(query, provider);
    const results = (response.results || []).map((r: any) => ({
      symbol: r.symbol || query,
      name: r.name || r.symbol || query,
      exchange: r.exchange,
      type: r.type,
      startTime: r.startTime,
      endTime: r.endTime,
    }));
    return {
      results,
      totalCount: response.totalCount ?? results.length,
      truncated: response.truncated ?? false,
    };
  }, [provider]);

  /**
   * Symbol selection handler - auto-fill start/end dates
   * Same two-phase pattern as BacktestDataConfigPanel.handleSymbolSelect:
   * Phase 1: Parse dates from search result (immediate)
   * Phase 2: Fallback to getSymbolDateRange API if dates missing
   */
  const handleSymbolSelect = useCallback(async (result: SymbolSearchResult) => {
    setSymbol(result.symbol);
    setLookbackHint('');

    // Phase 1: Parse dates from search result
    let finalStart = parseBackendDate(result.startTime);
    let finalEnd = parseBackendDate(result.endTime);

    if (finalStart) setStartDate(finalStart);
    if (finalEnd) setEndDate(finalEnd);

    // Phase 2: If dates missing, fetch via getSymbolDateRange API
    if (!finalStart || !finalEnd) {
      try {
        const api = window.electronAPI;
        if (api?.data?.getSymbolDateRange) {
          const dateRange = await api.data.getSymbolDateRange(result.symbol, provider);
          if (!finalStart && dateRange?.startTime) {
            const sd = parseBackendDate(dateRange.startTime);
            if (sd) { finalStart = sd; setStartDate(sd); }
          }
          if (!finalEnd && dateRange?.endTime) {
            const ed = parseBackendDate(dateRange.endTime);
            if (ed) { finalEnd = ed; setEndDate(ed); }
          }
        }
      } catch (error) {
        // Non-fatal: user can manually set dates
        console.warn('[W:DATA:DATE_RANGE_FETCH_FAILED] Failed to fetch symbol date range:', error);
      }
    }

    // TICKET_340_1: Smart default interval based on provider + date range
    if (finalStart && finalEnd) {
      const p = providers.find(pr => pr.id === provider);
      const intervals = p?.capabilities?.intervals || [];
      const ml = p?.capabilities?.maxLookback;
      const smart = computeSmartDefault(intervals, ml, finalStart, finalEnd);
      setInterval(smart);
      message.info(t('dataManagement.download.intervalSetTo', {
        provider: p?.name || provider,
        interval: smart,
        symbol: result.symbol
      }));
    }
  }, [provider, providers, message, t]);

  // TICKET_340_1: Interval change -> constrain dates if maxLookback exceeded
  const handleIntervalChange = useCallback((newInterval: string) => {
    setInterval(newInterval);
    setLookbackHint('');
    if (!endDate || !maxLookback) return;
    const minStart = computeMinStartDate(newInterval, maxLookback, endDate);
    if (minStart && startDate && startDate < minStart) {
      setStartDate(minStart);
      const limit = maxLookback[newInterval];
      const providerName = selectedProvider?.name || provider;
      const hint = t('dataManagement.download.lookbackAdjusted', {
        provider: providerName,
        interval: newInterval,
        limit,
        date: minStart
      });
      setLookbackHint(hint);
      message.warning(hint);
    }
  }, [endDate, startDate, maxLookback, selectedProvider, provider, message, t]);

  // TICKET_340_1: Date change -> auto-switch interval if current is now invalid
  const handleStartDateChange = useCallback((newStart: string) => {
    setStartDate(newStart);
    setLookbackHint('');
    if (!endDate || !newStart) return;
    if (maxLookback?.[interval]) {
      const minStart = computeMinStartDate(interval, maxLookback, endDate);
      if (minStart && newStart < minStart) {
        const smart = computeSmartDefault(availableIntervals, maxLookback, newStart, endDate);
        setInterval(smart);
        const hint = t('dataManagement.download.switchedInterval', {
          interval: smart,
          oldInterval: interval
        });
        setLookbackHint(hint);
        message.warning(hint);
      }
    }
  }, [endDate, interval, maxLookback, availableIntervals, message, t]);

  const handleEndDateChange = useCallback((newEnd: string) => {
    setEndDate(newEnd);
    setLookbackHint('');
    if (!startDate || !newEnd) return;
    if (maxLookback?.[interval]) {
      const minStart = computeMinStartDate(interval, maxLookback, newEnd);
      if (minStart && startDate < minStart) {
        const smart = computeSmartDefault(availableIntervals, maxLookback, startDate, newEnd);
        setInterval(smart);
        const hint = t('dataManagement.download.switchedInterval', {
          interval: smart,
          oldInterval: interval
        });
        setLookbackHint(hint);
        message.warning(hint);
      }
    }
  }, [startDate, interval, maxLookback, availableIntervals, message, t]);

  // TICKET_340_1: Submit with maxLookback validation
  const handleSubmit = useCallback(() => {
    if (!symbol || !interval || !startDate || !endDate || !provider) return;
    // Final safety check
    const minStart = computeMinStartDate(interval, maxLookback, endDate);
    if (minStart && startDate < minStart) {
      const limit = maxLookback?.[interval];
      const errMsg = t('dataManagement.download.lookbackError', {
        provider: selectedProvider?.name || provider,
        interval,
        limit
      });
      setLookbackHint(errMsg);
      message.error(errMsg);
      return;
    }
    onEnqueue({ symbol: symbol.toUpperCase(), interval, startDate, endDate, provider });
    setDraft({ symbol: '', startDate: '', endDate: '' });
    setLookbackHint('');
  }, [symbol, interval, startDate, endDate, provider, maxLookback, selectedProvider, onEnqueue, message, t]);

  const canSubmit = symbol && interval && startDate && endDate && provider;

  return (
    <div className="flex flex-col h-full">
      {/* Download Form */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-color-terminal-text-muted mb-2 font-medium">
          {t('dataManagement.download.newDownload')}
        </div>
        <div className="flex items-end gap-3">
          {/* Provider */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-color-terminal-text-muted">{t('dataManagement.download.provider')}</label>
            <select
              value={provider}
              onChange={e => handleProviderChange(e.target.value)}
              className="px-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary focus:outline-none focus:border-color-terminal-accent-teal min-w-[120px]"
            >
              {gatedProviders.map(p => (
                <option key={p.id} value={p.id} disabled={p.disabled} className="bg-color-terminal-panel">{p.name}</option>
              ))}
            </select>
          </div>

          {/* Symbol - with search autocomplete */}
          <SymbolSearchField
            label={t('dataManagement.download.symbol')}
            value={symbol}
            onChange={setSymbol}
            onSearch={handleSymbolSearch}
            onSelect={handleSymbolSelect}
            dataSource={provider}
            disabled={!provider}
            placeholder={t('dataManagement.download.searchSymbol')}
            className="w-[160px]"
          />

          {/* Interval - TICKET_340_1: disabled options with constraint reason */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-color-terminal-text-muted">{t('dataManagement.download.interval')}</label>
            <select
              value={interval}
              onChange={e => handleIntervalChange(e.target.value)}
              className="px-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary focus:outline-none focus:border-color-terminal-accent-teal min-w-[80px]"
            >
              {constrainedIntervals.map(ci => (
                <option
                  key={ci.interval}
                  value={ci.interval}
                  disabled={ci.disabled}
                  className={cn('bg-color-terminal-panel', ci.disabled && 'text-color-terminal-text-muted')}
                >
                  {ci.interval}{ci.disabled ? ` (${ci.reason})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Start Date - TICKET_340_1: triggers interval auto-switch */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-color-terminal-text-muted">{t('dataManagement.download.start')}</label>
            <input
              type="date"
              value={startDate}
              onChange={e => handleStartDateChange(e.target.value)}
              className="px-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary focus:outline-none focus:border-color-terminal-accent-teal"
            />
          </div>

          {/* End Date - TICKET_340_1: triggers interval auto-switch */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-color-terminal-text-muted">{t('dataManagement.download.end')}</label>
            <input
              type="date"
              value={endDate}
              onChange={e => handleEndDateChange(e.target.value)}
              className="px-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary focus:outline-none focus:border-color-terminal-accent-teal"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium transition-colors",
              canSubmit
                ? "bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal border border-color-terminal-accent-teal/30 hover:bg-color-terminal-accent-teal/30"
                : "bg-white/5 text-color-terminal-text-muted border border-white/10 cursor-not-allowed"
            )}
          >
            <Plus className="w-3 h-3" />
            {t('dataManagement.download.addToQueue')}
          </button>
        </div>
        {/* TICKET_340_1: Lookback constraint hint */}
        {lookbackHint && (
          <div className="text-[10px] text-yellow-400/80 mt-1.5 px-0.5">
            {lookbackHint}
          </div>
        )}
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-xs">
            {t('dataManagement.download.noTasks')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-color-terminal-bg/95 backdrop-blur-sm">
              <tr className="border-b border-white/10">
                <th className="w-8 px-3 py-2"></th>
                <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.download.columnSymbol')}</th>
                <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.download.columnInterval')}</th>
                <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.download.columnProvider')}</th>
                <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.download.columnStatus')}</th>
                <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.download.columnProgress')}</th>
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr key={task.taskId} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="w-8 px-3 py-2">
                    <StatusIcon status={task.status} />
                  </td>
                  <td className="px-3 py-2 text-color-terminal-text-primary font-mono font-medium">
                    {task.symbol}
                    <SourceBadge callerId={task.callerId} />
                  </td>
                  <td className="px-3 py-2 text-color-terminal-text-secondary">{task.interval}</td>
                  <td className="px-3 py-2 text-color-terminal-text-secondary">{task.provider}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "text-[10px] uppercase font-medium",
                      task.status === 'complete' && "text-green-400",
                      task.status === 'partial' && "text-amber-400",
                      task.status === 'error' && "text-red-400",
                      task.status === 'downloading' && "text-color-terminal-accent-teal",
                      task.status === 'queued' && "text-color-terminal-text-muted",
                    )}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {task.status === 'downloading' ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden max-w-[120px]">
                          <div
                            className="h-full bg-color-terminal-accent-teal rounded-full transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-color-terminal-text-muted w-8 text-right">
                          {task.progress}%
                        </span>
                        {task.totalChunks != null && task.totalChunks > 0 && (
                          <span className="text-[10px] text-color-terminal-text-muted whitespace-nowrap">
                            {task.completedChunks ?? 0}/{task.totalChunks}
                            {task.currentChunkStart && (
                              <span className="ml-1 opacity-60">{task.currentChunkStart.slice(0, 7)}</span>
                            )}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-color-terminal-text-muted text-[10px]">{task.message}</span>
                    )}
                  </td>
                  <td className="w-10 px-2 py-2 text-center">
                    {task.status === 'queued' && (
                      <button
                        onClick={() => onCancel(task.taskId)}
                        className="p-1 text-color-terminal-text-muted hover:text-red-400 transition-colors"
                        title={t('dataManagement.download.cancel')}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
