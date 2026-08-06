/**
 * TICKET_992_7: Direct HTTP client for nona_server.
 *
 * Category A functions that were previously routed through the Electron bridge
 * but only need a direct HTTP POST to nona_server. No Electron dependency.
 *
 * Auth: Bearer token from STRATCRAFT_AUTH_TOKEN env var, or BYOK passthrough
 * (user's own API key in request body, per TICKET_435).
 */

import type { NonaServerConfig } from './nona-server-config';
import {
  API_START_MARKET_REGIME,
  API_CHECK_MARKET_REGIME,
  API_VIBING_CHAT,
  API_CHECK_VIBING_CHAT,
} from '@StratCraft/types';
import {
  MCP_REQUEST_TIMEOUT_MS,
  MCP_GENERATION_TIMEOUT_MS,
  MCP_GENERATION_POLL_INTERVAL_MS,
  API_STRATEGY_GENERATE_ENTRY,
  API_STRATEGY_GENERATE_EXIT,
  API_STRATEGY_GENERATE_KRONOS,
  API_STRATEGY_GENERATE_AI_LIBERO,
  API_PERSONA_LIST,
  API_ANONYMOUS_REGISTER,
} from './constants';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** TICKET_1232 F3: HTTP status of a non-ok response, so callers can
   * classify auth failures (401) structurally instead of parsing error text. */
  status?: number;
  /**
   * TICKET_1376 RC1: machine code the backend attached to a failed task
   * (e.g. `CODE_GENERATION_ERROR`). Preserved alongside the prose `error` so
   * callers classify structurally instead of parsing the message -- the same
   * rationale as `status`. Previously discarded here, which is why the Guide
   * WebUI surface had nothing to resolve and rendered `payload=malformed`.
   * Validated against the shared whitelist at the point of use, never trusted
   * as a display string.
   */
  errorCode?: string;
}

function extractApiErrorMessage(
  body: Record<string, unknown>,
  fallback: string,
): string {
  const data = body.data && typeof body.data === 'object'
    ? body.data as Record<string, unknown>
    : undefined;
  const result = data?.result && typeof data.result === 'object'
    ? data.result as Record<string, unknown>
    : undefined;
  const nestedError = result?.error && typeof result.error === 'object'
    ? result.error as Record<string, unknown>
    : undefined;
  const directError = body.error && typeof body.error === 'object'
    ? body.error as Record<string, unknown>
    : undefined;
  const candidates = [
    body.error_message,
    typeof body.error === 'string' ? body.error : undefined,
    body.message,
    body.detail,
    directError?.error_message,
    directError?.message,
    nestedError?.error_message,
    nestedError?.message,
  ];
  return candidates.find((value): value is string =>
    typeof value === 'string' && value.length > 0) ?? fallback;
}

// ── Install Token (anonymous quota tracking) ────────────────────────

let installToken: string | null = null;
let installTokenPromise: Promise<void> | null = null;

async function ensureInstallToken(config: NonaServerConfig): Promise<void> {
  if (installToken) return;
  if (installTokenPromise) { await installTokenPromise; return; }

  installTokenPromise = (async () => {
    const registerUrl = `${config.baseUrl}${API_ANONYMOUS_REGISTER}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mcp-standalone' },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { install_token?: string };
        if (data.install_token && typeof data.install_token === 'string') {
          installToken = data.install_token;
        }
      } else {
        // Non-fatal but never silent (TICKET_1229): a wrong base URL surfaces
        // here first -- attribute it so the target is identifiable from logs.
        console.error(`[MCP] Install token registration failed: HTTP ${res.status} from ${registerUrl}`);
      }
    } catch (error) {
      // Non-fatal: anonymous requests will fail at auth but won't crash
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MCP] Install token registration error: ${message} (${registerUrl})`);
    } finally {
      clearTimeout(timer);
      installTokenPromise = null;
    }
  })();

  await installTokenPromise;
}

