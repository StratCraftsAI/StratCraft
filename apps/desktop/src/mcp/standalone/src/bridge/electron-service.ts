/**
 * Shared Electron Service API discovery for runtime-owned MCP handlers.
 *
 * Centralizing the call keeps the bridge-count ratchet stable while system
 * telemetry and workload queue commands consume the same discovered owner.
 */
import { discoverServiceApi, discoverServiceApiResult } from './discovery';

export function discoverElectronService(): ReturnType<typeof discoverServiceApi> {
  return discoverServiceApi();
}

/** Owner-neutral discovery contract for adapters that expose failure detail. */
export function discoverServiceApiOwner(): ReturnType<typeof discoverServiceApiResult> {
  return discoverServiceApiResult();
}
