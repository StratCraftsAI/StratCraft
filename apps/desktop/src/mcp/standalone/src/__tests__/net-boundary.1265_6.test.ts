/**
 * TICKET_1265_6 D6: network trust boundary.
 *
 * The bearer gate is no longer the (accidental) LAN barrier for local tools,
 * so the boundary lives at the network layer: loopback-default bind, a strict
 * webui-origin CORS allowlist, and a locally-issued pairing token for opt-in
 * LAN exposure.
 */
import { describe, it, expect } from 'vitest';
import {
  isLoopbackHost,
  allowedOrigins,
  resolveAllowedOrigin,
  isOriginRefused,
  mintPairingToken,
  pairingTokenMatches,
} from '../net-boundary';
import { WEB_DASHBOARD_PORT, MCP_HTTP_DEFAULT_HOST, MCP_STREAMABLE_HTTP_PORT } from '../constants';

describe('net-boundary loopback detection', () => {
  it('treats 127.0.0.1 / ::1 / localhost as loopback', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
  });

  it('treats a routable address as non-loopback (LAN exposure)', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.20')).toBe(false);
  });

  it('the default bind host is loopback', () => {
    expect(isLoopbackHost(MCP_HTTP_DEFAULT_HOST)).toBe(true);
  });
});

describe('CORS origin allowlist', () => {
  it('allows both loopback spellings of the webui origin', () => {
    const origins = allowedOrigins();
    expect(origins.has(`http://127.0.0.1:${WEB_DASHBOARD_PORT}`)).toBe(true);
    expect(origins.has(`http://localhost:${WEB_DASHBOARD_PORT}`)).toBe(true);
  });

  it('TICKET_1289_1 F2: allows the MCP own-port origin for single-origin prod SPA', () => {
    // In production the SPA is served from the MCP port itself, so its
    // same-origin /mcp fetch carries Origin: http://{127.0.0.1,localhost}:7789.
    const origins = allowedOrigins();
    expect(origins.has(`http://127.0.0.1:${MCP_STREAMABLE_HTTP_PORT}`)).toBe(true);
    expect(origins.has(`http://localhost:${MCP_STREAMABLE_HTTP_PORT}`)).toBe(true);
    expect(isOriginRefused(`http://127.0.0.1:${MCP_STREAMABLE_HTTP_PORT}`)).toBe(false);
  });

  it('reflects an allowed origin and refuses everything else', () => {
    const ok = `http://127.0.0.1:${WEB_DASHBOARD_PORT}`;
    expect(resolveAllowedOrigin(ok)).toBe(ok);
    expect(resolveAllowedOrigin('http://evil.example.com')).toBeNull();
    expect(resolveAllowedOrigin(`http://192.168.1.20:${WEB_DASHBOARD_PORT}`)).toBeNull();
  });

  it('a browser request from a non-allowlisted origin is refused', () => {
    expect(isOriginRefused('http://evil.example.com')).toBe(true);
    expect(isOriginRefused(`http://127.0.0.1:${WEB_DASHBOARD_PORT}`)).toBe(false);
  });

  it('a non-browser request (no Origin) is not refused (MCP CLI / tests)', () => {
    expect(isOriginRefused(undefined)).toBe(false);
    expect(resolveAllowedOrigin(undefined)).toBeNull();
  });
});

describe('LAN pairing token', () => {
  it('mints a non-trivial hex token', () => {
    const token = mintPairingToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches only the exact token (constant-time)', () => {
    const token = mintPairingToken();
    expect(pairingTokenMatches(token, token)).toBe(true);
    expect(pairingTokenMatches(token, undefined)).toBe(false);
    expect(pairingTokenMatches(token, '')).toBe(false);
    // Flip the final hex digit to a value it cannot already hold, otherwise a
    // token that happens to end in the substituted digit reconstructs itself
    // and this assertion silently tests equality instead of mismatch.
    const lastDigit = token.slice(-1);
    expect(pairingTokenMatches(token, token.slice(0, -1) + (lastDigit === '0' ? '1' : '0'))).toBe(false);
    // length mismatch must not throw (timingSafeEqual requires equal length)
    expect(pairingTokenMatches(token, 'short')).toBe(false);
  });
});