async function request<T>(
  config: NonaServerConfig,
  path: string,
  body: Record<string, unknown> = {},
  timeoutMs: number = MCP_REQUEST_TIMEOUT_MS,
): Promise<ApiResponse<T>> {
  if (!config.authToken) {
    await ensureInstallToken(config);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Type': 'mcp-standalone',
    };
    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`;
    }
    if (installToken) {
      headers['X-Install-Token'] = installToken;
    }

    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      // TICKET_1229: always attribute the target URL. A non-JSON error body
      // means the responder is NOT nona_server (its errors are structured
      // JSON) -- without the URL, a wrong target shows an unattributable
      // bare status code (TICKET_1212 / TICKET_1229 incidents).
      let errMsg = `HTTP ${response.status} from ${config.baseUrl}${path}`;
      try {
        const body = await response.json() as Record<string, unknown>;
        errMsg = extractApiErrorMessage(body, errMsg);
      } catch { /* non-JSON body: keep URL-attributed message */ }
      return { success: false, error: errMsg, status: response.status };
    }

    return await response.json() as ApiResponse<T>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `${message} (${config.baseUrl}${path})` };
  } finally {
    clearTimeout(timer);
  }
}

// ── Strategy Generation ─────────────────────────────────────────────

export async function generateStrategy(
  config: NonaServerConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  const started = await request<Record<string, unknown>>(
    config,
    API_START_MARKET_REGIME,
    params,
    MCP_GENERATION_TIMEOUT_MS,
  );
  if (!started.success) return started;

  const taskId = started.data?.task_id;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return {
      success: false,
      error: 'Strategy generation start response did not contain a task_id.',
    };
  }

  const TRANSIENT_STATUSES = new Set([502, 503, 504]);
  const MAX_TRANSIENT_RETRIES = 5;
  let transientRetries = 0;

  const deadline = Date.now() + MCP_GENERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, MCP_GENERATION_POLL_INTERVAL_MS));

    const polled = await request<Record<string, unknown>>(
      config,
      API_CHECK_MARKET_REGIME,
      { task_id: taskId, locale: params.locale },
    );
    if (!polled.success) {
      if (polled.status && TRANSIENT_STATUSES.has(polled.status) && transientRetries < MAX_TRANSIENT_RETRIES) {
        transientRetries++;
        console.error(`[MCP] Transient HTTP ${polled.status} on poll ${transientRetries}/${MAX_TRANSIENT_RETRIES} for task '${taskId}', retrying`);
        continue;
      }
      return polled;
    }
    transientRetries = 0;

    const status = polled.data?.status as string | undefined;
    if (status === 'completed') {
      const result = polled.data?.result;
      if (!result || typeof result !== 'object') {
        return {
          success: false,
          error: `Strategy generation task '${taskId}' completed without a result.`,
        };
      }
      return { success: true, data: result };
    }
    if (status === 'failed' || status === 'rejected') {
      const result = polled.data?.result as Record<string, unknown> | undefined;
      const error = result?.error as Record<string, unknown> | string | undefined;
      const reason = result?.reason_code as string | undefined;
      const errMsg = typeof error === 'string'
        ? error
        : (error as { error_message?: string } | undefined)?.error_message
          ?? (polled.data?.error as string | undefined)
          ?? reason
          ?? `Strategy generation task '${taskId}' ${status}.`;
      return { success: false, error: errMsg };
    }
  }

  return {
    success: false,
    error: `Strategy generation task '${taskId}' did not complete within ${MCP_GENERATION_TIMEOUT_MS / 1000}s.`,
  };
}

export async function generateEntrySignal(
  config: NonaServerConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_GENERATE_ENTRY, params, MCP_GENERATION_TIMEOUT_MS);
}

export async function generateExitStrategy(
  config: NonaServerConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_GENERATE_EXIT, params, MCP_GENERATION_TIMEOUT_MS);
}

export async function generateKronosStrategy(
  config: NonaServerConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_GENERATE_KRONOS, params, MCP_GENERATION_TIMEOUT_MS);
}

export async function generateAILiberoStrategy(
  config: NonaServerConfig,
  params: Record<string, unknown>,
): Promise<ApiResponse> {
  return request(config, API_STRATEGY_GENERATE_AI_LIBERO, params, MCP_GENERATION_TIMEOUT_MS);
}

/**
 * Execute one authoritative Vibing Chat turn.
 *
 * TICKET_1315: AI Studio session routes are Electron Service API routes and
 * must never be sent to nona_server. The standalone MCP can, however, call the
 * real nona_server owner directly: start at /api/vibing_chat and poll
 * /api/check_vibing_chat_status. This keeps Guide authoring independent of an
 * Electron process while preserving the Plan-scoped bearer in `config`.
 */
export async function executeVibingChat(
  config: NonaServerConfig,
  params: Record<string, unknown>,
  recoverAuthToken?: (rejectedToken: string) => Promise<string>,
): Promise<ApiResponse<Record<string, unknown>>> {
  let activeConfig = config;
  let authRecovered = false;
  let started = await request<Record<string, unknown>>(
    config,
    API_VIBING_CHAT,
    params,
    MCP_GENERATION_TIMEOUT_MS,
  );
  if (
    started.status === 401
    && config.authToken
    && recoverAuthToken
  ) {
    const recoveredToken = await recoverAuthToken(config.authToken);
    activeConfig = { ...config, authToken: recoveredToken };
    authRecovered = true;
    started = await request<Record<string, unknown>>(
      activeConfig,
      API_VIBING_CHAT,
      params,
      MCP_GENERATION_TIMEOUT_MS,
    );
  }
  if (started.success === false) return started;

  const startEnvelope = started as ApiResponse<Record<string, unknown>>
    & Record<string, unknown>;
  const startData = (
    started.data && typeof started.data === 'object'
      ? started.data
      : startEnvelope
  ) as Record<string, unknown>;
  if (startData.status === 'completed') {
    const result = startData.result;
    if (result && typeof result === 'object') {
      return { success: true, data: result as Record<string, unknown> };
    }
  }

  const taskId = (
    typeof startEnvelope.task_id === 'string'
      ? startEnvelope.task_id
      : typeof startData.task_id === 'string'
        ? startData.task_id
        : params.task_id
  );
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return {
      success: false,
      error: 'Vibing Chat start response did not contain a task_id.',
    };
  }

  const transientStatuses = new Set([502, 503, 504]);
  const maxTransientRetries = 5;
  let transientRetries = 0;
  const deadline = Date.now() + MCP_GENERATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, MCP_GENERATION_POLL_INTERVAL_MS));
    let polled = await request<Record<string, unknown>>(
      activeConfig,
      API_CHECK_VIBING_CHAT,
      { task_id: taskId },
    );
    if (
      polled.status === 401
      && activeConfig.authToken
      && recoverAuthToken
      && !authRecovered
    ) {
      const recoveredToken = await recoverAuthToken(activeConfig.authToken);
      activeConfig = { ...activeConfig, authToken: recoveredToken };
      authRecovered = true;
      polled = await request<Record<string, unknown>>(
        activeConfig,
        API_CHECK_VIBING_CHAT,
        { task_id: taskId },
      );
    }
    if (polled.success === false) {
      if (
        polled.status
        && transientStatuses.has(polled.status)
        && transientRetries < maxTransientRetries
      ) {
        transientRetries += 1;
        console.error(
          `[MCP] Transient HTTP ${polled.status} on Vibing Chat poll `
          + `${transientRetries}/${maxTransientRetries} for task '${taskId}', retrying`,
        );
        continue;
      }
      return polled;
    }
    transientRetries = 0;

    const pollEnvelope = polled as ApiResponse<Record<string, unknown>>
      & Record<string, unknown>;
    const pollData = (
      polled.data && typeof polled.data === 'object'
        ? polled.data
        : pollEnvelope
    ) as Record<string, unknown>;
    const status = (pollData.status ?? pollEnvelope.status) as string | undefined;
    const result = (pollData.result ?? pollEnvelope.result) as unknown;

    if (status === 'completed') {
      const completed = result ?? pollData;
      if (!completed || typeof completed !== 'object') {
        return {
          success: false,
          error: `Vibing Chat task '${taskId}' completed without a result.`,
        };
      }
      return { success: true, data: completed as Record<string, unknown> };
    }
    if (status === 'failed' || status === 'rejected') {
      const resultRecord = result && typeof result === 'object'
        ? result as Record<string, unknown>
        : undefined;
      const error = resultRecord?.error;
      const errorMessage = (
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).message
            ?? (error as Record<string, unknown>).error_message
          : error
      );
      return {
        success: false,
        error: typeof errorMessage === 'string'
          ? errorMessage
          : typeof pollData.error === 'string'
            ? pollData.error
            : `Vibing Chat task '${taskId}' ${status}.`,
      };
    }
  }

  return {
    success: false,
    error: `Vibing Chat task '${taskId}' did not complete within `
      + `${MCP_GENERATION_TIMEOUT_MS / 1000}s.`,
  };
}

// ── Personas ────────────────────────────────────────────────────────

export async function listPersonas(
  config: NonaServerConfig,
): Promise<ApiResponse> {
  return request(config, API_PERSONA_LIST);
}
