import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, RotateCw, ShieldAlert, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  SecureStoreLifecycleMutationResult,
  SecureStoreLifecycleStatus,
} from '@StratCraft/types';

type Action = 'migrate' | 'rotate' | 'reset' | 'export' | 'import';
interface BackupChoice { filename: string; timestamp: number }

function downloadBundle(bundleBase64: string): void {
  const bytes = Uint8Array.from(atob(bundleBase64), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stratcraft-secure-store-${new Date().toISOString().slice(0, 10)}.recovery`;
  anchor.click();
  URL.revokeObjectURL(url);
  bytes.fill(0);
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('recovery_bundle_read_failed'));
    reader.onload = () => {
      const value = reader.result;
      if (!(value instanceof ArrayBuffer)) {
        reject(new Error('recovery_bundle_read_failed'));
        return;
      }
      const bytes = new Uint8Array(value);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      resolve(btoa(binary));
      bytes.fill(0);
    };
    reader.readAsArrayBuffer(file);
  });
}

export function SecureStoreLifecyclePanel(): JSX.Element {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<SecureStoreLifecycleStatus | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [backups, setBackups] = useState<BackupChoice[]>([]);
  const [selectedBackup, setSelectedBackup] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await window.electronAPI.credential.lifecycleStatus();
    if (!result.success || !result.status) {
      throw new Error(result.errorMessage ?? 'credential_lifecycle_load_failed');
    }
    setStatus(result.status);
  }, []);

  useEffect(() => {
    void load().catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
    void window.electronAPI.databaseBackup.listBackups().then(result => {
      if (!result.success) return;
      setBackups(result.backups);
      setSelectedBackup(current => current || result.backups[0]?.filename || '');
    });
  }, [load]);

  const run = useCallback(async (
    action: Action,
    operation: () => Promise<SecureStoreLifecycleMutationResult>,
  ) => {
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const result = await operation();
      if (!result.success) {
        const key = typeof result.errorCode === 'string'
          ? `llmErrors.${result.errorCode}`
          : 'lifecycle.operationFailed';
        throw new Error(t(key, { defaultValue: result.errorMessage ?? t('lifecycle.operationFailed') }));
      }
      setNotice(t(`lifecycle.${action}Complete`));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  }, [load, t]);

  const handleExport = useCallback(async () => {
    if (!exportPassphrase || exportPassphrase !== exportConfirmation) {
      setError(t('lifecycle.passphraseMismatch'));
      return;
    }
    setPending('export');
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.credential.exportRecoveryBundle(exportPassphrase);
      if (!result.success || !result.bundleBase64) {
        throw new Error(result.errorMessage ?? t('lifecycle.operationFailed'));
      }
      downloadBundle(result.bundleBase64);
      setExportPassphrase('');
      setExportConfirmation('');
      setNotice(t('lifecycle.exportComplete'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  }, [exportConfirmation, exportPassphrase, t]);

  const handleBackupExport = useCallback(async () => {
    if (!selectedBackup || !exportPassphrase || exportPassphrase !== exportConfirmation) {
      setError(t('lifecycle.passphraseMismatch'));
      return;
    }
    setPending('export');
    setError(null);
    try {
      const result = await window.electronAPI.credential.exportBackupRecoveryBundle(
        selectedBackup,
        exportPassphrase,
      );
      if (!result.success || !result.bundleBase64) {
        throw new Error(result.errorMessage ?? t('lifecycle.operationFailed'));
      }
      downloadBundle(result.bundleBase64);
      setNotice(t('lifecycle.backupExportComplete'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  }, [exportConfirmation, exportPassphrase, selectedBackup, t]);

  const handleImport = useCallback(async (file: File) => {
    if (!importPassphrase) {
      setError(t('lifecycle.passphraseRequired'));
      return;
    }
    setPending('import');
    setError(null);
    setNotice(null);
    try {
      const bundleBase64 = await readFileBase64(file);
      await run('import', () => window.electronAPI.credential.importRecoveryBundle(
        bundleBase64,
        importPassphrase,
      ));
      setImportPassphrase('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (importInput.current) importInput.current.value = '';
      setPending(null);
    }
  }, [importPassphrase, run, t]);

  return (
    <div className="mb-4 rounded border border-color-terminal-border bg-color-terminal-panel p-4" data-testid="secure-store-lifecycle">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-mono text-[13px] font-semibold">{t('lifecycle.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('lifecycle.description')}</p>
        </div>
        <button className="btn sm ghost" onClick={() => void load()} disabled={pending !== null}>
          <RefreshCw className="h-4 w-4" /> {t('lifecycle.refresh')}
        </button>
      </div>

      {status && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <span>{t('lifecycle.mode')}: {t(`lifecycle.modes.${status.mode}`)}</span>
          <span>{t('lifecycle.generation')}: {status.activeGeneration ?? '-'}</span>
          <span>{t('lifecycle.credentials')}: {status.credentialCount}</span>
          <span>{t('lifecycle.unreadable')}: {status.unreadableCredentialCount}</span>
        </div>
      )}

      {error && <p role="alert" className="mb-3 text-xs text-red-500"><ShieldAlert className="mr-1 inline h-4 w-4" />{error}</p>}
      {notice && <p role="status" className="mb-3 text-xs text-color-terminal-accent-teal">{notice}</p>}

      {status && (
        <div className="flex flex-wrap gap-2">
          <button
            className="btn sm ghost"
            disabled={!status.capabilities.migrateLegacy || pending !== null}
            onClick={() => void run('migrate', () => window.electronAPI.credential.migrateLegacy())}
          >
            <RotateCw className="h-4 w-4" /> {t('lifecycle.migrate')}
          </button>
          <button
            className="btn sm ghost"
            disabled={!status.capabilities.rotateMasterKey || pending !== null}
            onClick={() => void run('rotate', () => window.electronAPI.credential.rotateMasterKey())}
          >
            <RotateCw className="h-4 w-4" /> {t('lifecycle.rotate')}
          </button>
          {status.capabilities.resetUnreadableCredentials && !resetConfirm && (
            <button className="btn sm ghost" disabled={pending !== null} onClick={() => setResetConfirm(true)}>
              <ShieldAlert className="h-4 w-4" /> {t('lifecycle.resetUnreadable')}
            </button>
          )}
          {resetConfirm && (
            <div className="flex items-center gap-2" role="group" aria-label={t('lifecycle.resetConfirm')}>
              <span className="text-xs text-red-500">{t('lifecycle.resetConfirm')}</span>
              <button
                className="btn sm solid"
                disabled={pending !== null}
                onClick={() => void run('reset', async () => {
                  const result = await window.electronAPI.credential.resetUnreadable(true);
                  setResetConfirm(false);
                  return result;
                })}
              >{t('lifecycle.confirm')}</button>
              <button className="btn sm ghost" onClick={() => setResetConfirm(false)}>{t('lifecycle.cancel')}</button>
            </div>
          )}
        </div>
      )}

      {status?.capabilities.exportRecoveryBundle && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <input type="password" value={exportPassphrase} onChange={event => setExportPassphrase(event.target.value)} placeholder={t('lifecycle.exportPassphrase')} />
          <input type="password" value={exportConfirmation} onChange={event => setExportConfirmation(event.target.value)} placeholder={t('lifecycle.confirmPassphrase')} />
          <button className="btn sm ghost" disabled={pending !== null} onClick={() => void handleExport()}>
            <Download className="h-4 w-4" /> {t('lifecycle.export')}
          </button>
          {backups.length > 0 && (
            <>
              <select value={selectedBackup} onChange={event => setSelectedBackup(event.target.value)}>
                {backups.map(backup => (
                  <option key={backup.filename} value={backup.filename}>{backup.filename}</option>
                ))}
              </select>
              <button className="btn sm ghost" disabled={pending !== null} onClick={() => void handleBackupExport()}>
                <Download className="h-4 w-4" /> {t('lifecycle.exportSelectedBackup')}
              </button>
            </>
          )}
        </div>
      )}

      {status?.capabilities.importRecoveryBundle && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <input type="password" value={importPassphrase} onChange={event => setImportPassphrase(event.target.value)} placeholder={t('lifecycle.importPassphrase')} />
          <input
            ref={importInput}
            type="file"
            accept=".recovery,application/octet-stream,application/json"
            disabled={pending !== null}
            aria-label={t('lifecycle.import')}
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          <span className="text-xs text-muted-foreground"><Upload className="mr-1 inline h-4 w-4" />{t('lifecycle.importHelp')}</span>
        </div>
      )}
    </div>
  );
}
