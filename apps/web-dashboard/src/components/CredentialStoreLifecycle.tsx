import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SecureStoreLifecycleMutationResult,
  SecureStoreLifecycleStatus,
} from '@StratCraft/types'
import { callTool, McpToolError } from '../mcp-client.ts'
import { confirmResetUnreadableCredentials } from '../credential-store-lifecycle-actions.ts'

type Action = 'migrate' | 'rotate' | 'reset' | 'export' | 'import'

function localizeError(reason: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  return reason instanceof McpToolError && reason.errorCode
    ? t(`settings.llmErrors.${reason.errorCode}`, { defaultValue: reason.message })
    : reason instanceof Error ? reason.message : String(reason)
}

function downloadBundle(bundleBase64: string): void {
  const bytes = Uint8Array.from(atob(bundleBase64), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `stratcraft-secure-store-${new Date().toISOString().slice(0, 10)}.recovery`
  anchor.click()
  URL.revokeObjectURL(url)
  bytes.fill(0)
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('recovery_bundle_read_failed'))
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('recovery_bundle_read_failed'))
        return
      }
      const bytes = new Uint8Array(reader.result)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      resolve(btoa(binary))
      bytes.fill(0)
    }
    reader.readAsArrayBuffer(file)
  })
}

export function CredentialStoreLifecycle() {
  const { t } = useTranslation('dashboard')
  const [status, setStatus] = useState<SecureStoreLifecycleStatus | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportConfirmation, setExportConfirmation] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const importInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const result = await callTool('get_credential_store_lifecycle') as SecureStoreLifecycleStatus
    if (!result?.capabilities) throw new Error(t('settings.unexpectedResponse'))
    setStatus(result)
    setError(null)
  }, [t])

  useEffect(() => {
    void load().catch(reason => setError(localizeError(reason, t)))
  }, [load, t])

  const run = useCallback(async (
    action: Action,
    tool: string,
    args: Record<string, unknown> = {},
  ) => {
    setPending(action)
    setError(null)
    setNotice(null)
    try {
      const result = await callTool(tool, args) as SecureStoreLifecycleMutationResult
      if (!result?.success) throw new Error(result?.errorMessage ?? t('settings.lifecycle.operationFailed'))
      setNotice(t(`settings.lifecycle.${action}Complete`))
      await load()
      return result
    } catch (reason) {
      setError(localizeError(reason, t))
      return null
    } finally {
      setPending(null)
    }
  }, [load, t])

  const handleExport = useCallback(async () => {
    if (!exportPassphrase || exportPassphrase !== exportConfirmation) {
      setError(t('settings.lifecycle.passphraseMismatch'))
      return
    }
    setPending('export')
    setError(null)
    try {
      const result = await callTool('export_credential_recovery_bundle', {
        passphrase: exportPassphrase,
      }) as SecureStoreLifecycleMutationResult & { bundleBase64?: string }
      if (!result.success || !result.bundleBase64) {
        throw new Error(result.errorMessage ?? t('settings.lifecycle.operationFailed'))
      }
      downloadBundle(result.bundleBase64)
      setExportPassphrase('')
      setExportConfirmation('')
      setNotice(t('settings.lifecycle.exportComplete'))
    } catch (reason) {
      setError(localizeError(reason, t))
    } finally {
      setPending(null)
    }
  }, [exportConfirmation, exportPassphrase, t])

  const handleImport = useCallback(async (file: File) => {
    if (!importPassphrase) {
      setError(t('settings.lifecycle.passphraseRequired'))
      return
    }
    try {
      const bundleBase64 = await readFileBase64(file)
      const result = await run('import', 'import_credential_recovery_bundle', {
        bundle_base64: bundleBase64,
        passphrase: importPassphrase,
      })
      if (result) setImportPassphrase('')
    } catch (reason) {
      setError(localizeError(reason, t))
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }, [importPassphrase, run, t])

  return (
    <div className="llm-settings-provider" data-testid="credential-store-lifecycle">
      <div className="llm-settings-provider-head">
        <strong>{t('settings.lifecycle.title')}</strong>
        <button className="btn sm ghost" onClick={() => void load()} disabled={pending !== null}>
          {t('settings.lifecycle.refresh')}
        </button>
      </div>
      <p>{t('settings.lifecycle.description')}</p>

      {status && (
        <div className="llm-settings-model-list">
          <span className="tag-mono">{t('settings.lifecycle.mode')}: {t(`settings.lifecycle.modes.${status.mode}`)}</span>
          <span className="tag-mono">{t('settings.lifecycle.generation')}: {status.activeGeneration ?? '-'}</span>
          <span className="tag-mono">{t('settings.lifecycle.credentials')}: {status.credentialCount}</span>
          <span className="tag-mono">{t('settings.lifecycle.unreadable')}: {status.unreadableCredentialCount}</span>
        </div>
      )}
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      {notice && <p role="status" style={{ color: 'var(--green)' }}>{notice}</p>}

      {status && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <button className="btn sm ghost" disabled={!status.capabilities.migrateLegacy || pending !== null} onClick={() => void run('migrate', 'migrate_credential_store')}>
            {t('settings.lifecycle.migrate')}
          </button>
          <button className="btn sm ghost" disabled={!status.capabilities.rotateMasterKey || pending !== null} onClick={() => void run('rotate', 'rotate_credential_master_key')}>
            {t('settings.lifecycle.rotate')}
          </button>
          {status.capabilities.resetUnreadableCredentials && !resetConfirm && (
            <button className="btn sm ghost" disabled={pending !== null} onClick={() => setResetConfirm(true)}>
              {t('settings.lifecycle.resetUnreadable')}
            </button>
          )}
          {resetConfirm && (
            <div role="group" aria-label={t('settings.lifecycle.resetConfirm')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--red)', fontSize: 12 }}>{t('settings.lifecycle.resetConfirm')}</span>
              <button className="btn sm solid" disabled={pending !== null} onClick={() => {
                setPending('reset')
                setError(null)
                void confirmResetUnreadableCredentials().then(async result => {
                  const mutation = result as SecureStoreLifecycleMutationResult
                  if (!mutation.success) throw new Error(
                    mutation.errorMessage ?? t('settings.lifecycle.operationFailed'),
                  )
                  setNotice(t('settings.lifecycle.resetComplete'))
                  setResetConfirm(false)
                  await load()
                }).catch(reason => setError(localizeError(reason, t))).finally(() => setPending(null))
              }}>{t('settings.lifecycle.confirm')}</button>
              <button className="btn sm ghost" onClick={() => setResetConfirm(false)}>{t('settings.lifecycle.cancel')}</button>
            </div>
          )}
        </div>
      )}

      {status?.capabilities.exportRecoveryBundle && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <input type="password" value={exportPassphrase} onChange={event => setExportPassphrase(event.target.value)} placeholder={t('settings.lifecycle.exportPassphrase')} />
          <input type="password" value={exportConfirmation} onChange={event => setExportConfirmation(event.target.value)} placeholder={t('settings.lifecycle.confirmPassphrase')} />
          <button className="btn sm ghost" disabled={pending !== null} onClick={() => void handleExport()}>{t('settings.lifecycle.export')}</button>
        </div>
      )}

      {status?.capabilities.importRecoveryBundle && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <input type="password" value={importPassphrase} onChange={event => setImportPassphrase(event.target.value)} placeholder={t('settings.lifecycle.importPassphrase')} />
          <input
            ref={importInput}
            type="file"
            accept=".recovery,application/octet-stream,application/json"
            aria-label={t('settings.lifecycle.import')}
            disabled={pending !== null}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) void handleImport(file)
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.lifecycle.importHelp')}</span>
        </div>
      )}
    </div>
  )
}
