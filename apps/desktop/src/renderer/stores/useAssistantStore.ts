/**
 * Assistant Panel State Store (TICKET_593_1)
 *
 * Manages contextual help panel visibility and internal navigation.
 * - panelOpen: Session-only (Zustand, not persisted)
 * - assistantEnabled: Loaded from onboarding electron-store (persisted via IPC)
 * - contentOverrideKey: Panel-internal navigation to named content entries
 */

import { create } from 'zustand';

interface AssistantState {
  /** Whether the panel is currently open (session-only) */
  panelOpen: boolean;
  /** Whether assistant mode is enabled (persisted in electron-store) */
  assistantEnabled: boolean;
  /** When set, panel shows this registry key instead of route-resolved content */
  contentOverrideKey: string | null;

  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setAssistantEnabled: (enabled: boolean) => void;
  /** Navigate to a named content entry within the panel */
  pushContent: (key: string) => void;
  /** Return to route-based content */
  popContent: () => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  panelOpen: false,
  assistantEnabled: true,
  contentOverrideKey: null,

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setAssistantEnabled: (enabled) => set({
    assistantEnabled: enabled,
    // Close panel when disabling assistant mode
    ...(!enabled ? { panelOpen: false } : {}),
  }),
  pushContent: (key) => set({ contentOverrideKey: key }),
  popContent: () => set({ contentOverrideKey: null }),
}));
