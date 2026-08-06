/**
 * llm-contributions tests
 *
 * TICKET_809_1 Phase 4 (TICKET_809).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOST_PLUGIN_ID } from '../../../shared/types/credential-contribution';
import { credentialRegistry } from '../credential-registry';
import {
  getLlmContributions,
  registerLlmContributions,
} from '../llm-contributions';

let validateApiKeyMock: ReturnType<typeof vi.fn>;
let refreshCatalogMock: ReturnType<typeof vi.fn>;

// Mock the global window.electronAPI surface used by the contributions.
beforeEach(() => {
  validateApiKeyMock = vi.fn();
  refreshCatalogMock = vi.fn().mockResolvedValue(undefined);
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      credential: {
        validateApiKey: validateApiKeyMock,
      },
      llmCatalog: {
        refresh: refreshCatalogMock,
      },
    },
  };
});

afterEach(() => {
  credentialRegistry.clear();
  delete (globalThis as { window?: unknown }).window;
});

describe('getLlmContributions', () => {
  it('returns exactly the 9 LLM providers in canonical order', () => {
    // TICKET_1266: openaiCompatible appended after ollama.
    const ids = getLlmContributions().map(c => c.providerId);
    expect(ids).toEqual([
      'claude',
      'openai',
      'gemini',
      'deepseek',
      'grok',
      'qwen',
      'lino',
      'ollama',
      'openaiCompatible',
    ]);
  });

  it('every contribution is filed under HOST_PLUGIN_ID', () => {
    for (const c of getLlmContributions()) {
      expect(c.pluginId).toBe(HOST_PLUGIN_ID);
    }
  });

  it('every contribution has domain=llm; single-credential providers have one field, openaiCompatible has two', () => {
    for (const c of getLlmContributions()) {
      expect(c.domain).toBe('llm');
      // TICKET_1266: openaiCompatible has base URL + API key (2 fields).
      expect(c.fields).toHaveLength(c.providerId === 'openaiCompatible' ? 2 : 1);
    }
  });

  it('field keys match the existing AES-256-GCM storage keys (primary field)', () => {
    // For openaiCompatible the base URL renders first (extra field); the
    // primary API-key field is the last one (TICKET_1266).
    const byProvider = Object.fromEntries(
      getLlmContributions().map(c => [c.providerId, c.fields[c.fields.length - 1]!.key]),
    );
    expect(byProvider).toEqual({
      claude: 'llm.claude.apiKey',
      openai: 'llm.openai.apiKey',
      gemini: 'llm.gemini.apiKey',
      deepseek: 'llm.deepseek.apiKey',
      grok: 'llm.grok.apiKey',
      qwen: 'llm.qwen.apiKey',
      lino: 'llm.lino.apiKey',
      ollama: 'llm.ollama.baseUrl',
      openaiCompatible: 'llm.openaiCompatible.apiKey',
    });
  });

  it('TICKET_1266: openaiCompatible renders base URL first, then the API key', () => {
    const oc = getLlmContributions().find(c => c.providerId === 'openaiCompatible')!;
    expect(oc.fields.map(f => f.key)).toEqual([
      'llm.openaiCompatible.baseUrl',
      'llm.openaiCompatible.apiKey',
    ]);
    expect(oc.fields[0]!.inputType).toBe('url');
    expect(oc.fields[1]!.inputType).toBe('password');
    expect(oc.fields[0]!.required).toBe(true);
  });

  it('every API-key provider declares a verifier; ollama (local URL) does not', () => {
    for (const c of getLlmContributions()) {
      if (c.providerId === 'ollama') {
        expect(c.verify).toBeUndefined();
      } else {
        expect(typeof c.verify).toBe('function');
      }
    }
  });

  it('every contribution declares a postConfigureHook (catalog refresh)', () => {
    for (const c of getLlmContributions()) {
      expect(typeof c.postConfigureHook).toBe('function');
    }
  });

  it('every provider-hosted contribution has a signup URL (openaiCompatible is user-supplied, so none)', () => {
    for (const c of getLlmContributions()) {
      // TICKET_1266: openaiCompatible points at an arbitrary user endpoint, so
      // there is no single provider signup/docs URL.
      if (c.providerId === 'openaiCompatible') {
        expect(c.signupUrl).toBeUndefined();
        continue;
      }
      expect(typeof c.signupUrl).toBe('string');
      expect(c.signupUrl).toMatch(/^https?:\/\//);
    }
  });
});

describe('verify wiring', () => {
  it('passes raw API key to credential.validateApiKey and unwraps the success result', async () => {
    validateApiKeyMock.mockResolvedValue({
      success: true,
      data: { valid: true, provider: 'OPENAI' },
    });

    const openai = getLlmContributions().find(c => c.providerId === 'openai')!;
    const result = await openai.verify!({ 'llm.openai.apiKey': 'sk-XYZ' });
    // TICKET_1266: third arg is the custom base URL -- undefined for providers
    // without one.
    expect(validateApiKeyMock).toHaveBeenCalledWith('OPENAI', 'sk-XYZ', undefined);
    expect(result.ok).toBe(true);
  });

  it('TICKET_1266: openaiCompatible verify forwards baseUrl + apiKey to the validator', async () => {
    validateApiKeyMock.mockResolvedValue({
      success: true,
      data: { valid: true, provider: 'OPENAI_COMPATIBLE' },
    });

    const oc = getLlmContributions().find(c => c.providerId === 'openaiCompatible')!;
    const result = await oc.verify!({
      'llm.openaiCompatible.apiKey': 'sk-relay',
      'llm.openaiCompatible.baseUrl': 'https://api.linoapi.com/v1',
    });
    expect(validateApiKeyMock).toHaveBeenCalledWith('OPENAI_COMPATIBLE', 'sk-relay', 'https://api.linoapi.com/v1');
    expect(result.ok).toBe(true);
  });

  it('returns ok=false when the validator reports invalid', async () => {
    validateApiKeyMock.mockResolvedValue({
        success: true,
        data: { valid: false, error: 'bad key', errorCode: 'AUTH_FAILED', provider: 'OPENAI' },
      });
    const openai = getLlmContributions().find(c => c.providerId === 'openai')!;
    const result = await openai.verify!({ 'llm.openai.apiKey': 'sk-bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('bad key');
    }
  });

  it('returns ok=false with errorCode when validator gives no message', async () => {
    validateApiKeyMock.mockResolvedValue({
        success: true,
        data: { valid: false, errorCode: 'NETWORK_ERROR', provider: 'OPENAI' },
      });
    const openai = getLlmContributions().find(c => c.providerId === 'openai')!;
    const result = await openai.verify!({ 'llm.openai.apiKey': 'sk-x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('NETWORK_ERROR');
    }
  });

  it('returns ok=false when IPC call itself fails (success=false)', async () => {
    validateApiKeyMock.mockResolvedValue({ success: false, errorMessage: 'IPC down' });
    const openai = getLlmContributions().find(c => c.providerId === 'openai')!;
    const result = await openai.verify!({ 'llm.openai.apiKey': 'sk-x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('IPC down');
    }
  });

  it('returns ok=false with the raised message when validator throws', async () => {
    validateApiKeyMock.mockRejectedValue(new Error('network down'));
    const openai = getLlmContributions().find(c => c.providerId === 'openai')!;
    const result = await openai.verify!({ 'llm.openai.apiKey': 'sk-x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('network down');
    }
  });

  it('returns ok=false when called without a value for the field', async () => {
    const openai = getLlmContributions().find(c => c.providerId === 'openai')!;
    const result = await openai.verify!({});
    expect(result.ok).toBe(false);
  });
});

describe('postConfigureHook wiring', () => {
  it('calls llmCatalog.refresh', async () => {
    const claude = getLlmContributions().find(c => c.providerId === 'claude')!;
    await claude.postConfigureHook!();
    expect(refreshCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('swallows refresh errors (best effort)', async () => {
    refreshCatalogMock.mockRejectedValue(new Error('catalog down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const claude = getLlmContributions().find(c => c.providerId === 'claude')!;
      await expect(claude.postConfigureHook!()).resolves.toBeUndefined();
      expect(consoleWarn).toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });
});

describe('registerLlmContributions', () => {
  it('registers every provider on the shared registry', () => {
    expect(credentialRegistry.size()).toBe(0);
    registerLlmContributions();
    // TICKET_1266: 9 providers (added LinoAPI and openaiCompatible).
    expect(credentialRegistry.size()).toBe(9);
    expect(credentialRegistry.has('claude')).toBe(true);
    expect(credentialRegistry.has('ollama')).toBe(true);
    expect(credentialRegistry.has('openaiCompatible')).toBe(true);
  });

  it('is idempotent (second call is a no-op)', () => {
    registerLlmContributions();
    expect(credentialRegistry.size()).toBe(9);
    expect(() => registerLlmContributions()).not.toThrow();
    expect(credentialRegistry.size()).toBe(9);
  });

  it('only contributes domain=llm entries', () => {
    registerLlmContributions();
    expect(credentialRegistry.getByDomain('llm')).toHaveLength(9);
    expect(credentialRegistry.getByDomain('data')).toEqual([]);
  });
});
