/**
 * DataCatalogTable - Segment browser with filters
 *
 * TICKET_340: Data Management Center - Catalog browsing
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, RefreshCw, Search, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getIntlLocale } from '@shared/utils/format-locale';
import type { CacheStats, DataSegmentInfo, SegmentFilters } from '../hooks/useDataCatalog';
import { useDataManagementStore } from '../useDataManagementStore';

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// =============================================================================
// Component
// =============================================================================

interface DataCatalogTableProps {
  segments: DataSegmentInfo[];
  total: number;
  filters: SegmentFilters;
  loading: boolean;
  stats: CacheStats | null;
  onFiltersChange: (filters: SegmentFilters) => void;
  onDelete: (ids: number[]) => void;
  onRefresh: () => void;
}

export const DataCatalogTable: React.FC<DataCatalogTableProps> = ({
  segments,
  total,
  filters,
  loading,
  stats,
  onFiltersChange,
  onDelete,
  onRefresh,
}) => {
  const { t } = useTranslation('ui');
  const selected = useDataManagementStore((s) => s.catalog.selected);
  const setSelected = useDataManagementStore((s) => s.setCatalogSelected);
  const collapsed = useDataManagementStore((s) => s.catalog.collapsed);
  const setCollapsed = useDataManagementStore((s) => s.setCatalogCollapsed);

  const toggleSelect = useCallback((id: number) => {
    const cur = useDataManagementStore.getState().catalog.selected;
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }, [setSelected]);

  const toggleAll = useCallback(() => {
    if (selected.size === segments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(segments.map(s => s.id)));
    }
  }, [segments, selected.size, setSelected]);

  const toggleGroup = useCallback((provider: string) => {
    const cur = useDataManagementStore.getState().catalog.collapsed;
    setCollapsed({ ...cur, [provider]: !cur[provider] });
  }, [setCollapsed]);

  const toggleGroupSelect = useCallback((groupSegments: DataSegmentInfo[]) => {
    const cur = useDataManagementStore.getState().catalog.selected;
    const next = new Set(cur);
    const groupIds = groupSegments.map(s => s.id);
    const allSelected = groupIds.every(id => next.has(id));
    if (allSelected) {
      groupIds.forEach(id => next.delete(id));
    } else {
      groupIds.forEach(id => next.add(id));
    }
    setSelected(next);
  }, [setSelected]);

  const handleBulkDelete = useCallback(() => {
    if (selected.size === 0) return;
    onDelete(Array.from(selected));
    setSelected(new Set());
  }, [selected, onDelete]);

  // Group segments by provider
  const groupedSegments = useMemo(() => {
    const groups = new Map<string, DataSegmentInfo[]>();
    for (const seg of segments) {
      const existing = groups.get(seg.provider);
      if (existing) existing.push(seg);
      else groups.set(seg.provider, [seg]);
    }
    return groups;
  }, [segments]);

  const providers = useMemo(
    () => stats?.byProvider.map(p => p.provider) ?? [],
    [stats],
  );
  const intervals = useMemo(
    () => stats?.allIntervals ?? [],
    [stats],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filter Bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5">
        {/* Symbol search */}
        <div className="relative flex-1 max-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-color-terminal-text-muted" />
          <input
            type="text"
            value={filters.symbol}
            onChange={e => onFiltersChange({ ...filters, symbol: e.target.value })}
            placeholder={t('dataManagement.catalog.searchSymbol')}
            className="w-full pl-8 pr-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary placeholder:text-color-terminal-text-muted/50 focus:outline-none focus:border-color-terminal-accent-teal"
          />
        </div>

        {/* Provider filter */}
        <select
          value={filters.provider}
          onChange={e => onFiltersChange({ ...filters, provider: e.target.value })}
          className="px-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary focus:outline-none focus:border-color-terminal-accent-teal"
        >
          <option value="" className="bg-color-terminal-panel">{t('dataManagement.catalog.allProviders')}</option>
          {providers.map(p => <option key={p} value={p} className="bg-color-terminal-panel">{p}</option>)}
        </select>

        {/* Interval filter */}
        <select
          value={filters.interval}
          onChange={e => onFiltersChange({ ...filters, interval: e.target.value })}
          className="px-3 py-1.5 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary focus:outline-none focus:border-color-terminal-accent-teal"
        >
          <option value="" className="bg-color-terminal-panel">{t('dataManagement.catalog.allIntervals')}</option>
          {intervals.map(i => <option key={i} value={i} className="bg-color-terminal-panel">{i}</option>)}
        </select>

        <div className="flex-1" />

        {/* Bulk delete */}
        {selected.size > 0 && (
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded text-xs hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            {t('dataManagement.catalog.deleteCount', { count: selected.size })}
          </button>
        )}

        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="p-1.5 text-color-terminal-text-muted hover:text-color-terminal-accent-teal transition-colors"
          title={t('dataManagement.catalog.refresh')}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>

        <span className="text-[10px] text-color-terminal-text-muted">
          {t('dataManagement.catalog.totalSegments', { count: total })}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-color-terminal-bg/95 backdrop-blur-sm z-10">
            <tr className="border-b border-white/10">
              <th className="w-8 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  checked={segments.length > 0 && selected.size === segments.length}
                  onChange={toggleAll}
                  className="accent-color-terminal-accent-teal"
                />
              </th>
              <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.catalog.columnSymbol')}</th>
              <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.catalog.columnInterval')}</th>
              <th className="px-3 py-2 text-left text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.catalog.columnDateRange')}</th>
              <th className="px-3 py-2 text-right text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.catalog.columnRows')}</th>
              <th className="px-3 py-2 text-right text-color-terminal-text-muted font-medium uppercase tracking-wider text-[10px]">{t('dataManagement.catalog.columnSize')}</th>
              <th className="w-12 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {segments.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-color-terminal-text-muted">
                  {loading ? t('dataManagement.catalog.loading') : t('dataManagement.catalog.noData')}
                </td>
              </tr>
            ) : (
              Array.from(groupedSegments.entries()).map(([provider, groupSegs]) => {
                const isCollapsed = collapsed[provider] ?? false;
                const uniqueSymbols = new Set(groupSegs.map(s => s.symbol)).size;
                const totalSize = groupSegs.reduce((sum, s) => sum + s.fileSize, 0);
                const groupIds = groupSegs.map(s => s.id);
                const allGroupSelected = groupIds.every(id => selected.has(id));
                const someGroupSelected = !allGroupSelected && groupIds.some(id => selected.has(id));

                return (
                  <React.Fragment key={provider}>
                    {/* Group header */}
                    <tr
                      className="border-b border-white/10 bg-white/[0.03] cursor-pointer select-none"
                      onClick={() => toggleGroup(provider)}
                    >
                      <td className="w-8 px-2 py-2" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allGroupSelected}
                          ref={el => { if (el) el.indeterminate = someGroupSelected; }}
                          onChange={() => toggleGroupSelect(groupSegs)}
                          className="accent-color-terminal-accent-teal"
                        />
                      </td>
                      <td colSpan={6} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isCollapsed
                            ? <ChevronRight className="w-3.5 h-3.5 text-color-terminal-text-muted" />
                            : <ChevronDown className="w-3.5 h-3.5 text-color-terminal-text-muted" />
                          }
                          <span className="text-color-terminal-text-primary font-medium capitalize">
                            {provider}
                          </span>
                          <span className="text-color-terminal-text-muted text-[10px]">
                            {t('dataManagement.catalog.groupSummary', {
                              symbols: uniqueSymbols,
                              segments: groupSegs.length,
                              size: formatBytes(totalSize)
                            })}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Segment rows */}
                    {!isCollapsed && groupSegs.map(seg => (
                      <tr
                        key={seg.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="w-8 px-2 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(seg.id)}
                            onChange={() => toggleSelect(seg.id)}
                            className="accent-color-terminal-accent-teal"
                          />
                        </td>
                        <td className="px-3 py-2 text-color-terminal-text-primary font-mono font-medium">{seg.symbol}</td>
                        <td className="px-3 py-2 text-color-terminal-text-secondary">{seg.interval}</td>
                        <td className="px-3 py-2 text-color-terminal-text-secondary">
                          {seg.startDate} ~ {seg.endDate}
                        </td>
                        <td className="px-3 py-2 text-right text-color-terminal-text-secondary font-mono">
                          {seg.rowCount.toLocaleString(getIntlLocale())}
                        </td>
                        <td className="px-3 py-2 text-right text-color-terminal-text-secondary">
                          {formatBytes(seg.fileSize)}
                        </td>
                        <td className="w-12 px-2 py-2 text-center">
                          <button
                            onClick={() => onDelete([seg.id])}
                            className="p-1 text-color-terminal-text-muted hover:text-red-400 transition-colors"
                            title={t('dataManagement.catalog.deleteSegment')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
