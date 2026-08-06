/**
 * TICKET_992_7: nona_server direct connection config.
 *
 * Resolves the nona_server URL and auth token from environment variables,
 * allowing MCP standalone to call nona_server without Electron.
 *
 * TICKET_1229: resolution reports WHICH source supplied the URL, and a
 * startup health-check verifies the target actually is nona_server. A stale
 * NONA_SERVER_URL pointing at the WordPress auth server produced bare
 * "HTTP 503" fallbacks twice (TICKET_1212, TICKET_1229) because nothing
 * validated or even printed the resolved target.
 */

import {
  DESKTOP_API_BASE_URL,
  API_NONA_HEALTH,
  NONA_SERVER_HEALTH_SERVICE,
  NONA_HEALTH_CHECK_TIMEOUT_MS,
} from './constants';

export type NonaServerUrlSource = 'NONA_SERVER_URL' | 'DESKTOP_API_URL' | 'default';

export interface NonaServerConfig {
  baseUrl: string;
  authToken: string | null;
  baseUrlSource: NonaServerUrlSource;
}

export function resolveNonaServer(): NonaServerConfig {
  const authToken = process.env.STRATCRAFT_AUTH_TOKEN || null;

  if (process.env.NONA_SERVER_URL) {
    return { baseUrl: process.env.NONA_SERVER_URL, authToken, baseUrlSource: 'NONA_SERVER_URL' };
  }
  if (process.env.DESKTOP_API_URL) {
    return { baseUrl: process.env.DESKTOP_API_URL, authToken, baseUrlSource: 'DESKTOP_API_URL' };
  }
  return { baseUrl: DESKTOP_API_BASE_URL, authToken, baseUrlSource: 'default' };
}

export function describeUrlSource(source: NonaServerUrlSource): string {
  return source === 'default' ? 'built-in default' : `${source} env`;
}

export interface NonaServerHealthVerdict {
  ok: boolean;
  detail: string;
}

let lastHealthVerdict: NonaServerHealthVerdict | null = null;

/** Last health-check verdict, for error attribution in Tier 2 failures. */
export function getNonaServerHealthVerdict(): NonaServerHealthVerdict | null {
  return lastHealthVerdict;
}

export function resetNonaServerHealthVerdict(): void {
  lastHealthVerdict = null;
}

/**
 * Verify the configured base URL actually serves nona_server by checking the
 * /health signature. Wrong targets (e.g. the WordPress auth server) either
 * fail the request or answer without `service: main_service`.
 */
export async function validateNonaServerTarget(
  config: NonaServerConfig,
  timeoutMs: number = NONA_HEALTH_CHECK_TIMEOUT_MS,
): Promise<NonaServerHealthVerdict> {
  const url = `${config.baseUrl}${API_NONA_HEALTH}`;
  const sourceNote = `source: ${describeUrlSource(config.baseUrlSource)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      lastHealthVerdict = { ok: false, detail: `HTTP ${response.status} from ${url} (${sourceNote})` };
      return lastHealthVerdict;
    }

    let service: string | undefined;
    try {
      service = ((await response.json()) as { service?: string }).service;
    } catch {
      lastHealthVerdict = { ok: false, detail: `${url} returned non-JSON health response -- not nona_server (${sourceNote})` };
      return lastHealthVerdict;
    }

    if (service !== NONA_SERVER_HEALTH_SERVICE) {
      lastHealthVerdict = { ok: false, detail: `${url} reports service '${service ?? 'unknown'}', expected '${NONA_SERVER_HEALTH_SERVICE}' -- wrong server (${sourceNote})` };
      return lastHealthVerdict;
    }

    lastHealthVerdict = { ok: true, detail: `${url} healthy (service: ${service}, ${sourceNote})` };
    return lastHealthVerdict;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastHealthVerdict = { ok: false, detail: `${url} unreachable: ${message} (${sourceNote})` };
    return lastHealthVerdict;
  } finally {
    clearTimeout(timer);
  }
}
