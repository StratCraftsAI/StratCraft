/**
 * Strategy-related IPC handlers
 *
 * @see TICKET_217: Builder API Token Authentication
 * @see TICKET_1306_4 (D4/D5): list/get/delete are core LOCAL operations. Per
 *   the ticket's authoritative-data-path decision, the renderer surface stops
 *   using backend REST as the owner of these operations and delegates to the
 *   same local Service API layer (`strategy-api.ts`) that the MCP surface and
 *   the loopback Service API use -- all three route through the single
 *   Electron-free owner in `@StratCraft/strategy-persistence-store`
 *   (TICKET_435/638: core strategy CRUD works offline, without a server).
 */

import { ipcMain } from 'electron';
import { STRATEGY_CHANNELS, API_CONFIG } from '@shared/constants';
import type { Strategy } from '@shared/types';
import { authenticatedJsonFetch } from '../utils/api-request';
import * as strategyApi from '../services/api/local-strategy-api';

export function registerStrategyHandlers(): void {
  // Get strategy list -- local owner (TICKET_1306_4 D4).
  ipcMain.handle(STRATEGY_CHANNELS.LIST, async () => {
    const result = await strategyApi.listStrategies();
    return result.success
      ? result
      : { success: false, error: result.error ?? 'MSG_STRATEGY_ERROR', data: [] };
  });

  // Get single strategy -- local owner (TICKET_1306_4 D4).
  ipcMain.handle(STRATEGY_CHANNELS.GET, async (_, id: string) => {
    return strategyApi.getStrategy(Number(id));
  });

  // Save strategy -- workspace-file save via backend (NOT a nona_algorithms
  // CRUD op; out of TICKET_1306_4 D4/D5/D6 scope, retained on REST).
  ipcMain.handle(STRATEGY_CHANNELS.SAVE, async (_, strategy: Partial<Strategy>) => {
    try {
      const method = strategy.id ? 'PUT' : 'POST';
      const url = strategy.id
        ? `${API_CONFIG.BASE_URL}/strategy/${strategy.id}`
        : `${API_CONFIG.BASE_URL}/strategy`;

      // TICKET_217: Use authenticated fetch with token
      return await authenticatedJsonFetch(url, {
        method,
        body: JSON.stringify(strategy),
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'MSG_STRATEGY_ERROR',
      };
    }
  });

  // Soft-delete strategy -- single local owner (TICKET_1306_4 D5).
  ipcMain.handle(STRATEGY_CHANNELS.DELETE, async (_, id: string) => {
    const result = await strategyApi.deleteStrategy({ id: Number(id) });
    return result.success
      ? { success: true }
      : { success: false, error: result.error ?? 'MSG_STRATEGY_ERROR' };
  });
}
