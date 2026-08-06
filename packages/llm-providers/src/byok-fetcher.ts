/**
 * BYOK Model Fetcher core -- TICKET_646_1 Phase 2, relocated (TICKET_1276
 * P0b) from apps/desktop/src/main/services/byok-model-fetcher.ts so the
 * Electron main process and the MCP standalone server run the SAME fetch,
 * filtering, and cache logic. Process-specific concerns are injected:
 * credential reads (secure-store), the cache directory (userData), and the
 * logger.
 *
 * Cache strategy (unchanged):
 * - In-memory cache per provider (fast path)
 * - Disk cache per provider at {cacheDir}/byok-models-{providerId}.json
 * - 24h TTL; invalidated on key change/deletion/manual refresh
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LLM_PROVIDER_RECORDS,
  LLM_API_BASE_OPENAI,
  LLM_API_BASE_CLAUDE,
  LLM_API_BASE_GEMINI,
  LLM_API_BASE_DEEPSEEK,
  LLM_API_BASE_GROK,
  LLM_API_BASE_QWEN,
  LLM_API_BASE_LINO,
  LLM_API_BASE_OLLAMA_DEFAULT,
  LLM_PROVIDER_OPENAI_COMPATIBLE,
  LLM_PROVIDER_OLLAMA,
  LLM_CREDENTIAL_KEYS,
  getProviderRecord,
} from '@StratCraft/types';
import type { ProviderLogger } from './logger';

// =============================================================================
// Types
// =============================================================================

export interface BYOKModel {
  id: string;
  name: string;
}

interface CacheEnvelope {
  timestamp: number;
  models: BYOKModel[];
}

export interface ByokFetcherDeps {
  /** Resolve the stored secret (API key / base URL) for a provider secretKey. */
  getSecretValue(secretKey: string): Promise<string | null>;
  /** Directory holding the per-provider disk cache files. */
  cacheDir: string;
  log: ProviderLogger;
}

export interface ByokModelFetcher {
  fetchModels(providerId: string, forceRefresh?: boolean): Promise<BYOKModel[]>;
  storeModels(providerId: string, models: BYOKModel[]): Promise<void>;
  invalidate(providerId: string): void;
  invalidateAll(): void;
  supportedProviders(): string[];
  testOllamaConnection(baseUrl?: string): Promise<boolean>;
}

export type LlmCredentialValidationErrorCode =
  | 'invalid_format'
  | 'auth_failed'
  | 'timeout'
  | 'network_error'
  | 'provider_unavailable';

export class LlmCredentialValidationError extends Error {
  constructor(
    readonly code: LlmCredentialValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmCredentialValidationError';
  }
}

export interface LlmCredentialValues {
  primary: string;
  extra?: Readonly<Record<string, string>>;
}

// =============================================================================
// Constants
// =============================================================================

/** 24 hours in milliseconds */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** HTTP request timeout for provider model APIs (10s) */
const FETCH_TIMEOUT_MS = 10_000;

/** TICKET_696: Default Ollama server URL (TICKET_1265_5: shared constant). */
export const OLLAMA_DEFAULT_BASE_URL = LLM_API_BASE_OLLAMA_DEFAULT;

/**
 * OpenAI chat-capable model ID prefixes.
 * Excludes embedding, whisper, dall-e, tts, etc.
 */
const OPENAI_CHAT_PREFIXES = ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-'];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert a model ID like "claude-4-5-sonnet-latest" to a human-readable
 * display name "Claude 4 5 Sonnet Latest". Best-effort; providers with
 * display_name in their API response will use that instead.
 */
export function formatModelName(modelId: string): string {
  return modelId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function throwModelApiError(response: Response, _label: string): Promise<never> {
  let message = `HTTP ${response.status}`;
  try {
    const body = await response.json() as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof body.error?.message === 'string') message = body.error.message;
    else if (typeof body.message === 'string') message = body.message;
  } catch {
    // Preserve the status-only message for non-JSON provider responses.
  }
  throw new LlmCredentialValidationError(
    response.status === 401 || response.status === 403
      ? 'auth_failed'
      : 'provider_unavailable',
    message,
  );
}

// =============================================================================
// Provider-specific fetch functions
// =============================================================================

