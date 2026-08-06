/**
 * Electron adapter for the shared BYOK model fetcher.
 *
 * Provider endpoints, response filtering, cache behavior, and custom-endpoint
 * normalization belong to @StratCraft/llm-providers. Electron supplies only
 * its credential store, user-data directory, and logger.
 */

import path from 'node:path';
import { app } from 'electron';
import {
  createByokModelFetcher,
  formatModelName,
  OLLAMA_DEFAULT_BASE_URL,
  type BYOKModel,
  type ByokModelFetcher,
} from '@StratCraft/llm-providers';
import { getSecureCredentialService, HOST_PLUGIN_ID } from './secure-credential-service';
import { appLog } from '../utils/logger';

export type { BYOKModel };
export { formatModelName, OLLAMA_DEFAULT_BASE_URL };

let fetcher: ByokModelFetcher | null = null;

function getFetcher(): ByokModelFetcher {
  if (!fetcher) {
    fetcher = createByokModelFetcher({
      getSecretValue: async (secretKey) => {
        const result = await getSecureCredentialService().getSecret(HOST_PLUGIN_ID, secretKey);
        return result.success ? result.value ?? null : null;
      },
      cacheDir: path.join(app.getPath('userData'), 'byok-model-cache'),
      log: {
        info: message => appLog.info(message),
        warn: message => appLog.warn(message),
        error: message => appLog.error(message),
        debug: message => appLog.debug(message),
      },
    });
  }
  return fetcher;
}

export function fetchBYOKModels(
  providerId: string,
  forceRefresh = false,
): Promise<BYOKModel[]> {
  return getFetcher().fetchModels(providerId, forceRefresh);
}

export function invalidateBYOKModelCache(providerId: string): void {
  getFetcher().invalidate(providerId);
}

export function invalidateAllBYOKModelCaches(): void {
  getFetcher().invalidateAll();
}

export function getSupportedBYOKProviders(): string[] {
  return getFetcher().supportedProviders();
}

export function testOllamaConnection(baseUrl?: string): Promise<boolean> {
  return getFetcher().testOllamaConnection(baseUrl);
}
