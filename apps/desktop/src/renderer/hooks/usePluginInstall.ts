/**
 * usePluginInstall Hook
 *
 * TICKET_100: Plugin Installation Flow & User Consent
 *
 * React hook for plugin installation with consent flow.
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  PluginInstallPreview,
  GrantedPluginPermissions,
} from '@shared/types/plugin';

// =============================================================================
// Types
// =============================================================================

export type InstallPhase =
  | 'idle'
  | 'previewing'
  | 'consent'
  | 'installing'
  | 'complete'
  | 'error';

export interface InstallProgress {
  pluginId: string;
  phase: string;
  progress: number;
  message: string;
}

export interface InstallState {
  phase: InstallPhase;
  preview: PluginInstallPreview | null;
  packagePath: string | null;
  progress: InstallProgress | null;
  error: string | null;
}

export interface UsePluginInstallResult {
  state: InstallState;
  startInstall: (packagePath?: string) => Promise<void>;
  confirmInstall: () => Promise<void>;
  cancelInstall: () => void;
  reset: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function usePluginInstall(): UsePluginInstallResult {
  const [state, setState] = useState<InstallState>({
    phase: 'idle',
    preview: null,
    packagePath: null,
    progress: null,
    error: null,
  });

  // Subscribe to progress events
  useEffect(() => {
    const handleProgress = (_event: unknown, progress: InstallProgress) => {
      setState(prev => ({
        ...prev,
        progress,
        phase: progress.phase === 'complete' ? 'complete' :
               progress.phase === 'error' ? 'error' : 'installing',
        error: progress.phase === 'error' ? progress.message : null,
      }));
    };

    // @ts-expect-error - window.electron types
    window.electron?.ipcRenderer?.on?.('plugin:install:progress', handleProgress);

    return () => {
      // @ts-expect-error - window.electron types
      window.electron?.ipcRenderer?.removeListener?.('plugin:install:progress', handleProgress);
    };
  }, []);

  const startInstall = useCallback(async (packagePath?: string) => {
    setState(prev => ({
      ...prev,
      phase: 'previewing',
      error: null,
    }));

    try {
      // @ts-expect-error - window.electron types
      const result = await window.electron.ipcRenderer.invoke(
        'plugin:install:preview',
        { packagePath }
      );

      if (!result.success) {
        setState(prev => ({
          ...prev,
          phase: 'error',
          error: result.error,
        }));
        return;
      }

      setState(prev => ({
        ...prev,
        phase: 'consent',
        preview: result.preview,
        packagePath: result.packagePath,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: error instanceof Error ? error.message : 'MSG_UNKNOWN_ERROR',
      }));
    }
  }, []);

  const confirmInstall = useCallback(async () => {
    if (!state.preview || !state.packagePath) {
      return;
    }

    setState(prev => ({
      ...prev,
      phase: 'installing',
      progress: {
        pluginId: prev.preview?.pluginId || '',
        phase: 'downloading',
        progress: 0,
        message: 'MSG_PLUGIN_INSTALL_STARTING',
      },
    }));

    try {
      // @ts-expect-error - window.electron types
      const result = await window.electron.ipcRenderer.invoke(
        'plugin:install:confirm',
        {
          packagePath: state.packagePath,
          preview: state.preview,
        }
      );

      if (!result.success) {
        setState(prev => ({
          ...prev,
          phase: 'error',
          error: result.error,
        }));
      } else {
        setState(prev => ({
          ...prev,
          phase: 'complete',
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: error instanceof Error ? error.message : 'MSG_UNKNOWN_ERROR',
      }));
    }
  }, [state.preview, state.packagePath]);

  const cancelInstall = useCallback(() => {
    setState({
      phase: 'idle',
      preview: null,
      packagePath: null,
      progress: null,
      error: null,
    });
  }, []);

  const reset = useCallback(() => {
    setState({
      phase: 'idle',
      preview: null,
      packagePath: null,
      progress: null,
      error: null,
    });
  }, []);

  return {
    state,
    startInstall,
    confirmInstall,
    cancelInstall,
    reset,
  };
}

// =============================================================================
// Permission Check Hook
// =============================================================================

export function usePluginPermissions(pluginId: string | null) {
  const [permissions, setPermissions] = useState<GrantedPluginPermissions | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pluginId) {
      setPermissions(null);
      return;
    }

    setLoading(true);

    // @ts-expect-error - window.electron types
    window.electron.ipcRenderer
      .invoke('plugin:install:getPermissions', pluginId)
      .then((result: { success: boolean; permissions: GrantedPluginPermissions | null }) => {
        setPermissions(result.permissions);
      })
      .catch(() => {
        setPermissions(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [pluginId]);

  return { permissions, loading };
}

export default usePluginInstall;
