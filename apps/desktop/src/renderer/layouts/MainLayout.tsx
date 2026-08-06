/**
 * Main layout component
 */

import React, { useEffect } from 'react';

import { Toolbar } from './Toolbar';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { KeychainWarningBanner } from '@/components/common';
import { AssistantPanel } from '@/components/host/AssistantPanel';
import { ServiceApiRoleBridge } from '@/components/StatusBar';
import { useAppStore, useAssistantStore } from '@/stores';
import { useAssistantShortcut } from '@/hooks/useAssistantShortcut';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { immersiveMode, setServerStatus, setError } = useAppStore();
  const assistantEnabled = useAssistantStore((s) => s.assistantEnabled);
  const setAssistantEnabled = useAssistantStore((s) => s.setAssistantEnabled);

  // TICKET_593_1: Global Ctrl+L shortcut for assistant panel
  useAssistantShortcut();

  // TICKET_614: Toggle transparency class on <html> for immersive mode (B1 transparent window)
  // Applied to <html> so CSS can cascade to body and #root
  useEffect(() => {
    if (immersiveMode) {
      document.documentElement.classList.add('immersive-transparent');
    } else {
      document.documentElement.classList.remove('immersive-transparent');
    }
  }, [immersiveMode]);

  // TICKET_593_1: Load persisted assistant mode from electron-store
  useEffect(() => {
    window.electronAPI?.onboarding.getState()
      .then((result) => {
        if (result.success && result.state) {
          setAssistantEnabled(result.state.assistantMode);
        }
      })
      .catch((error) => {
        console.error('[E:UI:ASSISTANT_LOAD_FAILED] Failed to load state:', error);
      });
  }, [setAssistantEnabled]);

  useEffect(() => {
    // Listen to server status changes
    const unsubscribeStatus = window.electronAPI?.server.onStatusChange(
      (status) => {
        setServerStatus(status);
      }
    );

    // Listen to server errors
    const unsubscribeError = window.electronAPI?.server.onError((error: string) => {
      setError(error);
    });

    // Get initial status
    window.electronAPI?.server.getStatus().then(setServerStatus).catch(err => {
      console.error('[E:UI:SERVER_STATUS_FETCH_FAILED] Failed to get server status:', err);
    });

    return () => {
      unsubscribeStatus?.();
      unsubscribeError?.();
    };
  }, [setServerStatus, setError]);

  return (
    <div className={`flex h-screen flex-col text-foreground ${immersiveMode ? 'bg-transparent' : 'bg-background'}`}>
      {/* Title bar -- hidden in immersive mode */}
      {!immersiveMode && (
        <header className="h-10 border-b border-border bg-card app-region-drag">
          <Toolbar />
        </header>
      )}

      {/* TICKET_580_4: Keychain security warning */}
      {!immersiveMode && <KeychainWarningBanner />}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar -- hidden in immersive mode */}
        {!immersiveMode && <SidePanel />}

        {/* Main content area */}
        <main className="flex-1 overflow-auto transition-all duration-300">{children}</main>

        {/* TICKET_593_1: Contextual help panel */}
        {!immersiveMode && assistantEnabled && <AssistantPanel />}
      </div>

      {/* Status bar -- hidden in immersive mode */}
      {!immersiveMode && <StatusBar />}

      {/* TICKET_1334 P4: single app-lifetime subscription to the Service API
          runtime role, so both Quant Lab launch panels can label who serves
          them without each owning a listener (D4 / AC5_1). */}
      <ServiceApiRoleBridge />
    </div>
  );
}
