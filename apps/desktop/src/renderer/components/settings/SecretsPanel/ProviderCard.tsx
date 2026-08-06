/**
 * ProviderCard
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5). One card per
 * `ProviderCredentialContribution`. Owns the in-memory edit buffer for
 * its provider's fields, validates patterns on change, runs the verifier
 * on demand, and persists via `window.electronAPI.credential.*` on save.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Save, Trash2 } from 'lucide-react';
import type { CredentialHealth } from '@StratCraft/types';

import { cn } from '../../../lib/utils';
import type {
  CredentialVerifyResult,
  ProviderCredentialContribution,
} from '../../../../shared/types/credential-contribution';
import { ApiKeyInput } from './ApiKeyInput';
import { VerifyButton, type VerifyButtonStatus } from './VerifyButton';
import { LinoModelManager } from './LinoModelManager';
import {
  diffChangedFields,
  diffClearedFields,
  isProviderFullyConfigured,
  validateFieldPatterns,
} from './helpers';

export interface ProviderCardProps {
  contribution: ProviderCredentialContribution;
  /** Called after the user successfully saves (and verifies, if applicable). */
  onConfigured?: () => void;
}

interface PersistedSnapshot {
  /** Last known persisted values for each field, keyed by field.key. */
  values: Record<string, string>;
  /** Whether the user successfully verified the current snapshot. */
  verified: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function ProviderCard({ contribution, onConfigured }: ProviderCardProps): JSX.Element {
  const { t } = useTranslation('settings');

  // Edit buffer (uncommitted user input).
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Persisted snapshot mirrored from the credential store.
  const [persisted, setPersisted] = useState<PersistedSnapshot>({ values: {}, verified: false });
  // Whether we have completed the initial load from the store.
  const [loaded, setLoaded] = useState(false);
  // Loading/save/verify status.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [verifyStatus, setVerifyStatus] = useState<VerifyButtonStatus>('idle');
  const [verifyMessage, setVerifyMessage] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [recoveryConfirm, setRecoveryConfirm] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [storageHealthByKey, setStorageHealthByKey] = useState<Record<
    string,
    Exclude<CredentialHealth, { state: 'usable' | 'missing' }>
  >>({});
  const [replacementConfirm, setReplacementConfirm] = useState(false);

  // mountedRef must be re-set to true on every mount, NOT only initialized.
  // Under React.StrictMode (dev), every component is mounted -> unmounted ->
  // mounted again to surface effect-cleanup bugs. useRef persists across
  // that cycle, so if we only set current=false in the cleanup, the second
  // mount sees current=false forever and every async result is silently
  // dropped (post-TICKET_809 OpenAI Test stuck-on-testing root cause).
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // -------------------------------------------------------------------------
  // TICKET_811: persisted "Default for <domain>" radio state.
  // Only contributions carrying `byokDefaultDomain` render this control.
  // The store value is read once on mount + after any `nexus:credential-
  // changed` event so a sibling card's save/delete keeps the radio
  // group consistent.
  // -------------------------------------------------------------------------
  const [domainDefault, setDomainDefault] = useState<string | null>(null);
  useEffect(() => {
    if (!contribution.byokDefaultDomain) return;
    const domain = contribution.byokDefaultDomain;
    let cancelled = false;
    const api = window.electronAPI.dataProviderDefaults;
    const refresh = () => {
      if (!api?.get) return;
      api.get().then(prefs => {
        if (cancelled) return;
        const val = typeof prefs?.[domain] === 'string' ? (prefs[domain] as string) : null;
        setDomainDefault(val);
      });
    };
    refresh();
    const unsubscribeDefaults = api.onChanged?.((prefs) => {
      if (cancelled) return;
      const value = typeof prefs?.[domain] === 'string' ? prefs[domain] : null;
      setDomainDefault(value);
    });
    // Refresh on credential change too -- sibling card flips affect
    // the radio's "is one of the others ticked?" rendering. The hook
    // listens to the same event; doing the same here keeps the
    // Settings UI consistent without a custom channel.
    const onCredChanged = () => refresh();
    window.addEventListener('nexus:credential-changed', onCredChanged);
    return () => {
      cancelled = true;
      unsubscribeDefaults?.();
      window.removeEventListener('nexus:credential-changed', onCredChanged);
    };
  }, [contribution.byokDefaultDomain]);

  const handleDefaultRadioChange = useCallback(async () => {
    if (!contribution.byokDefaultDomain) return;
    const domain = contribution.byokDefaultDomain;
    const api = window.electronAPI.dataProviderDefaults;
    if (!api?.set) return;
    // Optimistic update -- the local radio flips immediately; the IPC
    // is the source of truth and will overwrite on the next refresh
    // if it disagrees (e.g. on validation error).
    setDomainDefault(contribution.providerId);
    try {
      const res = await api.set(domain, contribution.providerId);
      if (!('ok' in res) || res.ok !== true) {
        // Validation error -- roll back the optimistic update. The
        // service rejects only when the domain or providerId is not
        // in the allowlist, which would mean a programming error,
        // not a user-recoverable state.
        setDomainDefault(prev => (prev === contribution.providerId ? null : prev));
      }
    } catch {
      setDomainDefault(prev => (prev === contribution.providerId ? null : prev));
    }
  }, [contribution.byokDefaultDomain, contribution.providerId]);

  // -------------------------------------------------------------------------
  // Initial load: pull persisted values via credential.get
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next: Record<string, string> = {};
      const nextHealth: Record<
        string,
        Exclude<CredentialHealth, { state: 'usable' | 'missing' }>
      > = {};
      for (const field of contribution.fields) {
        try {
          const res = await window.electronAPI.credential.get(contribution.pluginId, field.key);
          if (res.success && res.value) {
            next[field.key] = res.value;
          } else if (res.health && res.health.state !== 'usable'
            && res.health.state !== 'missing') {
            nextHealth[field.key] = res.health;
          }
        } catch {
          nextHealth[field.key] = { state: 'credential_corrupt' };
        }
      }
      if (cancelled) return;
      setPersisted({ values: next, verified: false });
      setDraft(next);
      setStorageHealthByKey(nextHealth);
      setLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [contribution.pluginId, contribution.fields]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const patternErrors = useMemo(
    () => validateFieldPatterns(contribution, draft),
    [contribution, draft],
  );
  const hasPatternErrors = Object.keys(patternErrors).length > 0;
  const fullyConfigured = useMemo(
    () => isProviderFullyConfigured(contribution, draft),
    [contribution, draft],
  );

  const dirty = useMemo(() => {
    const changed = diffChangedFields(persisted.values, draft);
    if (Object.keys(changed).length > 0) return true;
    const cleared = diffClearedFields(contribution, persisted.values, draft);
    return cleared.length > 0;
  }, [contribution, persisted, draft]);

  const storageHealth = Object.values(storageHealthByKey)[0];
  const hasStorageError = storageHealth !== undefined;
  const canExplicitlyReplace = hasStorageError
    && Object.values(storageHealthByKey).every(health =>
      health.state === 'credential_auth_failed' || health.state === 'credential_corrupt');

  const canSave = loaded && (!hasStorageError || (canExplicitlyReplace && verifyStatus === 'success'))
    && !contribution.readOnly && dirty && !hasPatternErrors && fullyConfigured;
  const canVerify =
    loaded && (!hasStorageError || canExplicitlyReplace) && !contribution.readOnly
    && contribution.verify !== undefined && fullyConfigured && !hasPatternErrors;
  const canDelete =
    loaded && !hasStorageError && !contribution.readOnly
    && Object.keys(persisted.values).some(k => persisted.values[k]);

  // Reset verify status when the draft changes (the previous verify result
  // no longer applies to the new values).
  useEffect(() => {
    if (verifyStatus !== 'idle') {
      setVerifyStatus('idle');
      setVerifyMessage(undefined);
    }
    // Intentionally do not depend on verifyStatus to avoid a clear loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleFieldChange = useCallback(
    (key: string, value: string) => {
      setDraft(prev => ({ ...prev, [key]: value }));
      setSaveStatus('idle');
      setSaveError(undefined);
      setReplacementConfirm(false);
    },
    [],
  );

  const handleVerify = useCallback(async () => {
    if (!contribution.verify) return;
    setVerifyStatus('running');
    setVerifyMessage(undefined);
    let result: CredentialVerifyResult;
    try {
      result = await contribution.verify(draft);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!mountedRef.current) return;
    if (result.ok) {
      setVerifyStatus('success');
      setVerifyMessage(t('secretsPanel.verifySuccess', { defaultValue: 'Verified' }));
    } else {
      setVerifyStatus('error');
      setVerifyMessage(result.error ? t(result.error, { defaultValue: result.error }) : undefined);
    }
  }, [contribution, draft, t]);

  const handleSave = useCallback(async () => {
    if (hasStorageError && (!canExplicitlyReplace || verifyStatus !== 'success')) {
      setSaveError(t('secretsPanel.replacementRequiresVerification'));
      setReplacementConfirm(false);
      return;
    }
    setSaveStatus('saving');
    setSaveError(undefined);

    try {
      const changed = diffChangedFields(persisted.values, draft);
      for (const [key, value] of Object.entries(changed)) {
        const failedHealth = storageHealthByKey[key];
        const res = failedHealth
          ? await window.electronAPI.credential.replaceUnreadable(
            contribution.pluginId,
            key,
            value,
            failedHealth,
            true,
          )
          : await window.electronAPI.credential.set(contribution.pluginId, key, value);
        if (!res.success) {
          throw new Error(res.errorMessage ?? t('secretsPanel.failedToSaveKey', { key }));
        }
      }
      const cleared = diffClearedFields(contribution, persisted.values, draft);
      for (const key of cleared) {
        const res = await window.electronAPI.credential.delete(contribution.pluginId, key);
        if (!res.success) {
          throw new Error(res.errorMessage ?? t('secretsPanel.failedToClearKey', { key }));
        }
      }

      // Refresh persisted snapshot from the new draft.
      const nextPersisted: Record<string, string> = {};
      for (const field of contribution.fields) {
        const v = draft[field.key];
        if (v && v.trim() !== '') {
          nextPersisted[field.key] = v;
        }
      }
      setPersisted({ values: nextPersisted, verified: verifyStatus === 'success' });
      setStorageHealthByKey({});
      setReplacementConfirm(false);
      setSaveStatus('saved');

      // TICKET_811: broadcast that the stored credential set changed so
      // the Tool Sweep BYOK gate can re-derive `configured` without a
      // page reload. The plugin layer's `useConfiguredDataProviders`
      // hook subscribes to this event on `window`. Detail mirrors the
      // pluginId so future consumers can scope-filter; today the gate
      // recomputes the whole snapshot regardless.
      window.dispatchEvent(
        new CustomEvent('nexus:credential-changed', {
          detail: { pluginId: contribution.pluginId, providerId: contribution.providerId },
        }),
      );

      // Best-effort post-configure hook; failure is logged but does not
      // roll back the save.
      if (contribution.postConfigureHook) {
        try {
          await contribution.postConfigureHook();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[W:SETTINGS:POST_CONFIGURE_HOOK_FAILED] [SecretsPanel] postConfigureHook failed for ${contribution.providerId}:`,
            err,
          );
        }
      }

      onConfigured?.();
    } catch (err) {
      if (!mountedRef.current) return;
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [
    contribution,
    draft,
    persisted.values,
    storageHealthByKey,
    hasStorageError,
    canExplicitlyReplace,
    verifyStatus,
    onConfigured,
    t,
  ]);

  const handleDelete = useCallback(async () => {
    setSaveStatus('saving');
    setSaveError(undefined);
    try {
      for (const field of contribution.fields) {
        if (!persisted.values[field.key]) continue;
        const res = await window.electronAPI.credential.delete(
          contribution.pluginId,
          field.key,
        );
        if (!res.success) {
          throw new Error(res.errorMessage ?? t('secretsPanel.failedToDeleteKey', { key: field.key }));
        }
      }
      setPersisted({ values: {}, verified: false });
      setDraft({});
      setSaveStatus('saved');
      setVerifyStatus('idle');
      setVerifyMessage(undefined);

      // TICKET_811: same change-broadcast as the save path. A delete is
      // the live-deletion edge case in sec.6.5 of the ticket: any open Tool
      // Sweep page must re-evaluate its picker / chip state immediately.
      window.dispatchEvent(
        new CustomEvent('nexus:credential-changed', {
          detail: { pluginId: contribution.pluginId, providerId: contribution.providerId },
        }),
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [contribution, persisted.values]);

  const prepareRecovery = useCallback(async () => {
    setSaveError(undefined);
    try {
      const result = await window.electronAPI.credential.lifecycleStatus();
      if (!result.success || !result.status?.capabilities.resetUnreadableCredentials) {
        setSaveError(result.errorMessage ?? t('secretsPanel.recoveryUnavailable'));
        return;
      }
      setRecoveryConfirm(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  const handleRecovery = useCallback(async () => {
    if (!recoveryConfirm || recovering) return;
    setRecovering(true);
    setSaveError(undefined);
    try {
      const result = await window.electronAPI.credential.resetUnreadable(true);
      if (!result.success) {
        throw new Error(result.errorMessage ?? t('secretsPanel.recoveryFailed'));
      }
      setStorageHealthByKey({});
      setPersisted({ values: {}, verified: false });
      setRecoveryConfirm(false);
      window.dispatchEvent(new CustomEvent('nexus:credential-changed', {
        detail: { pluginId: contribution.pluginId, providerId: contribution.providerId },
      }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecovering(false);
    }
  }, [contribution.pluginId, contribution.providerId, recovering, recoveryConfirm, t]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const Icon = contribution.icon;
  const providerName = t(contribution.nameKey, { defaultValue: contribution.providerId });
  const configured = Object.keys(persisted.values).length > 0;

  return (
    <section
      className={cn(
        'rounded border border-color-terminal-border',
        'bg-color-terminal-surface',
        'p-4 flex flex-col gap-4',
      )}
      aria-labelledby={`provider-${contribution.providerId}-name`}
    >
      <header className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-color-terminal-accent-teal" />
        <h3
          id={`provider-${contribution.providerId}-name`}
          className="flex-1 font-mono text-[13px] font-semibold text-color-terminal-text"
        >
          {providerName}
        </h3>
        {storageHealth ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-color-terminal-accent-red">
            {t('secretsPanel.statusStorageError', { defaultValue: 'Storage error' })}
          </span>
        ) : configured ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-color-terminal-accent-green">
            {t('secretsPanel.statusConfigured', { defaultValue: 'Configured' })}
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-color-terminal-text-muted">
            {t('secretsPanel.statusUnconfigured', { defaultValue: 'Not configured' })}
          </span>
        )}
        {contribution.signupUrl ? (
          <a
            href={contribution.signupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded',
              'font-mono text-[10px] uppercase tracking-wider',
              'text-color-terminal-text-muted hover:text-color-terminal-accent-teal',
              'transition-colors duration-150',
            )}
          >
            <ExternalLink className="w-3 h-3" />
            {t('secretsPanel.getKey', { defaultValue: 'Get key' })}
          </a>
        ) : null}
      </header>

      {storageHealth ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="font-mono text-[11px] text-color-terminal-accent-red">
            {storageHealth.state === 'keyring_locked'
              ? t('secretsPanel.keyringLocked', { defaultValue: 'Unlock the system keyring, then retry.' })
              : storageHealth.state === 'keyring_unavailable'
                ? t('secretsPanel.keyringUnavailable', { defaultValue: 'The system credential service is unavailable. Restore the user session, then retry.' })
                : storageHealth.state === 'master_key_missing'
                  ? t('secretsPanel.masterKeyMissing', { defaultValue: 'The encryption key is missing. Restore a recovery bundle or explicitly replace the affected credential.' })
                  : t('secretsPanel.credentialRecoveryRequired', { defaultValue: 'Credential storage requires recovery. The saved ciphertext has been preserved.' })}
          </p>
          {!recoveryConfirm ? (
            <button type="button" className="btn sm ghost self-start" onClick={() => void prepareRecovery()}>
              {t('secretsPanel.recoveryAction')}
            </button>
          ) : (
            <div role="group" aria-label={t('secretsPanel.recoveryConfirm')} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-color-terminal-accent-red">{t('secretsPanel.recoveryConfirm')}</span>
              <button type="button" className="btn sm danger" disabled={recovering} onClick={() => void handleRecovery()}>
                {t('secretsPanel.recoveryConfirmButton')}
              </button>
              <button type="button" className="btn sm ghost" disabled={recovering} onClick={() => setRecoveryConfirm(false)}>
                {t('secretsPanel.cancel')}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {contribution.fields.map((field, idx) => (
          <ApiKeyInput
            key={field.key}
            field={field}
            value={draft[field.key] ?? ''}
            onChange={v => handleFieldChange(field.key, v)}
            error={patternErrors[field.key]}
            label={t(field.labelKey, { defaultValue: field.key })}
            placeholder={
              field.placeholderKey ? t(field.placeholderKey, { defaultValue: '' }) : undefined
            }
            disabled={(hasStorageError && !canExplicitlyReplace) || contribution.readOnly || saveStatus === 'saving'}
            autoFocus={idx === 0 && !configured}
          />
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-3">
        {contribution.verify ? (
          <VerifyButton
            status={verifyStatus}
            onClick={handleVerify}
            disabled={!canVerify}
            message={verifyMessage}
            label={t('secretsPanel.testButton', { defaultValue: 'Test' })}
          />
        ) : null}
        <div className="flex-1" />
        {canDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saveStatus === 'saving'}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border',
              'font-mono text-[11px] font-semibold uppercase tracking-wider',
              'border-color-terminal-accent-red/40 text-color-terminal-accent-red',
              'hover:bg-color-terminal-accent-red/10 transition-colors duration-150',
              saveStatus === 'saving' && 'opacity-60 cursor-not-allowed',
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('secretsPanel.deleteButton', { defaultValue: 'Delete' })}
          </button>
        ) : null}
        {replacementConfirm ? (
          <div role="group" aria-label={t('secretsPanel.replaceConfirm')} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-color-terminal-accent-red">
              {t('secretsPanel.replaceConfirm')}
            </span>
            <button type="button" className="btn sm danger" disabled={!canSave} onClick={() => void handleSave()}>
              {t('secretsPanel.replaceConfirmButton')}
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setReplacementConfirm(false)}>
              {t('secretsPanel.cancel')}
            </button>
          </div>
        ) : <button
          type="button"
          onClick={() => {
            if (canExplicitlyReplace) setReplacementConfirm(true);
            else void handleSave();
          }}
          disabled={!canSave || saveStatus === 'saving'}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border',
            'font-mono text-[11px] font-semibold uppercase tracking-wider',
            'border-color-terminal-accent-teal text-color-terminal-accent-teal',
            'hover:bg-color-terminal-accent-teal/10 transition-colors duration-150',
            (!canSave || saveStatus === 'saving') && 'opacity-60 cursor-not-allowed',
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {saveStatus === 'saved' && !dirty
            ? t('secretsPanel.savedButton', { defaultValue: 'Saved' })
            : t('secretsPanel.saveButton', { defaultValue: 'Save' })}
        </button>}
      </footer>

      {saveError ? (
        <p className="font-mono text-[11px] text-color-terminal-accent-red">{saveError}</p>
      ) : null}

      {contribution.providerId.toUpperCase() === 'LINO' && configured ? (
        <LinoModelManager />
      ) : null}

      {/* TICKET_811: "Default for US equity" radio. Renders only when
          the contribution opts in via `byokDefaultDomain`. The radio
          group across the three BYOK provider cards shares a single
          `name`, giving native single-select semantics. When the
          card has no saved credential, a yellow hint surfaces that
          the pointer will be ignored at run time (Tool Sweep gate
          will trip and re-open the picker per sec.6.5 stale-default
          flow). */}
      {contribution.byokDefaultDomain ? (
        <div className="flex flex-col gap-1">
          <label
            data-testid={`provider-default-radio-${contribution.providerId}`}
            className="flex items-center gap-2 font-mono text-[11px] text-color-terminal-text-muted cursor-pointer"
          >
            <input
              type="radio"
              name={`dp-default-${contribution.byokDefaultDomain}`}
              checked={domainDefault === contribution.providerId}
              onChange={handleDefaultRadioChange}
            />
            {t('secretsPanel.providers.common.defaultForUsEquity', {
              defaultValue: 'Default for US equity',
            })}
          </label>
          {domainDefault === contribution.providerId && !configured ? (
            <p className="font-mono text-[11px] text-color-terminal-accent-yellow">
              {t('secretsPanel.providers.common.defaultUnsavedHint', {
                defaultValue:
                  'Save a key first -- defaults pointing at unconfigured providers will be ignored at run time.',
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
