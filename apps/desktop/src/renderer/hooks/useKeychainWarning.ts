/**
 * useKeychainWarning Hook
 *
 * TICKET_580_4: Subscribes to keychain-unavailable events from the main process.
 * Returns state for rendering the KeychainWarningBanner.
 * Session-dismissable via sessionStorage.
 */

import { useState, useEffect, useCallback } from 'react';

const SESSION_DISMISSED_KEY = 'keychainWarning_dismissed_session';

interface KeychainWarningState {
  /** Whether the OS keychain is unavailable */
  keychainUnavailable: boolean;
  /** Current platform (linux, darwin, win32) */
  platform: string;
  /** Platform-specific install instructions */
  instructions: string;
  /** Desktop environment (Linux only) */
  desktop: string;
  /** Dismiss the warning for this session */
  dismiss: () => void;
}

export function useKeychainWarning(): KeychainWarningState {
  const [keychainUnavailable, setKeychainUnavailable] = useState(false);
  const [platform, setPlatform] = useState('');
  const [instructions, setInstructions] = useState('');
  const [desktop, setDesktop] = useState('');

  useEffect(() => {
    // Check if already dismissed this session
    const dismissed = sessionStorage.getItem(SESSION_DISMISSED_KEY);
    if (dismissed === 'true') {
      return;
    }

    const unsubscribe = window.electronAPI?.credential?.onKeychainUnavailable?.(
      (data) => {
        setKeychainUnavailable(true);
        setPlatform(data.platform);
        setInstructions(data.instructions);
        setDesktop(data.desktop);
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, []);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(SESSION_DISMISSED_KEY, 'true');
    setKeychainUnavailable(false);
  }, []);

  return { keychainUnavailable, platform, instructions, desktop, dismiss };
}
