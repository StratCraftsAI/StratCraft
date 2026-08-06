/**
 * TICKET_1265_6 D6: network trust boundary for the MCP Streamable HTTP server.
 *
 * Before this ticket the server bound `0.0.0.0` with `Access-Control-Allow-Origin: *`,
 * and the (accidental) only barrier between the LAN and destructive local tools
 * was the bearer gate. D1 removes that gate from local tools, so the trust
 * boundary MUST move to the network layer in the same change set:
 *
 *   - Default bind is loopback (`127.0.0.1`) -- the webui (:7790) and the
 *     desktop app are same-host, so nothing legitimate breaks.
 *   - CORS `*` is replaced by an allowlist derived from the webui origin(s).
 *   - LAN exposure (`--host <non-loopback>` / MCP_HTTP_HOST) is an explicit
 *     opt-in and, when enabled, requires a locally-issued pairing token
 *     (X-Pairing-Token) -- NOT a stratcraft.ai identity.
 */

import crypto from 'crypto';
import { WEB_DASHBOARD_PORT, MCP_STREAMABLE_HTTP_PORT } from './constants';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * The exact browser origins the MCP server accepts. Two topologies, both
 * loopback-only:
 *   - DEV: the webui is a separate Vite server on :7790, so its loopback
 *     spellings are allowed (the dev proxy forwards /mcp to :7789).
 *   - PROD single-origin (TICKET_1289_1 F2): the MCP server ALSO serves the SPA
 *     on its own port :7789, so the SPA's same-origin /mcp fetch carries
 *     `Origin: http://{127.0.0.1,localhost}:7789` -- those must be allowed too,
 *     or the served SPA cannot call its own backend.
 * Everything else is refused. When LAN exposure is enabled we additionally
 * reflect the request Origin only if it carries a valid pairing token (checked
 * separately), so this stays a strict loopback allowlist.
 */
export function allowedOrigins(): ReadonlySet<string> {
  return new Set([
    `http://127.0.0.1:${WEB_DASHBOARD_PORT}`,
    `http://localhost:${WEB_DASHBOARD_PORT}`,
    `http://127.0.0.1:${MCP_STREAMABLE_HTTP_PORT}`,
    `http://localhost:${MCP_STREAMABLE_HTTP_PORT}`,
  ]);
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request Origin.
 * Returns the reflected origin when allowed, or null when it must be refused.
 * A request with no Origin header (non-browser client: MCP CLI, tests) is
 * allowed through with null (no CORS header needed).
 */
export function resolveAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return allowedOrigins().has(origin) ? origin : null;
}

/**
 * A browser request (has an Origin header) whose Origin is not on the
 * allowlist must be refused at the CORS layer, not by a per-tool gate.
 */
export function isOriginRefused(origin: string | undefined): boolean {
  if (!origin) return false; // non-browser client
  return resolveAllowedOrigin(origin) === null;
}

/** Mint a locally-issued pairing token for LAN-exposed topology. */
export function mintPairingToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Constant-time comparison of a presented pairing token against the expected
 * one. Returns false on any length/format mismatch.
 */
export function pairingTokenMatches(expected: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
