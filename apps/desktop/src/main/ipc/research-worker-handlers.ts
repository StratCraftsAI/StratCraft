/**
 * Public capability-discovery IPC for the commercial worker boundary.
 */

import { ipcMain } from 'electron';
import { RESEARCH_WORKER_CHANNELS } from '../../shared/constants/channels';
import { createLogger } from '../utils/logger';
import {
  getResearchWorkerSupervisor,
  type ResearchWorkerSupervisor,
} from '../services/research-worker-supervisor';
import { getResearchWorkerPackageLifecycle } from '../services/research-worker-package-lifecycle';

const log = createLogger('RESEARCH-WORKER-IPC');

export function registerResearchWorkerHandlers(
  supervisor: Pick<ResearchWorkerSupervisor, 'discover'> = getResearchWorkerSupervisor(),
): void {
  ipcMain.handle(RESEARCH_WORKER_CHANNELS.DISCOVER, async () => {
    try {
      return await supervisor.discover();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Commercial worker discovery failed:', error);
      return {
        state: 'error' as const,
        code: 'WORKER_REQUEST_INVALID' as const,
        message,
        remediation: 'Repair StratCraft or reinstall Quant Lab, then retry discovery.',
      };
    }
  });

  if (process.env.NODE_ENV === 'test') {
    ipcMain.handle('e2e:worker:install', async (_event, sourceRoot: string) => {
      try {
        await getResearchWorkerPackageLifecycle().installFromDirectory(sourceRoot);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    ipcMain.handle('e2e:worker:uninstall', async () => {
      try {
        await getResearchWorkerPackageLifecycle().uninstall();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }
}
