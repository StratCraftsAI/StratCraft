/**
 * useLLMAccess - Hook to check LLM feature access
 *
 * TICKET_190: BYOK Guest Mode and API Key Privacy
 *
 * Provides LLM access checking and API key prompt state management.
 * Used by pages with LLM-powered features (EntrySignalPage, RegimeDetectorPage).
 *
 * Layer 2: checkOnMount option for one-time page entry modal (per session)
 * Layer 3: checkAccess function for button click interception
 */

import { useState, useCallback, useEffect } from 'react';
import { meetsRequiredTier } from '@shared/constants/entitlement';

// Session storage key prefix for page entry modal tracking
const PAGE_ENTRY_MODAL_PREFIX = 'llmAccess_pageEntry_';

// TICKET_518: localStorage key for BYOK setup dialog dismiss tracking
const BYOK_SETUP_DISMISSED_KEY = 'StratCraft_byok_setup_dismissed';

// =============================================================================
// Types
// =============================================================================

export interface LLMAccessResult {
  allowed: boolean;
  source: 'platform' | 'byok' | 'none';
  reason: 'platform_key' | 'byok_configured' | 'no_key' | 'default_provider' | 'no_provider_configured' | 'selected_provider_not_configured';
  requiresBYOK: boolean;
  userTier: string | null;
  configuredProvider?: string;
}

export interface UseLLMAccessOptions {
  /** Callback when user wants to open settings (tab param for direct LLM tab navigation) */
  onOpenSettings?: (tab?: string) => void;
  /** Callback when user wants to upgrade */
  onUpgrade?: () => void;
  /** Callback when user wants to login */
  onLogin?: () => void;
  /** Current LLM provider (to determine if PRO_CATALOG/platform or BYOK) */
  llmProvider?: string;
  /** Check access on mount and show prompt once per session (Layer 2) */
  checkOnMount?: boolean;
  /** Page identifier for session tracking (required if checkOnMount is true) */
  pageId?: string;
}

