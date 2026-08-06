import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getDecisionTrustPolicy,
  writeDecisionTrustPolicy,
} from '../agent-control-client.ts'
import { useDecisionTrustPolicyStore } from '../decision-trust-policy-store.ts'

const TTL_OPTIONS = [
  { value: 60_000, label: '1 minute' },
  { value: 300_000, label: '5 minutes' },
  { value: 900_000, label: '15 minutes' },
  { value: 1_800_000, label: '30 minutes' },
  { value: 3_600_000, label: '1 hour' },
  { value: 7_200_000, label: '2 hours' },
] as const

export function DecisionTrustPolicySettings() {
  const { t } = useTranslation('dashboard')
  const {
    status,
    policy,
    eligibleOperations,
    invalidEntries,
    error,
    loadStarted,
    loaded,
    setLevel,
    setTtl,
    toggleOperation,
    saving,
    failed,
  } = useDecisionTrustPolicyStore()

  const load = useCallback(async () => {
    loadStarted()
    try {
      loaded(await getDecisionTrustPolicy())
    } catch (reason) {
      failed(reason instanceof Error ? reason.message : String(reason))
    }
  }, [loadStarted, loaded, failed])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    if (!policy) return
    saving()
    try {
      await writeDecisionTrustPolicy(policy)
      loaded(await getDecisionTrustPolicy())
    } catch (reason) {
      failed(reason instanceof Error ? reason.message : String(reason))
    }
  }, [policy, saving, loaded, failed])

  if (!policy) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {error
          ?? t('settings.trustPolicyLoading', { defaultValue: 'Loading decision trust policy...' })}
      </p>
    )
  }

  return (
    <div
      data-testid="decision-trust-policy-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {t('settings.trustPolicyDescription', {
          defaultValue:
            'Choose when repeated destructive operations may reuse a recent human approval. Every trust window still begins with WebAuthn.',
        })}
      </p>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <span>{t('settings.trustPolicyLevel', { defaultValue: 'Approval policy' })}</span>
        <select
          value={policy.level}
          onChange={(event) => setLevel(
            event.target.value as typeof policy.level,
          )}
          data-testid="decision-trust-policy-level"
        >
          <option value="ask-always">
            {t('settings.trustPolicyAskAlways', { defaultValue: 'Ask every time' })}
          </option>
          <option value="trust-session">
            {t('settings.trustPolicySession', { defaultValue: 'Trust same operation for this session' })}
          </option>
          <option value="auto-approve-allowlist">
            {t('settings.trustPolicyAllowlist', { defaultValue: 'Auto-approve allowlisted operations' })}
          </option>
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <span>{t('settings.trustPolicyTtl', { defaultValue: 'Trust window' })}</span>
        <select
          value={policy.trustWindowTtlMs}
          onChange={(event) => setTtl(Number(event.target.value))}
          data-testid="decision-trust-policy-ttl"
        >
          {TTL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      {policy.level === 'auto-approve-allowlist' && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, marginBottom: 8 }}>
            {t('settings.trustPolicyOperations', { defaultValue: 'Eligible operations' })}
          </legend>
          {eligibleOperations.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {t('settings.trustPolicyNoEligible', {
                defaultValue: 'No registered operation currently permits delegated approval.',
              })}
            </p>
          ) : eligibleOperations.map((operation) => (
            <label
              key={operation}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
            >
              <input
                type="checkbox"
                checked={policy.allowlist.includes(operation)}
                onChange={() => toggleOperation(operation)}
              />
              <code>{operation}</code>
            </label>
          ))}
        </fieldset>
      )}

      {invalidEntries.map((entry) => (
        <div key={`${entry.code}:${entry.operation ?? ''}`} role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>
          {entry.message}
        </div>
      ))}
      {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}

      <div>
        <button
          type="button"
          className="btn sm solid"
          onClick={() => void save()}
          disabled={status === 'saving'}
          data-testid="decision-trust-policy-save"
        >
          {status === 'saving'
            ? t('settings.saving')
            : t('settings.save')}
        </button>
      </div>
    </div>
  )
}