async function fetchOpenAIModels(apiKey: string, signal: AbortSignal): Promise<BYOKModel[]> {
  const resp = await fetch(`${LLM_API_BASE_OPENAI}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (resp.status === 429) return [];
  if (!resp.ok) {
    return throwModelApiError(resp, 'OpenAI models API');
  }
  const json = await resp.json() as { data: Array<{ id: string }> };
  return (json.data || [])
    .filter(m => OPENAI_CHAT_PREFIXES.some(prefix => m.id.startsWith(prefix)))
    .map(m => ({ id: m.id, name: formatModelName(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchAnthropicModels(apiKey: string, signal: AbortSignal): Promise<BYOKModel[]> {
  const resp = await fetch(`${LLM_API_BASE_CLAUDE}/v1/models`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
  });
  if (resp.status === 429) return [];
  if (!resp.ok) {
    return throwModelApiError(resp, 'Anthropic models API');
  }
  const json = await resp.json() as { data: Array<{ id: string; display_name?: string }> };
  return (json.data || [])
    .map(m => ({ id: m.id, name: m.display_name || formatModelName(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchGeminiModels(apiKey: string, signal: AbortSignal): Promise<BYOKModel[]> {
  const url = `${LLM_API_BASE_GEMINI}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, { signal });
  if (resp.status === 429) return [];
  if (!resp.ok) {
    return throwModelApiError(resp, 'Gemini models API');
  }
  const json = await resp.json() as {
    models: Array<{
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (json.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => {
      // name is "models/gemini-2.5-flash" -- extract model ID
      const id = m.name.replace(/^models\//, '');
      return { id, name: m.displayName || formatModelName(id) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<BYOKModel[]> {
  const resp = await fetch(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (resp.status === 429) return [];
  if (!resp.ok) {
    return throwModelApiError(resp, `Models API at ${baseUrl}`);
  }
  const json = await resp.json() as { data: Array<{ id: string }> };
  return (json.data || [])
    .map(m => ({ id: m.id, name: formatModelName(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const LINO_CHAT_PREFIXES = [
  'gpt-', 'chatgpt-', 'o1', 'o3', 'o4', 'claude-', 'deepseek-',
  'gemini-', 'qwen', 'grok-', 'llama-', 'llama3', 'mistral-', 'glm-',
  'kimi', 'moonshot-', 'doubao-', 'yi-', 'minimax', 'hunyuan-',
  'ernie-', 'step-',
] as const;

async function fetchLinoModels(apiKey: string, signal: AbortSignal): Promise<BYOKModel[]> {
  const models = await fetchOpenAICompatibleModels(LLM_API_BASE_LINO, apiKey, signal);
  return models.sort((a, b) => {
    const aChat = LINO_CHAT_PREFIXES.some(prefix => a.id.startsWith(prefix));
    const bChat = LINO_CHAT_PREFIXES.some(prefix => b.id.startsWith(prefix));
    return Number(bChat) - Number(aChat) || a.id.localeCompare(b.id);
  });
}

/**
 * TICKET_1266: normalize a user-supplied OpenAI-compatible base URL to the
 * canonical `.../v1` form. Strips trailing slashes and appends `/v1` when
 * absent, so `https://api.example.com`, `https://api.example.com/`, and
 * `https://api.example.com/v1` all resolve to `https://api.example.com/v1`.
 * Same normalization the agent loop's endpoint resolver applies, so discovery
 * and inference hit the identical host.
 */
export function normalizeOpenAICompatibleBaseUrl(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

/**
 * Enforce the custom-endpoint policy shared by Desktop and Guide WebUI:
 * HTTPS is required except for loopback development endpoints.
 */
export function validateOpenAICompatibleBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new LlmCredentialValidationError('invalid_format', 'The base URL is not a valid URL');
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new LlmCredentialValidationError(
      'invalid_format',
      'The base URL must use HTTPS unless it targets localhost',
    );
  }
  return normalizeOpenAICompatibleBaseUrl(parsed.toString());
}

/**
 * TICKET_1266: discover models from a user-supplied OpenAI-compatible endpoint.
 * The base URL is already normalized to `.../v1`, so the models path is
 * `{baseUrl}/models`. No prefix filtering -- relay endpoints (LinoAPI,
 * OpenRouter, ...) expose arbitrary model names; the dual-layer curation
 * intersection in resolve.ts filters the noise.
 */
async function fetchOpenAICompatibleCustomModels(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<BYOKModel[]> {
  const resp = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (resp.status === 429) return [];
  if (!resp.ok) {
    return throwModelApiError(resp, `Custom endpoint models API at ${baseUrl}`);
  }
  const json = await resp.json() as { data: Array<{ id: string }> };
  return (json.data || [])
    .map(m => ({ id: m.id, name: formatModelName(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchOllamaModels(baseUrl: string, signal: AbortSignal): Promise<BYOKModel[]> {
  // Primary: Ollama native endpoint
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal });
    if (resp.ok) {
      const json = await resp.json() as {
        models: Array<{ name: string; model: string; modified_at?: string }>;
      };
      if (json.models && json.models.length > 0) {
        return json.models
          .map(m => ({ id: m.name, name: formatModelName(m.name.split(':')[0]) }))
          .sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  } catch {
    // Fall through to OpenAI-compatible endpoint
  }

  // Fallback: OpenAI-compatible endpoint
  const resp = await fetch(`${baseUrl}/v1/models`, { signal });
  if (resp.status === 429) return [];
  if (!resp.ok) {
    return throwModelApiError(resp, `Ollama API at ${baseUrl}`);
  }
  const json = await resp.json() as { data: Array<{ id: string }> };
  return (json.data || [])
    .map(m => ({ id: m.id, name: formatModelName(m.id.split(':')[0]) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Maps provider ID to its fetch function */
const PROVIDER_FETCHERS: Record<string, (apiKey: string, signal: AbortSignal) => Promise<BYOKModel[]>> = {
  OPENAI: fetchOpenAIModels,
  CLAUDE: fetchAnthropicModels,
  GEMINI: fetchGeminiModels,
  DEEPSEEK: (key, signal) => fetchOpenAICompatibleModels(LLM_API_BASE_DEEPSEEK, key, signal),
  GROK: (key, signal) => fetchOpenAICompatibleModels(LLM_API_BASE_GROK, key, signal),
  QWEN: (key, signal) => fetchOpenAICompatibleModels(`${LLM_API_BASE_QWEN}/compatible-mode`, key, signal),
  LINO: fetchLinoModels,
  // TICKET_696: Ollama uses base URL (stored in secretKey field) instead of API key
  OLLAMA: (baseUrl, signal) => fetchOllamaModels(baseUrl, signal),
};

/**
 * Validate unsaved provider credentials and return the models discovered by
 * the same provider-specific implementation used after persistence. This is
 * intentionally strict: unlike the cached runtime fetcher it never falls back
 * to stale models, because a Settings validation result must describe the
 * submitted values.
 */
export async function discoverByokModels(
  providerId: string,
  credentials: LlmCredentialValues,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<BYOKModel[]> {
  const record = getProviderRecord(providerId);
  if (!record) {
    throw new LlmCredentialValidationError('invalid_format', `Unknown LLM provider '${providerId}'`);
  }

  const primary = credentials.primary.trim();
  if (record.credential.required && primary.length === 0) {
    throw new LlmCredentialValidationError('invalid_format', 'A credential value is required');
  }

  let fetcher = PROVIDER_FETCHERS[record.id];
  let fetchValue = primary;
  if (record.id === LLM_PROVIDER_OLLAMA) {
    fetchValue = primary || OLLAMA_DEFAULT_BASE_URL;
  } else if (record.id === LLM_PROVIDER_OPENAI_COMPATIBLE) {
    const baseUrl = credentials.extra?.[LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL]?.trim();
    if (!baseUrl) {
      throw new LlmCredentialValidationError('invalid_format', 'A base URL is required');
    }
    const normalized = validateOpenAICompatibleBaseUrl(baseUrl);
    fetcher = (key, signal) => fetchOpenAICompatibleCustomModels(normalized, key, signal);
  }
  if (!fetcher) {
    throw new LlmCredentialValidationError(
      'provider_unavailable',
      `Model discovery is not available for provider '${providerId}'`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(fetchValue, controller.signal);
  } catch (reason) {
    if (reason instanceof LlmCredentialValidationError) throw reason;
    if (reason instanceof Error && reason.name === 'AbortError') {
      throw new LlmCredentialValidationError('timeout', 'Provider validation timed out');
    }
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/\b(?:401|403)\b/.test(message)) {
      throw new LlmCredentialValidationError('auth_failed', 'The provider rejected the credential');
    }
    if (/\b(?:404|5\d\d)\b/.test(message)) {
      throw new LlmCredentialValidationError('provider_unavailable', message);
    }
    throw new LlmCredentialValidationError('network_error', message);
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createByokModelFetcher(deps: ByokFetcherDeps): ByokModelFetcher {
  const { getSecretValue, cacheDir, log } = deps;

  /** In-memory cache: providerId -> CacheEnvelope */
  const memoryCache = new Map<string, CacheEnvelope>();

  function getCachePath(providerId: string): string {
    return path.join(cacheDir, `byok-models-${providerId.toLowerCase()}.json`);
  }

  function isCacheValid(envelope: CacheEnvelope): boolean {
    return Date.now() - envelope.timestamp < CACHE_TTL_MS;
  }

  async function readDiskCache(providerId: string): Promise<CacheEnvelope | null> {
    const filePath = getCachePath(providerId);
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as CacheEnvelope;
      if (typeof parsed.timestamp === 'number' && Array.isArray(parsed.models)) {
        return parsed;
      }
      return null;
    } catch (error) {
      log.warn(`[BYOKModelFetcher] Failed to read disk cache for ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function writeDiskCache(providerId: string, models: BYOKModel[]): Promise<void> {
    const finalPath = getCachePath(providerId);
    const tmpPath = `${finalPath}.tmp`;
    const envelope: CacheEnvelope = {
      timestamp: Date.now(),
      models,
    };
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(tmpPath, JSON.stringify(envelope), 'utf-8');
      await fs.promises.rename(tmpPath, finalPath);
      memoryCache.set(providerId, envelope);
      log.debug(`[BYOKModelFetcher] Disk cache written for ${providerId}: ${models.length} models`);
    } catch (error) {
      log.warn(`[BYOKModelFetcher] Failed to write disk cache for ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
      // Best-effort cleanup
      try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
    }
  }

  async function getBYOKApiKey(providerId: string): Promise<string | null> {
    const record = LLM_PROVIDER_RECORDS.find(p => p.id === providerId);
    if (!record || !record.secretKey) {
      return null;
    }
    return getSecretValue(record.secretKey);
  }

  return {
    async fetchModels(providerId: string, forceRefresh = false): Promise<BYOKModel[]> {
      // Check in-memory cache first
      if (!forceRefresh) {
        const memCached = memoryCache.get(providerId);
        if (memCached && isCacheValid(memCached)) {
          return memCached.models;
        }
        // Check disk cache
        const diskCached = await readDiskCache(providerId);
        if (diskCached && isCacheValid(diskCached)) {
          memoryCache.set(providerId, diskCached);
          return diskCached.models;
        }
      }

      // Resolve API key (or base URL for local providers like Ollama)
      let apiKey = await getBYOKApiKey(providerId);
      if (!apiKey) {
        // TICKET_696: Ollama defaults to localhost when no URL is configured
        if (providerId === 'OLLAMA') {
          apiKey = OLLAMA_DEFAULT_BASE_URL;
        } else {
          log.debug(`[BYOKModelFetcher] No BYOK key for ${providerId}, returning empty`);
          return [];
        }
      }

      // TICKET_1266: OPENAI_COMPATIBLE resolves a SECOND credential (the base
      // URL) that the shared fetcher map cannot express (its signature is
      // apiKey-only). Without a stored base URL the provider is not usable --
      // return empty rather than guessing a host.
      let fetcher = PROVIDER_FETCHERS[providerId];
      if (providerId === LLM_PROVIDER_OPENAI_COMPATIBLE) {
        const rawBaseUrl = await getSecretValue(LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL);
        if (!rawBaseUrl) {
          log.debug(`[BYOKModelFetcher] No base URL for ${providerId}, returning empty`);
          return [];
        }
        const baseUrl = normalizeOpenAICompatibleBaseUrl(rawBaseUrl);
        fetcher = (key, signal) => fetchOpenAICompatibleCustomModels(baseUrl, key, signal);
      }

      // Find fetcher
      if (!fetcher) {
        log.warn(`[BYOKModelFetcher] No fetcher implemented for ${providerId}`);
        return [];
      }

      // Fetch from provider API
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const models = await fetcher(apiKey, controller.signal);
        log.info(`[BYOKModelFetcher] Fetched ${models.length} models from ${providerId}`);
        await writeDiskCache(providerId, models);
        return models;
      } catch (error) {
        log.warn(`[BYOKModelFetcher] Failed to fetch models from ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
        // Fall back to expired cache if available
        const staleCache = memoryCache.get(providerId) || await readDiskCache(providerId);
        if (staleCache) {
          log.info(`[BYOKModelFetcher] Using stale cache for ${providerId} (${staleCache.models.length} models)`);
          return staleCache.models;
        }
        return [];
      } finally {
        clearTimeout(timer);
      }
    },

    async storeModels(providerId: string, models: BYOKModel[]): Promise<void> {
      await writeDiskCache(providerId, models);
    },

    invalidate(providerId: string): void {
      memoryCache.delete(providerId);
      const filePath = getCachePath(providerId);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          log.debug(`[BYOKModelFetcher] Cache invalidated for ${providerId}`);
        }
      } catch (error) {
        log.warn(`[BYOKModelFetcher] Failed to delete disk cache for ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    invalidateAll(): void {
      for (const record of LLM_PROVIDER_RECORDS) {
        if (record.secretKey) {
          this.invalidate(record.id);
        }
      }
    },

    supportedProviders(): string[] {
      // TICKET_1266: OPENAI_COMPATIBLE is fetched via a base-URL-resolving
      // special case in fetchModels(), not the apiKey-only PROVIDER_FETCHERS
      // map, so surface it explicitly.
      return [...Object.keys(PROVIDER_FETCHERS), LLM_PROVIDER_OPENAI_COMPATIBLE];
    },

    async testOllamaConnection(baseUrl?: string): Promise<boolean> {
      const url = baseUrl || OLLAMA_DEFAULT_BASE_URL;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        return resp.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
