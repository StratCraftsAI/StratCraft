/**
 * data-provider-contributions tests
 *
 * TICKET_809_1 Phase 5 (TICKET_808).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { credentialRegistry } from '../credential-registry';
import {
  getDataProviderContributions,
  registerDataProviderContributions,
} from '../data-provider-contributions';

let validateApiKeyMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  validateApiKeyMock = vi.fn();
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      credential: {
        validateApiKey: validateApiKeyMock,
      },
    },
  };
});

afterEach(() => {
  credentialRegistry.clear();
  delete (globalThis as { window?: unknown }).window;
});

describe('getDataProviderContributions', () => {
  it('returns alpaca + alpha_vantage + polygon + tushare (TICKET_810 + TICKET_904_2)', () => {
    const ids = getDataProviderContributions().map(c => c.providerId);
    expect(ids).toEqual(['alpaca', 'alpha_vantage', 'polygon', 'tushare']);
  });

  it('alpaca is filed under the back-test plugin id, not host', () => {
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    expect(alpaca.pluginId).toBe('com.stratcraft.back-test-nexus');
  });

  it('alpaca declares both key-id and secret as required fields', () => {
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    expect(alpaca.fields.map(f => f.key)).toEqual([
      'alpaca.apiKeyId',
      'alpaca.apiSecretKey',
    ]);
    expect(alpaca.fields.every(f => f.required)).toBe(true);
  });

  it('alpaca domain is data', () => {
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    expect(alpaca.domain).toBe('data');
  });

  it('alpaca has signup URL and verifier', () => {
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    expect(alpaca.signupUrl).toMatch(/^https:\/\//);
    expect(typeof alpaca.verify).toBe('function');
  });
});

describe('alpaca verify', () => {
  it('combines keyId and secret into the composite "keyId:secret" string', async () => {
    validateApiKeyMock.mockResolvedValue({
      success: true,
      data: { valid: true, provider: 'ALPACA', keyType: 'paper' },
    });

    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    const result = await alpaca.verify!({
      'alpaca.apiKeyId': 'PK123',
      'alpaca.apiSecretKey': 'SECRET',
    });
    expect(validateApiKeyMock).toHaveBeenCalledWith('ALPACA', 'PK123:SECRET');
    expect(result.ok).toBe(true);
  });

  it('returns ok=false when either field is missing', async () => {
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    expect(
      (await alpaca.verify!({ 'alpaca.apiKeyId': 'PK' })).ok,
    ).toBe(false);
    expect(
      (await alpaca.verify!({ 'alpaca.apiSecretKey': 'SEC' })).ok,
    ).toBe(false);
    expect((await alpaca.verify!({})).ok).toBe(false);
  });

  it('surfaces validator-reported invalid as ok=false with the error message', async () => {
    validateApiKeyMock.mockResolvedValue({
        success: true,
        data: { valid: false, error: 'bad keys', errorCode: 'AUTH_FAILED', provider: 'ALPACA' },
      });
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    const r = await alpaca.verify!({
      'alpaca.apiKeyId': 'X',
      'alpaca.apiSecretKey': 'Y',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('bad keys');
    }
  });

  it('returns ok=false with raised message when IPC throws', async () => {
    validateApiKeyMock.mockRejectedValue(new Error('net down'));
    const alpaca = getDataProviderContributions().find(c => c.providerId === 'alpaca')!;
    const r = await alpaca.verify!({
      'alpaca.apiKeyId': 'X',
      'alpaca.apiSecretKey': 'Y',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('net down');
    }
  });
});

describe('registerDataProviderContributions', () => {
  it('registers alpaca + alpha_vantage + polygon + tushare on the shared registry (TICKET_810 + TICKET_904_2)', () => {
    expect(credentialRegistry.size()).toBe(0);
    registerDataProviderContributions();
    expect(credentialRegistry.has('alpaca')).toBe(true);
    expect(credentialRegistry.has('alpha_vantage')).toBe(true);
    expect(credentialRegistry.has('polygon')).toBe(true);
    expect(credentialRegistry.has('tushare')).toBe(true);
    expect(credentialRegistry.getByDomain('data')).toHaveLength(4);
  });

  it('is idempotent', () => {
    registerDataProviderContributions();
    const before = credentialRegistry.size();
    expect(() => registerDataProviderContributions()).not.toThrow();
    expect(credentialRegistry.size()).toBe(before);
  });
});

// =============================================================================
// TICKET_810: Alpha Vantage + Polygon
// =============================================================================

describe('alpha_vantage contribution', () => {
  it('is filed under the back-test plugin id and data domain', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    expect(c.pluginId).toBe('com.stratcraft.back-test-nexus');
    expect(c.domain).toBe('data');
  });

  it('declares a single required password field at alphaVantage.apiKey', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    expect(c.fields).toHaveLength(1);
    expect(c.fields[0].key).toBe('alphaVantage.apiKey');
    expect(c.fields[0].required).toBe(true);
    expect(c.fields[0].inputType).toBe('password');
  });

  it('points at the canonical signup URL', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    expect(c.signupUrl).toBe('https://www.alphavantage.co/support/#api-key');
  });

  it('exposes a verifier that passes the single key through to the validator', async () => {
    const validateMock = vi.fn().mockResolvedValue({
      success: true,
      data: { valid: true, provider: 'ALPHA_VANTAGE' },
    });
    (window.electronAPI as unknown as { credential: { validateApiKey: typeof validateMock } }).credential.validateApiKey = validateMock;

    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    const result = await c.verify!({ 'alphaVantage.apiKey': 'TESTKEY123' });

    expect(validateMock).toHaveBeenCalledWith('ALPHA_VANTAGE', 'TESTKEY123');
    expect(result.ok).toBe(true);
  });

  it('returns ok=false when the key field is missing', async () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    expect((await c.verify!({})).ok).toBe(false);
  });

  it('surfaces validator-reported invalid as ok=false with the error message', async () => {
    (window.electronAPI as unknown as { credential: { validateApiKey: ReturnType<typeof vi.fn> } }).credential.validateApiKey = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: { valid: false, error: 'Invalid API call', errorCode: 'AUTH_FAILED', provider: 'ALPHA_VANTAGE' },
      });
    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    const r = await c.verify!({ 'alphaVantage.apiKey': 'bad' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Invalid API call');
    }
  });

  it('returns ok=false with raised message when IPC throws', async () => {
    (window.electronAPI as unknown as { credential: { validateApiKey: ReturnType<typeof vi.fn> } }).credential.validateApiKey = vi
      .fn()
      .mockRejectedValue(new Error('net down'));
    const c = getDataProviderContributions().find(c => c.providerId === 'alpha_vantage')!;
    const r = await c.verify!({ 'alphaVantage.apiKey': 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('net down');
    }
  });
});

describe('polygon contribution', () => {
  it('is filed under the back-test plugin id and data domain', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'polygon')!;
    expect(c.pluginId).toBe('com.stratcraft.back-test-nexus');
    expect(c.domain).toBe('data');
  });

  it('declares a single required password field at polygon.apiKey', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'polygon')!;
    expect(c.fields).toHaveLength(1);
    expect(c.fields[0].key).toBe('polygon.apiKey');
    expect(c.fields[0].required).toBe(true);
    expect(c.fields[0].inputType).toBe('password');
  });

  it('points at the canonical signup URL', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'polygon')!;
    expect(c.signupUrl).toBe('https://polygon.io/dashboard/api-keys');
  });

  it('exposes a verifier that passes the single key through to the validator', async () => {
    const validateMock = vi.fn().mockResolvedValue({
      success: true,
      data: { valid: true, provider: 'POLYGON' },
    });
    (window.electronAPI as unknown as { credential: { validateApiKey: typeof validateMock } }).credential.validateApiKey = validateMock;

    const c = getDataProviderContributions().find(c => c.providerId === 'polygon')!;
    const result = await c.verify!({ 'polygon.apiKey': 'pk_live_xxx' });

    expect(validateMock).toHaveBeenCalledWith('POLYGON', 'pk_live_xxx');
    expect(result.ok).toBe(true);
  });

  it('returns ok=false when the key field is missing', async () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'polygon')!;
    expect((await c.verify!({})).ok).toBe(false);
  });

  it('surfaces validator-reported invalid as ok=false with the error message', async () => {
    (window.electronAPI as unknown as { credential: { validateApiKey: ReturnType<typeof vi.fn> } }).credential.validateApiKey = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: { valid: false, error: 'Invalid API key or unauthorized', errorCode: 'AUTH_FAILED', provider: 'POLYGON' },
      });
    const c = getDataProviderContributions().find(c => c.providerId === 'polygon')!;
    const r = await c.verify!({ 'polygon.apiKey': 'bad' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Invalid API key or unauthorized');
    }
  });
});

// =============================================================================
// TICKET_904_2: Tushare Pro
// =============================================================================

describe('tushare contribution', () => {
  it('is filed under the back-test plugin id and data domain', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    expect(c.pluginId).toBe('com.stratcraft.back-test-nexus');
    expect(c.domain).toBe('data');
  });

  it('declares a single required password field at tushare.apiToken', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    expect(c.fields).toHaveLength(1);
    expect(c.fields[0].key).toBe('tushare.apiToken');
    expect(c.fields[0].required).toBe(true);
    expect(c.fields[0].inputType).toBe('password');
  });

  it('points at the canonical signup URL', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    expect(c.signupUrl).toBe('https://tushare.pro/register');
  });

  it('does NOT set byokDefaultDomain (china a-share, not us_equity)', () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    expect(c.byokDefaultDomain).toBeUndefined();
  });

  it('exposes a verifier that passes the single key through to the validator', async () => {
    const validateMock = vi.fn().mockResolvedValue({
      success: true,
      data: { valid: true, provider: 'TUSHARE' },
    });
    (window.electronAPI as unknown as { credential: { validateApiKey: typeof validateMock } }).credential.validateApiKey = validateMock;

    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    const result = await c.verify!({ 'tushare.apiToken': 'my-token-123' });

    expect(validateMock).toHaveBeenCalledWith('TUSHARE', 'my-token-123');
    expect(result.ok).toBe(true);
  });

  it('returns ok=false when the key field is missing', async () => {
    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    expect((await c.verify!({})).ok).toBe(false);
  });

  it('surfaces validator-reported invalid as ok=false with the error message', async () => {
    (window.electronAPI as unknown as { credential: { validateApiKey: ReturnType<typeof vi.fn> } }).credential.validateApiKey = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: { valid: false, error: 'Invalid token', errorCode: 'AUTH_FAILED', provider: 'TUSHARE' },
      });
    const c = getDataProviderContributions().find(c => c.providerId === 'tushare')!;
    const r = await c.verify!({ 'tushare.apiToken': 'bad' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Invalid token');
    }
  });
});
