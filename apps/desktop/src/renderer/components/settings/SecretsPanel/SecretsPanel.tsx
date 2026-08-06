/**
 * SecretsPanel
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5). The single shared renderer for
 * `ProviderCredentialContribution` lists. Replaces (in later phases)
 * LLMSettingsPanel, back-test SecretsTab, BYOKSetupDialog body, and the
 * deleted CredentialSettings page.
 *
 * Per TICKET_809_1 section 12.3:
 * - `mode: 'page'`  rendered only by System Settings -> Config -> Credentials.
 * - `mode: 'modal'` rendered by in-context shortcuts (BYOKSetupDialog).
 *
 * The component owns no provider state itself -- it queries
 * `credentialRegistry` and renders one `ProviderCard` per filtered
 * contribution. Per-provider state (edit buffer, verify status, save
 * status) lives inside each card so cards do not block each other.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { credentialRegistry } from '../../../services/credential-registry';
import { ProviderCard } from './ProviderCard';
import { applyFilter, resolveShowAuditLog, resolveShowSecurityStatus } from './helpers';
import { SecurityStatusBanner } from './SecurityStatusBanner';
import { AuditLogPanel } from './AuditLogPanel';
import type { SecretsPanelProps } from './types';

export function SecretsPanel(props: SecretsPanelProps): JSX.Element {
  const { mode, filter, headingKey, onProviderConfigured } = props;
  const { t } = useTranslation('settings');

  // Snapshot of registry contributions, refreshed on registry change events.
  const [contributions, setContributions] = useState(() => credentialRegistry.getAll());
  useEffect(() => {
    const unsubscribe = credentialRegistry.subscribe(() => {
      setContributions(credentialRegistry.getAll());
    });
    return unsubscribe;
  }, []);

  const filtered = useMemo(() => applyFilter(contributions, filter), [contributions, filter]);
  const showAuditLog = resolveShowAuditLog(props);
  const showSecurityStatus = resolveShowSecurityStatus(props);

  const heading = headingKey
    ? t(headingKey, { defaultValue: '' })
    : mode === 'page'
      ? t('secretsPanel.title', { defaultValue: 'Credentials' })
      : '';

  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        mode === 'page' && 'p-6 h-full overflow-y-auto',
        mode === 'modal' && 'p-4',
      )}
    >
      {heading ? (
        <header>
          <h2 className="font-mono text-[14px] font-semibold uppercase tracking-widest text-color-terminal-text">
            {heading}
          </h2>
        </header>
      ) : null}

      {showSecurityStatus ? <SecurityStatusBanner /> : null}

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map(contribution => (
            <ProviderCard
              key={contribution.providerId}
              contribution={contribution}
              onConfigured={() => onProviderConfigured?.(contribution.providerId)}
            />
          ))}
        </div>
      )}

      {showAuditLog ? <AuditLogPanel /> : null}
    </div>
  );
}

function EmptyState(): JSX.Element {
  const { t } = useTranslation('settings');
  return (
    <div
      className={cn(
        'rounded border border-dashed border-color-terminal-border',
        'p-8 text-center font-mono text-[12px] text-color-terminal-text-muted',
      )}
    >
      {t('secretsPanel.emptyState', {
        defaultValue: 'No providers registered.',
      })}
    </div>
  );
}
