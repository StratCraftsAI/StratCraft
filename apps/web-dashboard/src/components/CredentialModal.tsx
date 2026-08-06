import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GuideLlmSettingsProvider,
  SetLlmCredentialResult,
  SecureStoreLifecycleStatus,
} from '@StratCraft/types'
import { callTool, McpToolError } from '../mcp-client.ts'
import { confirmResetUnreadableCredentials } from '../credential-store-lifecycle-actions.ts'
import { useGuideToolbar } from '../guide-toolbar-context.tsx'

interface Props {
  providerId: string
  onClose: () => void
}

const PRIMARY_FIELD = 'primary'

function stripZeroWidth(value: string): string {
  return value.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim()
}

export function CredentialModal({ providerId, onClose }: Props) {
  const { t } = useTranslation('dashboard')
  const { refresh: refreshToolbar, selectLlm } = useGuideToolbar()

  const [provider, setProvider] = useState<GuideLlmSettingsProvider | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [values, setValues] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [recoveryKind, setRecoveryKind] = useState<'reset' | 'replace'>('reset')
  const [recoveryConfirm, setRecoveryConfirm] = useState(false)
  const [recovering, setRecovering] = useState(false)

  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await callTool('get_guide_llm_settings') as {
          providers: GuideLlmSettingsProvider[]
        }
        if (cancelled) return
        const match = result?.providers?.find(p => p.id === providerId)
        if (!match) {
          setLoadError(t('credentialModal.providerNotFound'))
          return
        }
        setProvider(match)
      } catch (err) {
        if (cancelled) return
        setLoadError(
          err instanceof McpToolError && err.errorCode
            ? t(`toolbar.errors.${err.errorCode}`, { defaultValue: err.message })
            : err instanceof Error ? err.message : String(err),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [providerId, t])

  useEffect(() => {
    if (!loading && provider && inputRef.current) {
      inputRef.current.focus()
    }
  }, [loading, provider])

  const fields = provider
    ? [
        { key: PRIMARY_FIELD, ...provider.credential },
        ...(provider.credential.extraFields ?? []),
      ]
    : []

  const validate = useCallback(
    (key: string, value: string) => {
      const field =
        key === PRIMARY_FIELD
          ? provider?.credential
          : provider?.credential.extraFields?.find(f => f.key === key)
      if (!field) return null
      const trimmed = value.trim()
      if (!trimmed) return field.required ? t('settings.llmCredEmpty') : null
      if (field.pattern && !new RegExp(field.pattern).test(trimmed)) {
        return t('settings.llmCredPatternMismatch')
      }
      return null
    },
    [provider, t],
  )

  const allValid = fields.every(field => {
    const value = values[field.key] ?? ''
    return validate(field.key, value) === null
  })
  const hasPrimaryValue = (values[PRIMARY_FIELD] ?? '').trim().length > 0

  const handleSave = useCallback(async () => {
    if (!provider || saving) return
    setSaving(true)
    setSaveError(null)
    setRecoveryAvailable(false)
    try {
      const apiKey = stripZeroWidth(values[PRIMARY_FIELD] ?? '')
      const extraCredentials: Record<string, string> = {}
      for (const field of provider.credential.extraFields ?? []) {
        extraCredentials[field.key] = stripZeroWidth(values[field.key] ?? '')
      }
      const result = await callTool('set_llm_credential', {
        provider: provider.id,
        api_key: apiKey,
        extra_credentials: extraCredentials,
      }) as SetLlmCredentialResult
      if (
        !result?.success
        || result.providerId !== provider.id
        || !Array.isArray(result.models)
      ) {
        throw new Error(t('credentialModal.invalidResponse'))
      }
      await refreshToolbar()
      const modelId = result.models.some(model => model.id === provider.recommendedModelId)
        ? provider.recommendedModelId
        : result.models[0]?.id
      if (!modelId) {
        throw new Error(t('credentialModal.noModels'))
      }
      if (!(await selectLlm(provider.id, modelId))) {
        throw new Error(t('credentialModal.selectionFailed'))
      }
      onClose()
    } catch (err) {
      setSaveError(
        err instanceof McpToolError && err.errorCode
          ? t(`settings.llmErrors.${err.errorCode}`, { defaultValue: err.message })
          : err instanceof Error ? err.message : String(err),
      )
      if (err instanceof McpToolError && (
        err.errorCode === 'SECURE_STORE_CREDENTIAL_AUTH_FAILED'
        || err.errorCode === 'SECURE_STORE_CREDENTIAL_CORRUPT'
      )) {
        setRecoveryKind('replace')
        setRecoveryAvailable(true)
        return
      }
      try {
        const lifecycle = await callTool('get_credential_store_lifecycle') as SecureStoreLifecycleStatus
        setRecoveryKind('reset')
        setRecoveryAvailable(lifecycle.capabilities.resetUnreadableCredentials)
      } catch {
        // Preserve the primary typed write error. Lifecycle discovery is an
        // optional secondary action and must not conceal that failure.
        setRecoveryAvailable(false)
      }
    } finally {
      setSaving(false)
    }
  }, [provider, values, saving, refreshToolbar, selectLlm, onClose, t])

  const handleRecovery = useCallback(async () => {
    if (!recoveryConfirm || recovering) return
    setRecovering(true)
    setSaveError(null)
    try {
      if (recoveryKind === 'replace' && provider) {
        const extraCredentials: Record<string, string> = {}
        for (const field of provider.credential.extraFields ?? []) {
          extraCredentials[field.key] = stripZeroWidth(values[field.key] ?? '')
        }
        await callTool('replace_unreadable_llm_credential', {
          provider: provider.id,
          api_key: stripZeroWidth(values[PRIMARY_FIELD] ?? ''),
          extra_credentials: extraCredentials,
          confirm: true,
        })
      } else {
        await confirmResetUnreadableCredentials()
      }
      setRecoveryAvailable(false)
      setRecoveryConfirm(false)
      await refreshToolbar()
      if (recoveryKind === 'replace') onClose()
    } catch (err) {
      setSaveError(
        err instanceof McpToolError && err.errorCode
          ? t(`settings.llmErrors.${err.errorCode}`, { defaultValue: err.message })
          : err instanceof Error ? err.message : String(err),
      )
    } finally {
      setRecovering(false)
    }
  }, [onClose, provider, recovering, recoveryConfirm, recoveryKind, refreshToolbar, t, values])

  const handleDelete = useCallback(async () => {
    if (!provider || deleting) return
    setDeleting(true)
    setSaveError(null)
    try {
      await callTool('delete_llm_credential', { provider: provider.id, confirm: true })
      setValues({})
      setDeleteConfirm(false)
      await refreshToolbar()
      onClose()
    } catch (err) {
      setSaveError(
        err instanceof McpToolError && err.errorCode
          ? t(`settings.llmErrors.${err.errorCode}`, { defaultValue: err.message })
          : err instanceof Error ? err.message : String(err),
      )
    } finally {
      setDeleting(false)
    }
  }, [provider, deleting, refreshToolbar, onClose, t])

  const toggleReveal = (key: string) => {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="modal-scrim" onClick={onClose} data-testid="credential-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('credentialModal.title', {
          provider: provider?.name ?? providerId,
        })}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 24,
          maxWidth: 480,
          width: '92%',
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
          {t('credentialModal.title', {
            provider: provider?.name ?? providerId,
          })}
        </h3>

        {loading && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('settings.loading')}
          </p>
        )}

        {loadError && (
          <p style={{ fontSize: 12, color: 'var(--red)' }}>{loadError}</p>
        )}

        {provider && !loading && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>{provider.name}</strong>
              {provider.configured ? (
                <span className="tag-mono" style={{ color: 'var(--green)' }}>
                  {t('settings.llmCredConfigured')}
                </span>
              ) : (
                <span className="tag-mono" style={{ color: 'var(--text-muted)' }}>
                  {t('settings.llmCredNotConfigured')}
                </span>
              )}
              {provider.credential.signupUrl && (
                <a
                  href={provider.credential.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11,
                    color: 'var(--accent)',
                    marginLeft: 'auto',
                  }}
                >
                  {t('settings.llmCredGetKey')}
                </a>
              )}
            </div>

            {fields.map((field, idx) => {
              const value = values[field.key] ?? ''
              const error = value ? validate(field.key, value) : null
              const isSecret = field.inputType === 'password'
              const key = `${provider.id}:${field.key}`
              return (
                <label
                  key={field.key}
                  className="llm-settings-field"
                  style={{ marginBottom: 10 }}
                >
                  <span>
                    {t(
                      field.key === PRIMARY_FIELD
                        ? `settings.llmField.${field.kind}`
                        : 'settings.llmField.baseUrl',
                    )}
                  </span>
                  <span className="llm-settings-field-control">
                    <input
                      ref={idx === 0 ? inputRef : undefined}
                      type={
                        isSecret && !revealed.has(key)
                          ? 'password'
                          : field.inputType
                      }
                      value={value}
                      onChange={e =>
                        setValues(prev => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                      onPaste={e => {
                        if (isSecret) {
                          e.preventDefault()
                          const pasted = stripZeroWidth(
                            e.clipboardData.getData('text'),
                          )
                          setValues(prev => ({
                            ...prev,
                            [field.key]: pasted,
                          }))
                        }
                      }}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={saving || deleting}
                      data-testid={`credential-modal-input-${field.key}`}
                    />
                    {isSecret && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => toggleReveal(key)}
                        aria-label={t(
                          revealed.has(key)
                            ? 'settings.llmHideValue'
                            : 'settings.llmShowValue',
                        )}
                      >
                        {t(
                          revealed.has(key)
                            ? 'settings.llmHide'
                            : 'settings.llmShow',
                        )}
                      </button>
                    )}
                  </span>
                  {error && (
                    <span
                      className="llm-settings-error"
                      role="alert"
                      style={{ marginTop: 2 }}
                    >
                      {error}
                    </span>
                  )}
                </label>
              )
            })}

            {saveError && (
              <p
                style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}
                role="alert"
                data-testid="credential-modal-error"
              >
                {saveError}
              </p>
            )}

            {recoveryAvailable && !recoveryConfirm && (
              <button className="btn ghost" onClick={() => setRecoveryConfirm(true)}>
                {t('credentialModal.recoveryAction')}
              </button>
            )}
            {recoveryAvailable && recoveryConfirm && (
              <div role="group" aria-label={t(recoveryKind === 'replace' ? 'credentialModal.replaceConfirm' : 'credentialModal.recoveryConfirm')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--red)' }}>{t(recoveryKind === 'replace' ? 'credentialModal.replaceConfirm' : 'credentialModal.recoveryConfirm')}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn solid" disabled={recovering} onClick={() => void handleRecovery()}>
                    {recovering ? t('settings.saving') : t(recoveryKind === 'replace' ? 'credentialModal.replaceConfirmButton' : 'credentialModal.recoveryConfirmButton')}
                  </button>
                  <button className="btn ghost" disabled={recovering} onClick={() => setRecoveryConfirm(false)}>
                    {t('settings.cancel')}
                  </button>
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 16,
              }}
            >
              {provider.configured && !deleteConfirm && (
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => setDeleteConfirm(true)}
                  disabled={saving || deleting}
                  data-testid="credential-modal-delete"
                >
                  {t('settings.llmDelete')}
                </button>
              )}
              {deleteConfirm && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                    {t('settings.llmDeleteConfirm')}
                  </span>
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    data-testid="credential-modal-delete-confirm"
                  >
                    {deleting ? t('settings.deleting') : t('settings.confirmDelete')}
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    {t('settings.cancel')}
                  </button>
                </>
              )}
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn ghost"
                onClick={onClose}
                disabled={saving || deleting}
              >
                {t('settings.cancel')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleSave()}
                disabled={saving || !allValid || !hasPrimaryValue}
                data-testid="credential-modal-save"
              >
                {saving
                  ? t('settings.saving')
                  : t('settings.llmValidateSave')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
