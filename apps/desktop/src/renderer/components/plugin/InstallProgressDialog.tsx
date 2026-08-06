/**
 * InstallProgressDialog - Plugin Installation Progress Dialog
 *
 * TICKET_100: Plugin Installation Flow & User Consent
 *
 * Shows installation progress with steps:
 * - Downloading package
 * - Verifying signature
 * - Validating permissions
 * - Copying files
 * - Registering plugin
 * - Initializing
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Shield,
  FileCheck,
  Copy,
  Database,
  Play,
  Check,
  Loader2,
  Circle,
  X,
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'validating'
  | 'extracting'
  | 'copying'
  | 'registering'
  | 'initializing'
  | 'complete'
  | 'error';

interface InstallProgressDialogProps {
  pluginName: string;
  phase: InstallPhase;
  progress: number;
  message: string;
  error?: string;
  onCancel?: () => void;
  onClose?: () => void;
}

// =============================================================================
// Phase Configuration
// =============================================================================

const PHASE_ICONS: Record<
  Exclude<InstallPhase, 'error'>,
  React.ComponentType<{ className?: string }>
> = {
  downloading: Download,
  verifying: Shield,
  validating: FileCheck,
  extracting: Copy,
  copying: Copy,
  registering: Database,
  initializing: Play,
  complete: Check,
};

const PHASE_KEYS: Record<Exclude<InstallPhase, 'error'>, string> = {
  downloading: 'marketplace:install.phases.downloading',
  verifying: 'marketplace:install.phases.verifying',
  validating: 'marketplace:install.phases.validating',
  extracting: 'marketplace:install.phases.extracting',
  copying: 'marketplace:install.phases.copying',
  registering: 'marketplace:install.phases.registering',
  initializing: 'marketplace:install.phases.initializing',
  complete: 'marketplace:install.phases.complete',
};

const PHASE_ORDER: InstallPhase[] = [
  'downloading',
  'verifying',
  'validating',
  'extracting',
  'copying',
  'registering',
  'initializing',
  'complete',
];

// =============================================================================
// Step Item Component
// =============================================================================

function StepItem({
  phase,
  currentPhase,
  isError,
  t,
}: {
  phase: Exclude<InstallPhase, 'error'>;
  currentPhase: InstallPhase;
  isError: boolean;
  t: (key: string) => string;
}) {
  const Icon = PHASE_ICONS[phase];
  const label = t(PHASE_KEYS[phase]);

  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  const stepIndex = PHASE_ORDER.indexOf(phase);

  let status: 'pending' | 'active' | 'complete' | 'error';
  if (isError && currentPhase === phase) {
    status = 'error';
  } else if (stepIndex < currentIndex || currentPhase === 'complete') {
    status = 'complete';
  } else if (stepIndex === currentIndex) {
    status = 'active';
  } else {
    status = 'pending';
  }

  const statusStyles = {
    pending: 'text-muted-foreground',
    active: 'text-primary',
    complete: 'text-green-500',
    error: 'text-red-500',
  };

  const iconStyles = {
    pending: 'bg-muted text-muted-foreground',
    active: 'bg-primary/10 text-primary',
    complete: 'bg-green-500/10 text-green-500',
    error: 'bg-red-500/10 text-red-500',
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconStyles[status]}`}
      >
        {status === 'active' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status === 'complete' ? (
          <Check className="h-4 w-4" />
        ) : status === 'error' ? (
          <X className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </div>
      <span className={`text-sm ${statusStyles[status]}`}>{label}</span>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function InstallProgressDialog({
  pluginName,
  phase,
  progress,
  message,
  error,
  onCancel,
  onClose,
}: InstallProgressDialogProps): JSX.Element {
  const { t } = useTranslation('marketplace');
  const isComplete = phase === 'complete';
  const isError = phase === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-background shadow-2xl">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            {isComplete
              ? t('install.header.complete')
              : isError
                ? t('install.header.failed')
                : t('install.header.installing', { name: pluginName })}
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Progress Bar */}
          {!isComplete && !isError && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {progress}% - {t(message, { defaultValue: message })}
              </p>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-3">
            {PHASE_ORDER.filter(p => p !== 'complete').map(p => (
              <StepItem
                key={p}
                phase={p as Exclude<InstallPhase, 'error'>}
                currentPhase={phase}
                isError={isError}
                t={t}
              />
            ))}
          </div>

          {/* Success Message */}
          {isComplete && (
            <div className="rounded-lg bg-green-500/10 p-4">
              <div className="flex items-center gap-3">
                <Check className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    {t('install.successMessage')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('install.activateHint')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {isError && error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
              <div className="flex items-start gap-3">
                <X className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    {t('install.errorMessage')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          {!isComplete && !isError && onCancel && (
            <button
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('install.buttons.cancel')}
            </button>
          )}
          {(isComplete || isError) && onClose && (
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              {t('install.buttons.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default InstallProgressDialog;
