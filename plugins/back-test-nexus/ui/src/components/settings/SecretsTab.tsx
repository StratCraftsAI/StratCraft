/**
 * SecretsTab - Backtest plugin secrets management UI
 *
 * TICKET_308: Backtest PluginSettingsPage
 * Mirrors strategy-builder-nexus SecretsTab pattern for data provider credentials.
 *
 * @see TICKET_093 - Plugin Settings Decoupling
 * @see TICKET_081 - Plugin Settings Architecture
 * @see TICKET_308 - Backtest PageHeader + Plugin Settings Page
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { getIntlLocale } from '@shared/utils/format-locale';
// PLUGIN_TICKET_018: Data provider config from Tier 0 data-plugin
import { DATA_PROVIDERS, getProviderBySecretKey } from '@plugins/data-plugin/config/data-providers';
import { SECRETS_FEEDBACK_DISMISS_MS } from '@shared/constants/timing';

// =============================================================================
// Inline SVG Icons (avoid lucide-react dependency in plugin)
// =============================================================================

const KeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const ShieldCheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const ShieldIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const CheckCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const AlertTriangleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const EditIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ClipboardListIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" /><path d="M12 16h4" />
    <path d="M8 11h.01" /><path d="M8 16h.01" />
  </svg>
);

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const FlaskIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
    <path d="M8.5 2h7" /><path d="M7 16h10" />
  </svg>
);

const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const XCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const ExternalLinkIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// =============================================================================
// DeleteConfirmDialog - StratCraftsAI-styled confirmation
// TICKET_309: Replace native confirm() with themed dialog
// =============================================================================

interface DeleteConfirmDialogProps {
  visible: boolean;
  secretKey: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({ visible, secretKey, onConfirm, onCancel }: DeleteConfirmDialogProps): JSX.Element | null {
  const { t } = useTranslation('backtest');
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    },
    [visible, onConfirm, onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!visible) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0',
        'flex items-center justify-center',
        'bg-black/60 backdrop-blur-[4px]',
        'animate-in fade-in duration-150'
      )}
      style={{ zIndex: Z_INDEX_MODAL }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          'min-w-[320px] max-w-[400px]',
          'rounded-lg border border-color-terminal-border',
          'bg-color-terminal-surface',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          'animate-in zoom-in-95 duration-150'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3',
            'border-b border-color-terminal-border border-l-[3px]',
            'bg-color-terminal-panel rounded-t-lg',
            'border-l-red-500'
          )}
        >
          <AlertTriangleIcon className="w-[18px] h-[18px] flex-shrink-0 text-red-500" />
          <span className={cn(
            'flex-1 font-mono text-xs font-semibold',
            'text-color-terminal-text'
          )}>
            {t('settings.deleteSecret')}
          </span>
          <button
            onClick={onCancel}
            className="p-1 text-color-terminal-text-muted hover:text-color-terminal-text transition-colors duration-200"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-6">
          <p className="font-mono text-xs leading-relaxed text-color-terminal-text text-center">
            {t('settings.deleteSecretConfirm')} <span className="text-red-400 font-semibold">{secretKey}</span>?
            {t('settings.deleteSecretWarning')}
          </p>
        </div>

        {/* Footer */}
        <div className={cn(
          'flex justify-center gap-3 px-4 py-4',
          'border-t border-color-terminal-border'
        )}>
          <button
            onClick={onCancel}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[11px] font-semibold',
              'rounded border border-color-terminal-border',
              'bg-transparent text-color-terminal-text-secondary',
              'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-all duration-200'
            )}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[11px] font-semibold',
              'rounded border border-red-500',
              'bg-red-500/10 text-red-400',
              'hover:bg-red-500/20',
              'transition-all duration-200'
            )}
            autoFocus
          >
            {t('settings.deleteButton')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// =============================================================================
// Types
// =============================================================================

interface SecretsTabProps {
  pluginId: string;
}

interface ConfigurationProperty {
  type: string;
  description?: string;
  secret?: boolean;
  default?: unknown;
  providerId?: string;
}

interface Credential {
  key: string;
  hasValue: boolean;
  description?: string;
  fromManifest?: boolean;
  providerId?: string;
  docsUrl?: string;
}

interface TestResult {
  status: 'idle' | 'testing' | 'success' | 'error';
  message?: string;
}

interface ActivityLogEntry {
  timestamp: number;
  action: string;
  key: string;
  success: boolean;
}

// =============================================================================
// Navigation
// =============================================================================

const NAV_ITEM_KEYS = [
  { id: 'status', labelKey: 'settings.navStatus', icon: ShieldCheckIcon },
  { id: 'credentials', labelKey: 'settings.navCredentials', icon: KeyIcon },
  { id: 'activity', labelKey: 'settings.navActivity', icon: ClipboardListIcon },
] as const;

// =============================================================================
// CredentialItem Component
// =============================================================================

interface CredentialItemProps {
  credential: Credential;
  pluginId: string;
  allCredentials: Credential[];
  testResult: TestResult;
  onTestResultChange: (result: TestResult) => void;
  onUpdate: () => void;
}

function CredentialItem({ credential, pluginId, allCredentials, testResult, onTestResultChange, onUpdate }: CredentialItemProps): JSX.Element {
  const { t } = useTranslation('backtest');
  const [editing, setEditing] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  // TICKET_309: For multi-key providers, only enable test when all paired keys are configured
  const allPairedKeysConfigured = useMemo(() => {
    if (!credential.providerId) return false;
    const provider = DATA_PROVIDERS.find(p => p.id === credential.providerId);
    if (!provider) return credential.hasValue;
    return provider.secretKeys.every(sk => allCredentials.some(c => c.key === sk && c.hasValue));
  }, [credential.providerId, credential.hasValue, allCredentials]);

  const handleView = async () => {
    if (showValue) {
      setShowValue(false);
      setValue(null);
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.credential.get(pluginId, credential.key);
      if (result.success && result.value) {
        setValue(result.value);
        setShowValue(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (value) {
      await navigator.clipboard.writeText(value);
    }
  };

  const handleSave = async () => {
    if (!inputValue.trim()) {
      setError(t('settings.valueCannotBeEmpty'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.credential.set(pluginId, credential.key, inputValue);
      if (result.success) {
        setEditing(false);
        setInputValue('');
        onTestResultChange({ status: 'idle' });
        onUpdate();
      } else {
        setError(result.errorMessage || t('settings.failedToSave'));
      }
    } catch (e) {
      setError(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleteConfirmVisible(false);
    try {
      await window.electronAPI.credential.delete(pluginId, credential.key);
      onUpdate();
    } catch (e) {
      setError(`Error: ${e}`);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setInputValue('');
    setError(null);
  };

  const handleTest = async () => {
    if (!credential.providerId || !credential.hasValue) return;
    onTestResultChange({ status: 'testing' });
    try {
      // Alpaca requires combined "keyId:secretKey" format for validation
      // Fetch all paired keys from DATA_PROVIDERS config
      const provider = DATA_PROVIDERS.find(p => p.id === credential.providerId);
      let validationKey = '';

      if (provider && provider.secretKeys.length > 1) {
        // Multi-key provider (e.g., Alpaca): combine all keys with ':'
        const keyParts: string[] = [];
        for (const secretKey of provider.secretKeys) {
          const res = await window.electronAPI.credential.get(pluginId, secretKey);
          if (!res.success || !res.value) {
            onTestResultChange({ status: 'error', message: t('settings.missingCredential', { key: secretKey }) });
            setTimeout(() => onTestResultChange({ status: 'idle' }), SECRETS_FEEDBACK_DISMISS_MS);
            return;
          }
          keyParts.push(res.value);
        }
        validationKey = keyParts.join(':');
      } else {
        // Single-key provider: use the credential value directly
        const getResult = await window.electronAPI.credential.get(pluginId, credential.key);
        if (!getResult.success || !getResult.value) {
          onTestResultChange({ status: 'error', message: t('settings.failedToRetrieveApiKey') });
          return;
        }
        validationKey = getResult.value;
      }

      const result = await window.electronAPI.credential.validateApiKey(
        credential.providerId,
        validationKey
      );
      if (result.success && result.data) {
        if (result.data.valid) {
          // TICKET_311: Show key type (Paper/Live) for Alpaca
          if (result.data.keyType) {
            const keyTypeStr = result.data.keyType === 'paper' ? t('settings.keyTypePaper') : t('settings.keyTypeLive');
            onTestResultChange({ status: 'success', message: t('settings.verifiedKeyType', { keyType: keyTypeStr }) });
          } else {
            onTestResultChange({ status: 'success', message: t('settings.verified') });
          }
        } else {
          onTestResultChange({ status: 'error', message: result.data.error || t('settings.invalidApiKey') });
          setTimeout(() => onTestResultChange({ status: 'idle' }), SECRETS_FEEDBACK_DISMISS_MS);
        }
      } else {
        onTestResultChange({ status: 'error', message: result.errorMessage || t('settings.validationFailed') });
        setTimeout(() => onTestResultChange({ status: 'idle' }), SECRETS_FEEDBACK_DISMISS_MS);
      }
    } catch (e) {
      onTestResultChange({ status: 'error', message: `Error: ${e}` });
      setTimeout(() => onTestResultChange({ status: 'idle' }), SECRETS_FEEDBACK_DISMISS_MS);
    }
  };

  return (
    <div className="rounded-lg border border-white/10 p-4 hover:border-color-terminal-accent-teal/30 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
            credential.hasValue ? 'bg-green-500/10' : 'bg-yellow-500/10'
          }`}>
            <KeyIcon className={`h-5 w-5 ${credential.hasValue ? 'text-green-500' : 'text-yellow-500'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{credential.key}</span>
              {credential.hasValue ? (
                <CheckCircleIcon className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangleIcon className="h-4 w-4 text-yellow-500" />
              )}
              {credential.fromManifest && (
                <span className="text-[10px] px-1.5 py-0.5 bg-color-terminal-accent-teal/20 rounded text-color-terminal-accent-teal">
                  {t('settings.required')}
                </span>
              )}
            </div>
            {credential.description && (
              <p className="text-xs text-muted-foreground">{credential.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showValue && value && (
            <div className="flex items-center gap-2 rounded bg-white/5 px-3 py-1.5">
              <code className="text-sm font-mono">
                {value.length > 20 ? `${value.substring(0, 20)}...` : value}
              </code>
              <button onClick={handleCopy} className="rounded p-1 hover:bg-white/10" title={t('settings.copyToClipboard')}>
                <CopyIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          {credential.hasValue && (
            <button onClick={handleView} disabled={loading} className="rounded-lg p-2 hover:bg-white/5" title={showValue ? t('settings.hideValue') : t('settings.showValue')}>
              {loading ? <RefreshIcon className="h-4 w-4 animate-spin" /> : showValue ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          )}

          <button onClick={() => setEditing(true)} className="rounded-lg p-2 hover:bg-white/5 text-color-terminal-accent-teal" title={credential.hasValue ? t('settings.editValue') : t('settings.setValue')}>
            <EditIcon className="h-4 w-4" />
          </button>

          {credential.hasValue && credential.providerId && allPairedKeysConfigured && (
            <button
              onClick={handleTest}
              disabled={testResult.status === 'testing'}
              className={cn(
                'rounded-lg p-2 transition-colors',
                testResult.status === 'idle' && 'hover:bg-white/5 text-color-terminal-text-muted hover:text-color-terminal-accent-teal',
                testResult.status === 'testing' && 'text-color-terminal-accent-teal',
                testResult.status === 'success' && 'text-color-terminal-accent-teal bg-color-terminal-accent-teal/10',
                testResult.status === 'error' && 'text-red-500 bg-red-500/10'
              )}
              title={testResult.message || t('settings.testApiKey')}
            >
              {testResult.status === 'testing' ? <LoaderIcon className="h-4 w-4 animate-spin" /> :
               testResult.status === 'success' ? <CheckCircleIcon className="h-4 w-4" /> :
               testResult.status === 'error' ? <XCircleIcon className="h-4 w-4" /> :
               <FlaskIcon className="h-4 w-4" />}
            </button>
          )}

          {credential.hasValue && (
            <button onClick={() => setDeleteConfirmVisible(true)} className="rounded-lg p-2 text-red-500 hover:bg-red-500/10" title={t('settings.deleteCredential')}>
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {testResult.status !== 'idle' && testResult.message && (
        <div className={cn(
          'mt-2 text-xs px-3 py-1.5 rounded',
          testResult.status === 'success' && 'bg-green-500/10 text-green-500',
          testResult.status === 'error' && 'bg-red-500/10 text-red-500',
          testResult.status === 'testing' && 'bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal'
        )}>
          {testResult.status === 'testing' ? t('settings.testing') : testResult.message}
        </div>
      )}

      {editing && (
        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="password"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={t('settings.enterSecretValue')}
                className="w-full rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-sm focus:border-color-terminal-accent-teal focus:outline-none"
                autoFocus
              />
            </div>
            <button
              onClick={handleSave}
              disabled={loading || !inputValue.trim()}
              className="rounded-lg px-4 py-2 bg-color-terminal-accent-teal text-black text-sm font-medium hover:bg-color-terminal-accent-teal/90 disabled:opacity-50"
            >
              {loading ? t('settings.saving') : t('settings.save')}
            </button>
            <button onClick={handleCancel} className="rounded-lg px-4 py-2 text-sm hover:bg-white/5">
              {t('common.cancel')}
            </button>
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
          {credential.docsUrl && (
            <a
              href={credential.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-color-terminal-accent-teal hover:underline"
            >
              {t('settings.getApiKey')} <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <DeleteConfirmDialog
        visible={deleteConfirmVisible}
        secretKey={credential.key}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirmVisible(false)}
      />
    </div>
  );
}

// =============================================================================
// ActivityLog Component
// =============================================================================

function ActivityLog({ entries }: { entries: ActivityLogEntry[] }): JSX.Element {
  const { t } = useTranslation('backtest');
  return (
    <div className="rounded-lg border border-white/10">
      <div className="border-b border-white/10 px-4 py-3">
        <h3 className="font-medium">{t('settings.recentActivity')}</h3>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground">
            {t('settings.noActivityRecorded')}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map((entry, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                {entry.success ? (
                  <CheckCircleIcon className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <AlertTriangleIcon className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{entry.action}</span>
                    <span className="text-xs text-muted-foreground">{entry.key}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {new Date(entry.timestamp).toLocaleString(getIntlLocale())}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function SecretsTab({ pluginId }: SecretsTabProps): JSX.Element {
  const { t } = useTranslation('backtest');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('status');
  // TICKET_309: Provider-level test results shared across paired credential rows
  const [providerTestResults, setProviderTestResults] = useState<Record<string, TestResult>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const manifestResult = await window.electronAPI.plugin.getManifest(pluginId);
      const manifest = manifestResult.success ? manifestResult.manifest as {
        contributes?: {
          configuration?: {
            properties?: Record<string, ConfigurationProperty>;
          };
        };
      } : null;

      const credMap = new Map<string, Credential>();

      // Add manifest-declared secrets
      if (manifest?.contributes?.configuration?.properties) {
        for (const [key, prop] of Object.entries(manifest.contributes.configuration.properties)) {
          if (prop.secret === true) {
            // Look up data provider config for providerId and docsUrl
            const provider = getProviderBySecretKey(key);
            credMap.set(key, {
              key,
              hasValue: false,
              description: prop.description,
              fromManifest: true,
              providerId: provider?.id,
              docsUrl: provider?.docsUrl,
            });
          }
        }
      }

      // Check stored credentials
      const listResult = await window.electronAPI.credential.list(pluginId);
      if (listResult.success) {
        for (const key of listResult.keys) {
          const hasResult = await window.electronAPI.credential.has(pluginId, key);
          const existing = credMap.get(key);
          if (existing) {
            existing.hasValue = hasResult.exists;
          } else {
            credMap.set(key, {
              key,
              hasValue: hasResult.exists,
              fromManifest: false,
            });
          }
        }
      }

      const sortedCreds = Array.from(credMap.values()).sort((a, b) => {
        if (a.fromManifest && !b.fromManifest) return -1;
        if (!a.fromManifest && b.fromManifest) return 1;
        return a.key.localeCompare(b.key);
      });

      setCredentials(sortedCreds);

      // Load audit log
      const auditResult = await window.electronAPI.credential.getAuditLog(pluginId, 20);
      if (auditResult.success) {
        setActivityLog(
          auditResult.entries.map((entry) => ({
            timestamp: entry.timestamp,
            action: entry.operation,
            key: entry.key,
            success: true,
          }))
        );
      }
    } catch (error) {
      console.error('[E:BACKTEST:CREDENTIALS_LOAD_FAILED] Failed to load credentials:', error);
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredCredentials = credentials.filter((c) =>
    c.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
  };

  const configuredCount = credentials.filter((c) => c.hasValue).length;

  return (
    <div className="h-full flex">
      {/* Left Navigation */}
      <nav className="w-96 flex-shrink-0 border-r border-white/10 p-4">
        <div className="space-y-1">
          {NAV_ITEM_KEYS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'text-color-terminal-accent-teal'
                    : 'text-muted-foreground hover:text-color-terminal-accent-teal'
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Right Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-color-terminal-accent-teal/10">
                <ShieldIcon className="h-6 w-6 text-color-terminal-accent-teal" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{t('settings.secretsPageTitle')}</h1>
                <p className="text-muted-foreground">
                  {t('settings.secretsPageDescription')}
                </p>
              </div>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('settings.refresh')}
            </button>
          </div>

          {/* Security Status */}
          <div id="status" className="rounded-lg border border-white/10 p-4 scroll-mt-4">
            <div className="flex items-center gap-3">
              <ShieldCheckIcon className="h-8 w-8 text-color-terminal-accent-teal" />
              <div>
                <h3 className="font-medium">{t('settings.securityStatus')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('settings.securityStatusDescription', { configured: configuredCount, total: credentials.length })}
                </p>
              </div>
            </div>
          </div>

          {/* Credentials Section */}
          <div id="credentials" className="space-y-4 scroll-mt-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('settings.searchSecrets')}
                className="w-full rounded-lg border border-white/10 bg-transparent py-2 pl-10 pr-4 text-sm focus:border-color-terminal-accent-teal focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t('settings.storedSecrets')}</h2>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshIcon className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredCredentials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 py-12 text-center">
                  <KeyIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-4 text-muted-foreground">
                    {searchQuery ? t('settings.noSecretsMatch') : t('settings.noSecretsConfigured')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredCredentials.map((credential) => (
                    <CredentialItem
                      key={credential.key}
                      credential={credential}
                      pluginId={pluginId}
                      allCredentials={credentials}
                      testResult={credential.providerId ? (providerTestResults[credential.providerId] ?? { status: 'idle' }) : { status: 'idle' }}
                      onTestResultChange={(result) => {
                        if (credential.providerId) {
                          setProviderTestResults(prev => ({ ...prev, [credential.providerId!]: result }));
                        }
                      }}
                      onUpdate={loadData}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Activity Log */}
          <div id="activity" className="scroll-mt-4">
            <ActivityLog entries={activityLog} />
          </div>
        </div>
      </div>
    </div>
  );
}
