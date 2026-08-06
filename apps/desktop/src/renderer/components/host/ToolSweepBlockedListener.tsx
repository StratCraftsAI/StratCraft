/**
 * ToolSweepBlockedListener -- Host-side bridge from the Tool Sweep BYOK
 * gate to the in-app toast surface.
 *
 * TICKET_811: when the user clicks Run Sweep on a universe whose
 * declared providers all need a BYOK key and none are stored, the
 * plugin layer fires a `nexus:tool-sweep-blocked` window event with
 * pre-rendered message strings. This listener surfaces them via
 * `useMessage().error` with an "Open Settings" action button that
 * navigates the host to Settings > Data Providers.
 *
 * Why the message + button label arrive PRE-RENDERED in the event
 * detail instead of being translated here:
 *   - The relevant i18n keys (`toolSweep.gate.*`) live in the
 *     `quant-lab` namespace, which the plugin loads but the host
 *     renderer does not.
 *   - Mirrors the PRE-RENDERED-on-emit pattern used by
 *     `CompileGateRejectedListener`, which forwards an already-
 *     formatted diagnostic string.
 *   - Keeps the listener tier-clean: zero plugin-namespace knowledge.
 *
 * Pattern reference: CompileGateRejectedListener (TICKET_782_1) +
 * PersistenceErrorListener (TICKET_775).
 *
 * @see TICKET_811 - Tool Sweep BYOK gate
 * @see TICKET_096 - Message Utils / useMessage
 */

import { useEffect } from 'react';
import { useMessage } from '@/hooks/useMessage';
import { useAppStore } from '@/stores/useAppStore';

export interface ToolSweepBlockedDetail {
  /** Pre-rendered error message (already translated). */
  message: string;
  /** Pre-rendered action button label (already translated). */
  actionLabel: string;
  /**
   * Diagnostic context for telemetry / logs only -- not shown to the
   * user. Listing the candidate providers helps support sessions
   * confirm which keys the user is missing.
   */
  candidates?: string[];
  universeId?: string;
}

/**
 * Pure imperative handler -- extracted from the component so the unit
 * test can pin the action shape (error toast + setActiveView + section
 * intent dispatch) without standing up a React render harness, which
 * the apps/desktop vitest config does not provide.
 */
export interface ToolSweepBlockedHandlerDeps {
  error: (message: string, options?: { actions?: Array<{ label: string; onClick: () => void }> }) => unknown;
  setActiveView: (view: 'settings') => void;
  dispatchEvent: (event: Event) => boolean;
}

export function handleToolSweepBlocked(
  detail: ToolSweepBlockedDetail,
  deps: ToolSweepBlockedHandlerDeps,
): void {
  deps.error(detail.message, {
    actions: [
      {
        label: detail.actionLabel,
        onClick: () => {
          // Two-step navigation, matching how ConfigSettings owns its
          // own local `activeSection` state:
          //   1. App-level switch to the Settings view.
          //   2. Section-level switch via a window event the Settings
          //      component listens to. Avoids leaking section
          //      identifiers into the global app store (settings
          //      sections are a Settings-internal concern).
          deps.setActiveView('settings');
          deps.dispatchEvent(
            new CustomEvent('nexus:settings-section', {
              detail: { section: 'data-providers' },
            }),
          );
        },
      },
    ],
  });
}

export function ToolSweepBlockedListener(): null {
  const { error } = useMessage();
  const setActiveView = useAppStore(s => s.setActiveView);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ToolSweepBlockedDetail>).detail;
      if (!detail) return;
      handleToolSweepBlocked(detail, {
        error,
        setActiveView,
        dispatchEvent: window.dispatchEvent.bind(window),
      });
    };
    window.addEventListener('nexus:tool-sweep-blocked', handle);
    return () => {
      window.removeEventListener('nexus:tool-sweep-blocked', handle);
    };
  }, [error, setActiveView]);

  return null;
}
