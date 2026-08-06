/**
 * Onboarding Store Service (TICKET_593)
 *
 * Manages in-app onboarding tour state and preferences.
 * Pattern follows consent-service.ts (lightweight electron-store instance).
 *
 * First launch: enabled=true, completedTours=[].
 * Users can toggle onboarding on/off and reset progress.
 */

import Store from 'electron-store';
import { app } from 'electron';
import { appLog } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface OnboardingState {
  enabled: boolean;
  assistantMode: boolean;
  completedTours: string[];
  timestamp: string;
  appVersion: string;
}

interface OnboardingSchema {
  onboarding: OnboardingState;
}

// ============================================================================
// Store Instance
// ============================================================================

const store = new Store<OnboardingSchema>({
  name: 'onboarding',
  schema: {
    onboarding: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        assistantMode: { type: 'boolean', default: true },
        completedTours: { type: 'array', items: { type: 'string' }, default: [] },
        timestamp: { type: 'string', default: '' },
        appVersion: { type: 'string', default: '' },
      },
      default: { enabled: true, assistantMode: true, completedTours: [], timestamp: '', appVersion: '' },
    },
  },
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Get current onboarding state.
 */
export function getOnboardingState(): OnboardingState {
  return store.get('onboarding');
}

/**
 * Set onboarding enabled/disabled.
 * Records timestamp and app version for audit trail.
 */
export function setOnboardingEnabled(enabled: boolean): OnboardingState {
  const current = store.get('onboarding');
  const state: OnboardingState = {
    ...current,
    enabled,
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
  };
  store.set('onboarding', state);
  appLog.info(`[Onboarding] Enabled set to: ${enabled}`);
  return state;
}

/**
 * Set assistant mode enabled/disabled.
 * Controls the contextual help panel visibility option.
 */
export function setAssistantMode(enabled: boolean): OnboardingState {
  const current = store.get('onboarding');
  const state: OnboardingState = {
    ...current,
    assistantMode: enabled,
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
  };
  store.set('onboarding', state);
  appLog.info(`[Onboarding] Assistant mode set to: ${enabled}`);
  return state;
}

/**
 * Mark a specific tour as completed.
 */
export function markTourCompleted(tourId: string): OnboardingState {
  const current = store.get('onboarding');
  const completedTours = current.completedTours.includes(tourId)
    ? current.completedTours
    : [...current.completedTours, tourId];
  const state: OnboardingState = {
    ...current,
    completedTours,
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
  };
  store.set('onboarding', state);
  appLog.info(`[Onboarding] Tour completed: ${tourId}`);
  return state;
}

/**
 * Reset all onboarding progress (clear completed tours, re-enable).
 */
export function resetOnboarding(): OnboardingState {
  const state: OnboardingState = {
    enabled: true,
    assistantMode: true,
    completedTours: [],
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
  };
  store.set('onboarding', state);
  appLog.info('[Onboarding] Progress reset');
  return state;
}
