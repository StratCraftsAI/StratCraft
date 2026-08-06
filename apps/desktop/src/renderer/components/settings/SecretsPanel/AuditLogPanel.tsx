/**
 * AuditLogPanel
 *
 * TICKET_809_1 Phase 6 (TICKET_809_6). Replaces the Phase 3 placeholder
 * audit-log section with a real renderer over
 * `window.electronAPI.credential.getAuditLog`.
 *
 * The audit log is bounded (last `MAX_AUDIT_ENTRIES`) and refreshed on
 * mount. There is no live tail -- users rarely need real-time visibility
 * into credential changes, and surface area for streaming would be
 * disproportionate. A manual "Refresh" button suffices.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { getIntlLocale } from '../../../../shared/utils/format-locale';

/** Cap on audit entries shown in the SecretsPanel slot. */
const MAX_AUDIT_ENTRIES = 50;

// Shape mirrors CredentialAuditEntry from the main-process credential service,
// transported verbatim via window.electronAPI.credential.getAuditLog.
interface AuditEntry {
  timestamp: number;
  operation: 'get' | 'set' | 'delete';
  pluginId: string;
  key: string;
  tier: number;
}

export function AuditLogPanel(): JSX.Element {
  const { t } = useTranslation('settings');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.credential.getAuditLog(undefined, MAX_AUDIT_ENTRIES);
      if (!res.success) {
        setError(res.errorMessage ?? t('secretsPanel.audit.loadFailed'));
        setEntries([]);
        return;
      }
      setEntries(res.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFormatter = new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  // Defensive guard at the IPC boundary: a malformed timestamp would otherwise
  // throw RangeError inside dateFormatter.format() and crash the panel.
  // Root cause (schema drift between service / preload / renderer) is fixed
  // separately; this is the safety net for any future drift.
  const formatTimestamp = (ts: number): string => {
    if (!Number.isFinite(ts) || ts <= 0) return '--';
    return dateFormatter.format(new Date(ts));
  };

  return (
    <section
      className={cn(
        'rounded border border-color-terminal-border bg-color-terminal-panel',
        'p-3',
      )}
      aria-label={t('secretsPanel.audit.title', { defaultValue: 'Credential audit log' })}
    >
      <header className="flex items-center justify-between mb-2">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-color-terminal-text">
          {t('secretsPanel.audit.title', { defaultValue: 'Credential audit log' })}
        </h4>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded',
            'font-mono text-[10px] uppercase tracking-wider',
            'text-color-terminal-text-muted hover:text-color-terminal-text',
            'transition-colors duration-150',
            loading && 'opacity-60 cursor-not-allowed',
          )}
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          {t('secretsPanel.audit.refresh', { defaultValue: 'Refresh' })}
        </button>
      </header>

      {error ? (
        <p className="font-mono text-[11px] text-color-terminal-accent-red">{error}</p>
      ) : loading ? (
        <p className="font-mono text-[11px] text-color-terminal-text-muted">
          {t('secretsPanel.audit.loading', { defaultValue: 'Loading...' })}
        </p>
      ) : entries.length === 0 ? (
        <p className="font-mono text-[11px] text-color-terminal-text-muted">
          {t('secretsPanel.audit.empty', {
            defaultValue: 'No credential operations recorded yet.',
          })}
        </p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {entries.map((entry, idx) => (
            <li
              key={`${entry.timestamp}-${idx}`}
              className={cn(
                'grid grid-cols-[auto_auto_1fr] gap-3 items-baseline',
                'font-mono text-[10px]',
              )}
            >
              <span className="text-color-terminal-text-muted whitespace-nowrap">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span className="font-semibold uppercase tracking-wider text-color-terminal-accent-primary">
                {entry.operation}
              </span>
              <span className="text-color-terminal-text truncate">
                {entry.pluginId} / {entry.key}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