export interface UseLLMAccessReturn {
  /** Check LLM access before performing action */
  checkAccess: () => Promise<boolean>;
  /** Current access result (from last check) */
  accessResult: LLMAccessResult | null;
  /** Whether the API key prompt is showing */
  showPrompt: boolean;
  /** TICKET_518: Whether the BYOK setup dialog is showing */
  showSetupDialog: boolean;
  /** User tier from last check */
  userTier: string | null;
  /** Close the prompt */
  closePrompt: () => void;
  /** TICKET_518: Close the BYOK setup dialog (dismiss with localStorage flag) */
  closeSetupDialog: () => void;
  /** TICKET_518: Called after setup dialog saves config successfully; re-checks access */
  onSetupComplete: () => Promise<boolean>;
  /** Open settings (to configure API key) */
  openSettings: () => void;
  /** Trigger upgrade flow */
  triggerUpgrade: () => void;
  /** Trigger login flow */
  triggerLogin: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useLLMAccess(options: UseLLMAccessOptions = {}): UseLLMAccessReturn {
  const {
    onOpenSettings,
    onUpgrade,
    onLogin,
    llmProvider = 'PRO_CATALOG',
    checkOnMount = false,
    pageId,
  } = options;

  const [accessResult, setAccessResult] = useState<LLMAccessResult | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [userTier, setUserTier] = useState<string | null>(null);

  /**
   * Layer 2: Check access on page mount (one-time per session)
   * Shows prompt immediately when entering the page, but only once per session.
   */
  useEffect(() => {
    if (!checkOnMount || !pageId) return;

    const sessionKey = `${PAGE_ENTRY_MODAL_PREFIX}${pageId}`;
    const alreadyShown = sessionStorage.getItem(sessionKey);

    if (alreadyShown === 'true') {
      console.log(`[useLLMAccess] Page entry modal already shown for ${pageId}`);
      return;
    }

    const checkOnPageEntry = async () => {
      try {
        const response = await window.electronAPI.entitlement.canAccessLLMFeatures();
        if (!response.success || !response.data) {
          return;
        }

        const result = response.data;
        setAccessResult(result);
        setUserTier(result.userTier);

        // Determine if prompt should be shown
        let shouldShowPrompt = false;

        // PRO/GOLD users don't need prompt
        if (meetsRequiredTier(result.userTier, 'pro')) {
          console.log(`[useLLMAccess] PRO/GOLD user - no page entry prompt for ${pageId}`);
          return;
        }

        // TICKET_566: Check BYOK first - if any BYOK key is configured, no prompt needed
        if (result.source === 'byok') {
          console.log(`[useLLMAccess] BYOK configured - no page entry prompt for ${pageId}`);
          return;
        }

        // PRO_CATALOG provider: Guest/Free users need setup
        if (llmProvider === 'PRO_CATALOG') {
          if (result.userTier === null || result.userTier === 'free') {
            shouldShowPrompt = true;
          }
        } else {
          // Non-PRO_CATALOG: Need BYOK configured
          shouldShowPrompt = true;
        }

        if (shouldShowPrompt) {
          sessionStorage.setItem(sessionKey, 'true');

          // TICKET_518: Show setup dialog if not previously dismissed
          const isDismissed = localStorage.getItem(BYOK_SETUP_DISMISSED_KEY) === 'true';
          if (!isDismissed) {
            console.log(`[useLLMAccess] Showing BYOK setup dialog for ${pageId}`);
            setShowSetupDialog(true);
          } else {
            console.log(`[useLLMAccess] Showing page entry prompt for ${pageId}`);
            setShowPrompt(true);
          }
        }
      } catch (error) {
        console.error('[E:AUTH:ACCESS_CHECK_MOUNT_FAILED] [useLLMAccess] Error checking on mount:', error);
      }
    };

    checkOnPageEntry();
  }, [checkOnMount, pageId, llmProvider]);

  /**
   * Check LLM access before performing an action.
   * Returns true if access is allowed, false if prompt is shown.
   *
   * Logic:
   * - NONA provider: Requires user to be logged in (uses backend proxy)
   * - Other providers: Requires BYOK key configured OR user logged in as PRO/GOLD
   */
  const checkAccess = useCallback(async (): Promise<boolean> => {
    console.log(`[useLLMAccess] checkAccess() called, llmProvider=${llmProvider}`);
    try {
      // TICKET_705: Pass selected provider for provider-specific key validation
      const response = await window.electronAPI.entitlement.canAccessLLMFeatures(llmProvider);

      if (!response.success || !response.data) {
        console.error('[E:AUTH:ACCESS_CHECK_FAILED] [useLLMAccess] Failed to check access:', response.error);
        // On error, allow action (fail-open for better UX)
        console.log('[useLLMAccess] DECISION: fail-open -> true');
        return true;
      }

      const result = response.data;
      setAccessResult(result);
      setUserTier(result.userTier);

      console.log('[useLLMAccess] Access check result:', JSON.stringify(result), 'provider:', llmProvider);

      // Case 1: PRO/GOLD users always have access (platform key)
      if (meetsRequiredTier(result.userTier, 'pro')) {
        console.log('[useLLMAccess] DECISION: PRO/GOLD -> true');
        return true;
      }

      // TICKET_566: Case 2: BYOK configured - access granted regardless of provider setting
      if (result.source === 'byok' && result.reason === 'byok_configured') {
        console.log('[useLLMAccess] DECISION: BYOK configured -> true');
        return true;
      }

      // TICKET_705: Case 2b: BYOK exists but selected provider has no key
      if (result.source === 'byok' && result.reason === 'selected_provider_not_configured') {
        console.log(`[useLLMAccess] DECISION: Selected provider ${llmProvider} not configured -> false (showing dialog)`);
        const isDismissed = localStorage.getItem(BYOK_SETUP_DISMISSED_KEY) === 'true';
        if (!isDismissed) {
          setShowSetupDialog(true);
        } else {
          setShowPrompt(true);
        }
        return false;
      }

      // Case 3: Using PRO_CATALOG provider - requires login (backend proxy)
      if (llmProvider === 'PRO_CATALOG') {
        // Guest (null) or Free users need to login to use PRO_CATALOG
        if (result.userTier === null || result.userTier === 'free') {
          console.log(`[useLLMAccess] DECISION: PRO_CATALOG + guest/free (tier=${result.userTier}) -> false (showing dialog)`);
          // TICKET_518: Show setup dialog if not previously dismissed
          const isDismissed = localStorage.getItem(BYOK_SETUP_DISMISSED_KEY) === 'true';
          if (!isDismissed) {
            setShowSetupDialog(true);
          } else {
            setShowPrompt(true);
          }
          return false;
        }
        console.log(`[useLLMAccess] DECISION: PRO_CATALOG + authenticated (tier=${result.userTier}) -> true`);
        return true;
      }

      // Case 4: No BYOK configured for non-PRO_CATALOG provider
      console.log(`[useLLMAccess] DECISION: No BYOK for provider ${llmProvider} -> false (showing dialog)`);
      // TICKET_518: Show setup dialog if not previously dismissed
      const isDismissed = localStorage.getItem(BYOK_SETUP_DISMISSED_KEY) === 'true';
      if (!isDismissed) {
        setShowSetupDialog(true);
      } else {
        setShowPrompt(true);
      }
      return false;
    } catch (error) {
      console.error('[E:AUTH:ACCESS_CHECK_EXCEPTION] [useLLMAccess] Exception checking access:', error);
      // Fail-open
      console.log('[useLLMAccess] DECISION: exception fail-open -> true');
      return true;
    }
  }, [llmProvider]);

  const closePrompt = useCallback(() => {
    setShowPrompt(false);
  }, []);

  // TICKET_518: Dismiss setup dialog and set localStorage flag
  const closeSetupDialog = useCallback(() => {
    setShowSetupDialog(false);
    localStorage.setItem(BYOK_SETUP_DISMISSED_KEY, 'true');
    console.log('[useLLMAccess] BYOK setup dialog dismissed');
  }, []);

  // TICKET_518: Called after setup dialog successfully saves config
  const onSetupComplete = useCallback(async (): Promise<boolean> => {
    setShowSetupDialog(false);
    console.log('[useLLMAccess] BYOK setup completed, re-checking access...');
    // Re-run access check to verify the new configuration
    try {
      const response = await window.electronAPI.entitlement.canAccessLLMFeatures();
      if (!response.success || !response.data) {
        return false;
      }
      const result = response.data;
      setAccessResult(result);
      setUserTier(result.userTier);
      if (result.source === 'byok' || meetsRequiredTier(result.userTier, 'pro')) {
        console.log('[useLLMAccess] Post-setup access granted');
        return true;
      }
      return false;
    } catch (error) {
      console.error('[E:AUTH:POST_SETUP_CHECK_FAILED] [useLLMAccess] Post-setup access check failed:', error);
      return false;
    }
  }, []);

  const openSettings = useCallback(() => {
    setShowPrompt(false);
    onOpenSettings?.('llm');
  }, [onOpenSettings]);

  const triggerUpgrade = useCallback(() => {
    setShowPrompt(false);
    onUpgrade?.();
  }, [onUpgrade]);

  const triggerLogin = useCallback(() => {
    setShowPrompt(false);
    onLogin?.();
  }, [onLogin]);

  return {
    checkAccess,
    accessResult,
    showPrompt,
    showSetupDialog,
    userTier,
    closePrompt,
    closeSetupDialog,
    onSetupComplete,
    openSettings,
    triggerUpgrade,
    triggerLogin,
  };
}

export default useLLMAccess;
