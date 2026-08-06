/**
 * Runtime services owned by the open Desktop Base.
 *
 * Commercial operation activation and the mixed Service API are intentionally
 * absent. Installable signed packages add those capabilities through the
 * generic extension bridge after Base startup.
 */
import type { ServiceApiHost } from '@StratCraft/types';

import { appLog } from '../utils/logger';
import { initComputeEnvironment } from './compute-environment';
import { initializeCompilerResolver } from './compiler-resolver';
import { initializeBacktestQueue } from './executor-queue-service';
import { initializeDataCacheManager } from './data-cache-manager';
import { initializeDataDownloadQueue } from './data-download-queue';
import { initializeDataProviderManager } from './data-providers/provider-manager';
import { initializeAltDataProviders } from './data-providers/alt-data/bootstrap';
import { initializeDataStorageService } from './data-storage-service';

let initialized = false;

export async function initializePublicRuntimeServices(host: ServiceApiHost): Promise<void> {
  if (initialized) {
    appLog.warn('[Public Base] Runtime services already initialized; skipping');
    return;
  }

  initializeCompilerResolver();
  initializeBacktestQueue();
  initializeDataProviderManager();
  initializeAltDataProviders();
  await initializeDataCacheManager();
  initializeDataStorageService();
  initializeDataDownloadQueue({ skipRestore: host === 'headless' });
  initComputeEnvironment(() => null);
  initialized = true;
  appLog.info(`[Public Base] Runtime services initialized for host=${host}`);
}

export function shutdownPublicRuntimeServices(): void {
  initialized = false;
  appLog.info('[Public Base] Runtime services shut down');
}

export function resetPublicRuntimeServicesForTests(): void {
  initialized = false;
}
