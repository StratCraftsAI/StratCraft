/**
 * RestartDialog - Restart Required Notification
 *
 * TICKET_046: System-Level Configuration Implementation (Phase 3)
 * Shows when configuration changes require application restart.
 */

import React from 'react';
import { AlertTriangle, RotateCcw, X, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// =============================================================================
// Types
// =============================================================================

interface RestartDialogProps {
  isOpen: boolean;
  changes: string[];
  onRestart: () => void;
  onLater: () => void;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function RestartDialog({
  isOpen,
  changes,
  onRestart,
  onLater,
  onClose,
}: RestartDialogProps): JSX.Element | null {
  const { t } = useTranslation('settings');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-background shadow-2xl animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/10">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t('restart.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('restart.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('restart.changedSettings')}
          </p>

          <div className="rounded-lg border bg-muted/30 p-3 max-h-32 overflow-y-auto">
            <ul className="space-y-1 text-sm">
              {changes.map((change, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                  <code className="text-xs">{change}</code>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                {t('restart.preserveWork')}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button
            onClick={onLater}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <Clock className="h-4 w-4" />
            {t('restart.later')}
          </button>
          <button
            onClick={onRestart}
            className="flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-400"
          >
            <RotateCcw className="h-4 w-4" />
            {t('restart.restartNow')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Hook for managing restart state
// =============================================================================

interface RestartState {
  required: boolean;
  changes: string[];
}

export function useRestartRequired() {
  const [state, setState] = React.useState<RestartState>({
    required: false,
    changes: [],
  });

  const addChange = React.useCallback((path: string) => {
    setState((prev) => ({
      required: true,
      changes: prev.changes.includes(path)
        ? prev.changes
        : [...prev.changes, path],
    }));
  }, []);

  const clearChanges = React.useCallback(() => {
    setState({ required: false, changes: [] });
  }, []);

  const handleRestart = React.useCallback(() => {
    // Request app restart through IPC
    // This would need to be implemented in main process
    window.location.reload();
  }, []);

  return {
    ...state,
    addChange,
    clearChanges,
    handleRestart,
  };
}

export default RestartDialog;
