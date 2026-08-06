/**
 * useOnboarding Hook (TICKET_593)
 *
 * Manages onboarding state and driver.js tour lifecycle.
 * Fetches state from IPC on mount, provides tour control API.
 *
 * StratCraftsAI theme applied to driver.js popover via CSS custom properties.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { TOUR_REGISTRY } from '@/config/onboarding-tours';

// ============================================================================
// Types
// ============================================================================

interface OnboardingState {
  enabled: boolean;
  completedTours: string[];
}

interface UseOnboardingReturn {
  enabled: boolean;
  loading: boolean;
  startTour: (tourId: string) => void;
  toggle: () => Promise<void>;
  isCompleted: (tourId: string) => boolean;
  reset: () => Promise<void>;
}

// ============================================================================
// StratCraftsAI Theme for driver.js
// ============================================================================

const STRATCRAFT_DRIVER_CONFIG = {
  animate: true,
  overlayColor: 'rgba(0, 0, 0, 0.75)',
  stagePadding: 8,
  stageRadius: 8,
  popoverClass: 'stratcraft-onboarding-popover',
  showProgress: true,
  allowClose: true,
  overlayOpacity: 0.75,
} as const;

// ============================================================================
// Hook
// ============================================================================

export function useOnboarding(): UseOnboardingReturn {
  const { t } = useTranslation();
  const [state, setState] = useState<OnboardingState>({ enabled: true, completedTours: [] });
  const [loading, setLoading] = useState(true);
  const driverRef = useRef<Driver | null>(null);

  // Fetch state from main process on mount
  useEffect(() => {
    window.electronAPI.onboarding.getState()
      .then((result) => {
        if (result.success && result.state) {
          setState({ enabled: result.state.enabled, completedTours: result.state.completedTours });
        }
      })
      .catch((error) => {
        console.error('[E:ONBOARDING:FETCH_STATE_FAILED] Failed to fetch state:', error);
      })
      .finally(() => setLoading(false));
  }, []);

  // Cleanup driver instance on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  const startTour = useCallback((tourId: string) => {
    const tourDef = TOUR_REGISTRY[tourId];
    if (!tourDef) {
      console.warn(`[W:ONBOARDING:TOUR_NOT_FOUND] Tour not found: ${tourId}`);
      return;
    }

    // Destroy previous driver instance if any
    if (driverRef.current) {
      driverRef.current.destroy();
    }

    const steps = tourDef.steps(t);

    const driverInstance = driver({
      ...STRATCRAFT_DRIVER_CONFIG,
      steps,
      nextBtnText: t('ui:onboarding.controls.next'),
      prevBtnText: t('ui:onboarding.controls.prev'),
      doneBtnText: t('ui:onboarding.controls.done'),
      progressText: t('ui:onboarding.controls.progress'),
      onDestroyed: () => {
        // Mark tour completed when driver is destroyed (finished or closed)
        window.electronAPI.onboarding.markCompleted(tourId)
          .then((result) => {
            if (result.success && result.state) {
              setState({ enabled: result.state.enabled, completedTours: result.state.completedTours });
            }
          })
          .catch((error) => {
            console.error('[E:ONBOARDING:MARK_COMPLETED_FAILED] Failed to mark tour completed:', error);
          });
        driverRef.current = null;
      },
    });

    driverRef.current = driverInstance;
    driverInstance.drive();
  }, [t]);

  const toggle = useCallback(async () => {
    const newEnabled = !state.enabled;
    try {
      const result = await window.electronAPI.onboarding.setEnabled(newEnabled);
      if (result.success && result.state) {
        setState({ enabled: result.state.enabled, completedTours: result.state.completedTours });
      }
    } catch (error) {
      console.error('[E:ONBOARDING:TOGGLE_FAILED] Failed to toggle:', error);
    }
  }, [state.enabled]);

  const isCompleted = useCallback((tourId: string) => {
    return state.completedTours.includes(tourId);
  }, [state.completedTours]);

  const reset = useCallback(async () => {
    try {
      const result = await window.electronAPI.onboarding.reset();
      if (result.success && result.state) {
        setState({ enabled: result.state.enabled, completedTours: result.state.completedTours });
      }
    } catch (error) {
      console.error('[E:ONBOARDING:RESET_FAILED] Failed to reset:', error);
    }
  }, []);

  return {
    enabled: state.enabled,
    loading,
    startTour,
    toggle,
    isCompleted,
    reset,
  };
}
