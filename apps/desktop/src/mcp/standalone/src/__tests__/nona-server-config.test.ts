/**
 * TICKET_992_7: Tests for nona_server config resolution.
 * TICKET_1229: URL source attribution + target health validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DESKTOP_API_BASE_URL } from '@StratCraft/types';
import {
  resolveNonaServer,
  describeUrlSource,
  validateNonaServerTarget,
  getNonaServerHealthVerdict,
  resetNonaServerHealthVerdict,
} from '../nona-server-config';

import { AUTH_TEST_BASE_URL } from './test-endpoints';

describe('resolveNonaServer', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NONA_SERVER_URL;
    delete process.env.DESKTOP_API_URL;
    delete process.env.STRATCRAFT_AUTH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns production default when no env vars set', () => {
    const config = resolveNonaServer();
    expect(config.baseUrl).toBe(DESKTOP_API_BASE_URL);
    expect(config.authToken).toBeNull();
    expect(config.baseUrlSource).toBe('default');
  });

  it('NONA_SERVER_URL takes highest priority', () => {
    process.env.NONA_SERVER_URL = 'http://localhost:20650';
    process.env.DESKTOP_API_URL = 'https://other.example.com';

    const config = resolveNonaServer();
    expect(config.baseUrl).toBe('http://localhost:20650');
    expect(config.baseUrlSource).toBe('NONA_SERVER_URL');
  });

  it('DESKTOP_API_URL is second priority', () => {
    process.env.DESKTOP_API_URL = 'https://staging.example.com';

    const config = resolveNonaServer();
    expect(config.baseUrl).toBe('https://staging.example.com');
    expect(config.baseUrlSource).toBe('DESKTOP_API_URL');
  });

  it('STRATCRAFT_AUTH_TOKEN is returned when set', () => {
    process.env.STRATCRAFT_AUTH_TOKEN = 'eyJ-test-token';

    const config = resolveNonaServer();
    expect(config.authToken).toBe('eyJ-test-token');
  });

  it('authToken is null when STRATCRAFT_AUTH_TOKEN not set', () => {
    const config = resolveNonaServer();
    expect(config.authToken).toBeNull();
  });
});

describe('describeUrlSource', () => {
  it('names env sources and the built-in default', () => {
    expect(describeUrlSource('NONA_SERVER_URL')).toBe('NONA_SERVER_URL env');
    expect(describeUrlSource('DESKTOP_API_URL')).toBe('DESKTOP_API_URL env');
    expect(describeUrlSource('default')).toBe('built-in default');
  });
});

describe('validateNonaServerTarget', () => {
  const CONFIG = {
    baseUrl: AUTH_TEST_BASE_URL,
    authToken: null,
    baseUrlSource: 'NONA_SERVER_URL' as const,
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetNonaServerHealthVerdict();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes when /health reports service main_service', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'healthy', service: 'main_service' }),
    }) as unknown as typeof fetch;

    const verdict = await validateNonaServerTarget(CONFIG);

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain(`${AUTH_TEST_BASE_URL}/health`);
    expect(verdict.detail).toContain('main_service');
    expect(getNonaServerHealthVerdict()).toEqual(verdict);
  });

  it('fails with URL and source on non-2xx health response (TICKET_1212 WordPress 503)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    }) as unknown as typeof fetch;

    const verdict = await validateNonaServerTarget(CONFIG);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain(`HTTP 503 from ${AUTH_TEST_BASE_URL}/health`);
    expect(verdict.detail).toContain('NONA_SERVER_URL env');
  });

  it('fails when health body is non-JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    }) as unknown as typeof fetch;

    const verdict = await validateNonaServerTarget(CONFIG);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('non-JSON health response');
  });

  it('fails when service signature is not main_service (wrong server)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ service: 'wordpress' }),
    }) as unknown as typeof fetch;

    const verdict = await validateNonaServerTarget(CONFIG);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("reports service 'wordpress'");
    expect(verdict.detail).toContain('wrong server');
  });

  it('fails with URL when target is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const verdict = await validateNonaServerTarget(CONFIG);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('unreachable: ECONNREFUSED');
    expect(verdict.detail).toContain(`${AUTH_TEST_BASE_URL}/health`);
  });

  it('getNonaServerHealthVerdict is null before any validation', () => {
    expect(getNonaServerHealthVerdict()).toBeNull();
  });
});
