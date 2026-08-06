/**
 * useAssistantShortcut - Ctrl+L keyboard shortcut for Assistant Panel (TICKET_593_1)
 *
 * Toggles the contextual help panel open/close.
 * Only active when assistantEnabled is true.
 * Called in MainLayout for global scope.
 */

import { useEffect } from 'react';
import { useAssistantStore } from '@/stores';

export function useAssistantShortcut(): void {
  const assistantEnabled = useAssistantStore((s) => s.assistantEnabled);
  const togglePanel = useAssistantStore((s) => s.togglePanel);

  useEffect(() => {
    if (!assistantEnabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        togglePanel();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [assistantEnabled, togglePanel]);
}
