/**
 * Onboarding IPC Handlers (TICKET_593)
 *
 * Handles onboarding state CRUD operations from renderer process.
 * Pattern follows diagnostic-handlers.ts.
 */

import { ipcMain } from 'electron';
import { ONBOARDING_CHANNELS } from '../../shared/constants/channels';
import { ipcLog } from '../utils/logger';
import {
  getOnboardingState,
  setOnboardingEnabled,
  setAssistantMode,
  markTourCompleted,
  resetOnboarding,
} from '../services/onboarding-service';

export function registerOnboardingHandlers(): void {
  // Get onboarding state
  ipcMain.handle(ONBOARDING_CHANNELS.GET_STATE, () => {
    try {
      const state = getOnboardingState();
      return { success: true, state };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to get onboarding state:', msg);
      return { success: false, error: msg };
    }
  });

  // Set onboarding enabled/disabled
  ipcMain.handle(ONBOARDING_CHANNELS.SET_ENABLED, (_event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
    try {
      const state = setOnboardingEnabled(enabled);
      return { success: true, state };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to set onboarding enabled:', msg);
      return { success: false, error: msg };
    }
  });

  // Set assistant mode enabled/disabled
  ipcMain.handle(ONBOARDING_CHANNELS.SET_ASSISTANT_MODE, (_event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
    try {
      const state = setAssistantMode(enabled);
      return { success: true, state };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to set assistant mode:', msg);
      return { success: false, error: msg };
    }
  });

  // Mark a tour as completed
  ipcMain.handle(ONBOARDING_CHANNELS.MARK_COMPLETED, (_event: Electron.IpcMainInvokeEvent, tourId: string) => {
    try {
      const state = markTourCompleted(tourId);
      return { success: true, state };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to mark tour completed:', msg);
      return { success: false, error: msg };
    }
  });

  // Reset all onboarding progress
  ipcMain.handle(ONBOARDING_CHANNELS.RESET, () => {
    try {
      const state = resetOnboarding();
      return { success: true, state };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('Failed to reset onboarding:', msg);
      return { success: false, error: msg };
    }
  });

  ipcLog.info('[TICKET_593] Onboarding handlers registered');
}
