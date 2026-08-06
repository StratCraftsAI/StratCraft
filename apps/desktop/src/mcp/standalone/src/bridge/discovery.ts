/**
 * Service API Discovery
 *
 * TICKET_425: Unified Service API Layer
 * TICKET_425_1: Fix discovery path to match http-server.ts write location.
 *
 * Locates the Service API runtime owner by reading discovery files
 * (api-port, api-token) written by http-server.ts.
 *
 * Uses resolveDbPath() from db.ts to derive the data directory,
 * ensuring discovery files are found in the same location as the database.
 */

import fs from 'fs';
import path from 'path';
import { resolveDiscoveryDir } from '../db';

const SERVICE_API_PORT_FILE = 'api-port';
const SERVICE_API_TOKEN_FILE = 'api-token';

export interface ServiceApiConfig {
  baseUrl: string;
  token: string;
}

export type ServiceApiInvalidEvidenceReason =
  | 'incomplete_files'
  | 'invalid_port'
  | 'empty_token'
  | 'read_failed';

export type ServiceApiDiscoveryFailure = {
  status: 'missing_evidence';
  code: 'service_api_discovery_missing';
  message: string;
} | {
  status: 'invalid_evidence';
  code: 'service_api_discovery_invalid';
  reason: ServiceApiInvalidEvidenceReason;
  message: string;
};

export type ServiceApiDiscoveryResult = {
  status: 'available';
  config: ServiceApiConfig;
} | ServiceApiDiscoveryFailure;

const MISSING_EVIDENCE_MESSAGE =
  'No Service API runtime owner published discovery evidence.';

function invalidEvidence(
  reason: ServiceApiInvalidEvidenceReason,
  message: string,
): ServiceApiDiscoveryFailure {
  return {
    status: 'invalid_evidence',
    code: 'service_api_discovery_invalid',
    reason,
    message,
  };
}

/**
 * Return the owner-neutral discovery state without collapsing actionable file
 * failures into "Electron is not running". Both Electron Main and the
 * headless serve runtime publish the same evidence and may own the role.
 */
export function discoverServiceApiResult(): ServiceApiDiscoveryResult {
  let dataDir: string;
  try {
    dataDir = resolveDiscoveryDir();
  } catch (error) {
    return invalidEvidence(
      'read_failed',
      `Cannot resolve the Service API discovery directory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const portFile = path.join(dataDir, SERVICE_API_PORT_FILE);
  const tokenFile = path.join(dataDir, SERVICE_API_TOKEN_FILE);
  let hasPort: boolean;
  let hasToken: boolean;
  try {
    hasPort = fs.existsSync(portFile);
    hasToken = fs.existsSync(tokenFile);
  } catch (error) {
    return invalidEvidence(
      'read_failed',
      `Cannot inspect Service API discovery evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!hasPort && !hasToken) {
    return {
      status: 'missing_evidence',
      code: 'service_api_discovery_missing',
      message: MISSING_EVIDENCE_MESSAGE,
    };
  }
  if (!hasPort || !hasToken) {
    return invalidEvidence(
      'incomplete_files',
      'Service API discovery evidence is incomplete; both api-port and api-token are required.',
    );
  }

  let port: string;
  let token: string;
  try {
    port = fs.readFileSync(portFile, 'utf-8').trim();
    token = fs.readFileSync(tokenFile, 'utf-8').trim();
  } catch (error) {
    return invalidEvidence(
      'read_failed',
      `Cannot read Service API discovery evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsedPort = Number(port);
  if (!/^\d+$/.test(port) || parsedPort < 1 || parsedPort > 65535) {
    return invalidEvidence(
      'invalid_port',
      'Service API discovery evidence contains an invalid api-port value.',
    );
  }
  if (!token) {
    return invalidEvidence(
      'empty_token',
      'Service API discovery evidence contains an empty api-token value.',
    );
  }

  return {
    status: 'available',
    config: {
      baseUrl: `http://127.0.0.1:${parsedPort}`,
      token,
    },
  };
}

/**
 * Discover the Service API server.
 * Derives data directory from resolveDbPath() (same logic used for DB location).
 * Compatibility adapter for existing handlers. New code that needs to report
 * why discovery failed must consume discoverServiceApiResult().
 */
export function discoverServiceApi(): ServiceApiConfig | null {
  const result = discoverServiceApiResult();
  return result.status === 'available' ? result.config : null;
}

/**
 * TICKET_1265_4: Self-heal stale discovery files.
 *
 * A Service API owner removes the discovery files on graceful shutdown, but a
 * non-graceful exit (crash, SIGKILL, OOM) leaves them pointing at a dead
 * port. Called by the API client when a connection-level failure
 * (ECONNREFUSED etc.) proves the discovered endpoint is dead, so subsequent
 * discoverServiceApi() calls return null and every handler takes its
 * standalone (!config) path.
 *
 * Deletes ONLY if the files still describe the same dead endpoint: a
 * restarted Electron rewrites them inside its listen() callback, so a port
 * mismatch means the files are fresh and must be kept.
 */
export function removeStaleDiscoveryFiles(stale: ServiceApiConfig): void {
  try {
    const dataDir = resolveDiscoveryDir();
    const portFile = path.join(dataDir, SERVICE_API_PORT_FILE);
    const tokenFile = path.join(dataDir, SERVICE_API_TOKEN_FILE);

    const currentPort = fs.readFileSync(portFile, 'utf-8').trim();
    if (`http://127.0.0.1:${currentPort}` !== stale.baseUrl) {
      return;
    }

    fs.unlinkSync(portFile);
    fs.unlinkSync(tokenFile);
    console.error(`[StratCraft MCP] Removed stale Service API discovery files (runtime owner unreachable at ${stale.baseUrl})`);
  } catch {
    // Files already gone or unreadable -- nothing to heal.
  }
}
