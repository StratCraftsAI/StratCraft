/**
 * DataSourceSelectField Component
 *
 * PLUGIN_TICKET_018: Extracted from back-test-nexus BacktestDataConfigPanel.
 * TICKET_332: Custom dropdown with LatencyDot per option for provider connection status.
 *
 * Tier 0 shared component consumed by both back-test-nexus and quant-lab-nexus.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn } from 'lucide-react';
import type { DataSourceOption, DataSourceRegion } from '../types/data-source';
import { REGION_DISPLAY_ORDER, REGION_LABEL_KEYS } from '../constants';
import { SEMANTIC_COLORS, THEME_COLORS } from '@shared/constants/colors';

// =============================================================================
// Utility: cn (minimal classname merger)
// =============================================================================

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// =============================================================================
// TICKET_332: LatencyDot - colored indicator for provider connection status
// =============================================================================

interface LatencyDotProps {
  status: DataSourceOption['status'];
  latencyMs?: number;
}

const LatencyDot: React.FC<LatencyDotProps> = ({ status, latencyMs }) => {
  const { t } = useTranslation('ui');
  let color: string;
  let pulse = false;
  let tooltip: string;

  if (status === 'checking') {
    color = THEME_COLORS.GRAY_500; // gray
    pulse = true;
    tooltip = t('status.checking');
  } else if (status === 'not-configured') {
    // TICKET_588: Amber dot for missing credentials (distinct from red connection failure)
    color = SEMANTIC_COLORS.WARNING; // amber
    tooltip = t('status.notConfigured');
  } else if (status === 'disconnected' || status === 'error') {
    color = SEMANTIC_COLORS.ERROR; // red
    tooltip = status === 'error' ? t('status.error') : t('status.disconnected');
  } else if (latencyMs !== undefined) {
    if (latencyMs < 1000) {
      color = SEMANTIC_COLORS.SUCCESS; // green - healthy for remote API
    } else if (latencyMs < 3000) {
      color = SEMANTIC_COLORS.WARNING; // amber - slow but connected
    } else {
      color = SEMANTIC_COLORS.WARNING_ORANGE; // orange - very slow (distinct from disconnected red)
    }
    tooltip = `${latencyMs}ms`;
  } else {
    color = SEMANTIC_COLORS.SUCCESS; // green default for connected without latency
    tooltip = t('status.connected');
  }

  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full', pulse && 'animate-pulse')}
      style={{ backgroundColor: color }}
      title={tooltip}
    />
  );
};

// =============================================================================
// DataSourceSelectField
// =============================================================================

export interface DataSourceSelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  dataSources: DataSourceOption[];
  isAuthenticated: boolean;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export const DataSourceSelectField: React.FC<DataSourceSelectFieldProps> = ({
  label,
  value,
  onChange,
  dataSources,
  isAuthenticated,
  error,
  disabled,
  className,
}) => {
  const { t } = useTranslation('ui');
  const { t: tData } = useTranslation('data');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = dataSources.find(ds => ds.id === value);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [open]);

  // TICKET_588: 'not-configured' providers disabled with amber dot (distinct from red)
  const isOptionDisabled = (ds: DataSourceOption) =>
    ds.status === 'checking' || ds.status === 'disconnected' || ds.status === 'error' || ds.status === 'not-configured' || (ds.requiresAuth && !isAuthenticated);

  const groupedSources = useMemo(() => {
    const hasRegions = dataSources.some(ds => ds.region);
    if (!hasRegions) {
      return [{ region: undefined as DataSourceRegion | undefined, label: undefined as string | undefined, items: dataSources }];
    }
    const byRegion = new Map<DataSourceRegion | undefined, DataSourceOption[]>();
    for (const ds of dataSources) {
      const key = ds.region;
      const arr = byRegion.get(key);
      if (arr) arr.push(ds);
      else byRegion.set(key, [ds]);
    }
    const result: Array<{ region: DataSourceRegion | undefined; label: string | undefined; items: DataSourceOption[] }> = [];
    for (const region of REGION_DISPLAY_ORDER) {
      const items = byRegion.get(region);
      if (items) result.push({ region, label: REGION_LABEL_KEYS[region], items });
    }
    const ungrouped = byRegion.get(undefined);
    if (ungrouped) result.push({ region: undefined, label: undefined, items: ungrouped });
    return result;
  }, [dataSources]);

  return (
    <div ref={containerRef} className={cn('flex flex-col gap-1 relative', className)}>
      <label className="text-[10px] uppercase tracking-wider text-color-terminal-text-muted terminal-mono">
        {label}
      </label>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(prev => !prev)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'h-9 px-3 rounded border text-sm terminal-mono text-left w-full',
          'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary focus:border-color-terminal-accent-primary',
          'transition-colors',
          error && 'border-red-500',
          disabled && 'opacity-50 cursor-not-allowed',
          !error && 'border-color-terminal-border'
        )}
        style={{
          backgroundColor: THEME_COLORS.INPUT_BG,
          borderColor: error ? SEMANTIC_COLORS.ERROR : THEME_COLORS.INPUT_BORDER,
          color: THEME_COLORS.INPUT_TEXT,
        }}
      >
        <span className="flex items-center gap-2">
          <span className="truncate">{selected?.name || value}</span>
          {selected && (
            <>
              {selected.requiresAuth && !isAuthenticated && (
                <span title={t('auth.loginRequired')}><LogIn className="w-3 h-3 flex-shrink-0" style={{ color: SEMANTIC_COLORS.WARNING }} /></span>
              )}
              <LatencyDot status={selected.status} latencyMs={selected.latencyMs} />
            </>
          )}
        </span>
      </button>
      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          className="absolute mt-1 z-10 rounded border shadow-lg overflow-hidden"
          style={{
            backgroundColor: THEME_COLORS.INPUT_BG,
            borderColor: THEME_COLORS.INPUT_BORDER,
            top: '100%',
            left: 0,
            right: 0,
          }}
        >
          {groupedSources.map(({ region, label, items }, gi) => (
            <React.Fragment key={region ?? 'ungrouped'}>
              {label && (
                <>
                  {gi > 0 && <div style={{ height: 1, backgroundColor: THEME_COLORS.INPUT_BORDER }} />}
                  <div
                    className="px-3 py-1 text-[10px] uppercase tracking-wider terminal-mono"
                    style={{ color: THEME_COLORS.SECTION_LABEL_TEXT }}
                  >
                    {tData(label)}
                  </div>
                </>
              )}
              {items.map(ds => {
                const optDisabled = isOptionDisabled(ds);
                return (
                  <button
                    key={ds.id}
                    type="button"
                    disabled={optDisabled}
                    onClick={() => {
                      if (!optDisabled) {
                        onChange(ds.id);
                        setOpen(false);
                      }
                    }}
                    className="w-full px-3 py-2 text-left text-sm terminal-mono flex items-center justify-between transition-colors"
                    style={{
                      color: optDisabled ? THEME_COLORS.GRAY_500 : THEME_COLORS.INPUT_TEXT,
                      backgroundColor: ds.id === value ? 'rgba(100, 255, 218, 0.15)' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!optDisabled) (e.currentTarget.style.backgroundColor = 'rgba(100, 255, 218, 0.1)');
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = ds.id === value ? 'rgba(100, 255, 218, 0.15)' : '';
                    }}
                  >
                    <span>{ds.name}</span>
                    <span className="flex items-center gap-1.5">
                      {ds.requiresAuth && !isAuthenticated && (
                        <span title={t('auth.loginRequired')}><LogIn className="w-3 h-3 flex-shrink-0" style={{ color: SEMANTIC_COLORS.WARNING }} /></span>
                      )}
                      <LatencyDot status={ds.status} latencyMs={ds.latencyMs} />
                    </span>
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
      {error && (
        <span className="text-[10px] text-red-500 terminal-mono">{error}</span>
      )}
    </div>
  );
};
