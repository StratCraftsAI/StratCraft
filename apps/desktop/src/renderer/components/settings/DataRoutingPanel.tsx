/**
 * DataRoutingPanel - per-market provider preference settings.
 *
 * TICKET_927_2_2 section 5: one row per MarketId. Multi-provider rows
 * expose a reorderable list of candidate provider ids (up/down buttons --
 * keyboard-accessible alternative to drag-to-reorder). Single-provider
 * rows are read-only so the user sees the routing decision rather than
 * having to infer it from "no controls shown."
 *
 * Persistence flows through `window.electronAPI.dataRouting.*`, which
 * writes via `PluginConfigManager` and fires the
 * `data-routing:preference-changed` event consumed by readiness caches
 * (TICKET_927_2_4).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';

interface MarketRoutingRow {
  market: string;
  candidates: string[];
  preference: string[];
}

// =============================================================================
// Reordering helpers
// =============================================================================

/**
 * Returns the user-facing order for a row: preference entries first (in the
 * stored order, filtered to entries that are currently registered candidates),
 * then any remaining candidates in their registration-order position. This
 * mirrors `sortByPreference` in `provider-manager.ts` so the panel and the
 * runtime resolver agree on what the user sees.
 */
function effectiveOrder(row: MarketRoutingRow): string[] {
  const named = row.preference.filter(id => row.candidates.includes(id));
  const seen = new Set(named);
  const tail = row.candidates.filter(id => !seen.has(id));
  return [...named, ...tail];
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// =============================================================================
// Component
// =============================================================================

export function DataRoutingPanel(): JSX.Element {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<MarketRoutingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI.dataRouting.listMarkets();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onReorder = useCallback(
    async (market: string, nextOrder: string[]) => {
      setError(null);
      const res = await window.electronAPI.dataRouting.setMarketPreference(market, nextOrder);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Refresh from main so the displayed state matches what main has stored.
      await refresh();
    },
    [refresh],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {t('dataRouting.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('dataRouting.instructions')}
      </p>

      <div className="space-y-2">
        {rows.map(row => (
          <DataRoutingRow
            key={row.market}
            row={row}
            onReorder={nextOrder => onReorder(row.market, nextOrder)}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Row
// =============================================================================

interface DataRoutingRowProps {
  row: MarketRoutingRow;
  onReorder: (nextOrder: string[]) => void;
}

function DataRoutingRow({ row, onReorder }: DataRoutingRowProps): JSX.Element {
  const { t } = useTranslation('settings');
  const order = effectiveOrder(row);
  const multiProvider = row.candidates.length >= 2;
  const unsupported = row.candidates.length === 0;

  return (
    <div className="rounded border border-white/10 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-color-terminal-text-primary">
          {row.market}
        </span>
        {unsupported && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase text-amber-400">
            {t('dataRouting.noProvider')}
          </span>
        )}
        {!multiProvider && !unsupported && (
          <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
            {t('dataRouting.singleProvider')}
          </span>
        )}
      </div>

      {!unsupported && (
        <ol className="mt-2 space-y-1">
          {order.map((providerId, index) => (
            <li
              key={providerId}
              className="flex items-center gap-2 rounded bg-white/5 px-2 py-1 text-xs"
            >
              <span className="w-4 text-muted-foreground">{index + 1}.</span>
              <span className="flex-1 font-mono">{providerId}</span>
              {multiProvider && (
                <>
                  <button
                    type="button"
                    aria-label={t('config.dataRouting.moveUp', { provider: providerId })}
                    disabled={index === 0}
                    onClick={() => onReorder(move(order, index, index - 1))}
                    className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('config.dataRouting.moveDown', { provider: providerId })}
                    disabled={index === order.length - 1}
                    onClick={() => onReorder(move(order, index, index + 1))}
                    className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default DataRoutingPanel;
