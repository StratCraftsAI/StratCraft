import { describe, it, expect } from 'vitest';
import {
  LLM_CREDENTIAL_META,
  getLlmCredentialMeta,
  validateLlmCredentialValue,
} from './llm-credential-meta';
import { LLM_PROVIDER_IDS } from './llm-provider-id';

describe('TICKET_1265_7 LLM credential metadata SSOT', () => {
  describe('LLM_CREDENTIAL_META', () => {
    it('covers every non-catalog provider id', () => {
      // PRO_CATALOG / NONA are platform sentinels with no BYOK credential.
      const byok = LLM_PROVIDER_IDS.filter(id => id !== 'PRO_CATALOG' && id !== 'NONA');
      for (const id of byok) {
        expect(LLM_CREDENTIAL_META[id]).toBeDefined();
      }
    });

    it('models Ollama as an optional local base URL (required:false, baseUrl)', () => {
      const ollama = LLM_CREDENTIAL_META.OLLAMA;
      expect(ollama.kind).toBe('baseUrl');
      expect(ollama.required).toBe(false);
      expect(ollama.inputType).toBe('url');
      expect(ollama.skipVerify).toBe(true);
      expect(ollama.pattern).toBe('^https?://.+');
    });

    it('models API-key providers as required password fields', () => {
      for (const id of ['CLAUDE', 'OPENAI', 'GEMINI', 'DEEPSEEK', 'GROK', 'QWEN']) {
        const meta = LLM_CREDENTIAL_META[id];
        expect(meta.kind).toBe('apiKey');
        expect(meta.required).toBe(true);
        expect(meta.inputType).toBe('password');
      }
    });
  });

  describe('getLlmCredentialMeta', () => {
    it('is case-insensitive', () => {
      expect(getLlmCredentialMeta('ollama')).toBe(LLM_CREDENTIAL_META.OLLAMA);
      expect(getLlmCredentialMeta('OLLAMA')).toBe(LLM_CREDENTIAL_META.OLLAMA);
    });

    it('returns undefined for an unknown provider', () => {
      expect(getLlmCredentialMeta('NOPE')).toBeUndefined();
    });
  });

  describe('validateLlmCredentialValue (AC4 corruption door)', () => {
    it('rejects an sk-... value for the Ollama base-URL slot', () => {
      expect(validateLlmCredentialValue('OLLAMA', 'sk-ant-evil')).toBe('patternMismatch');
    });

    it('accepts a valid http(s) URL for Ollama', () => {
      expect(validateLlmCredentialValue('OLLAMA', 'http://localhost:11434')).toBeNull();
      expect(validateLlmCredentialValue('OLLAMA', 'https://ollama.example.com')).toBeNull();
    });

    it('treats an empty value as valid for Ollama (optional credential)', () => {
      expect(validateLlmCredentialValue('OLLAMA', '')).toBeNull();
      expect(validateLlmCredentialValue('OLLAMA', '   ')).toBeNull();
    });

    it('requires a non-empty value for key-required providers', () => {
      expect(validateLlmCredentialValue('CLAUDE', '')).toBe('empty');
    });

    it('enforces the per-provider key pattern', () => {
      expect(validateLlmCredentialValue('CLAUDE', 'sk-ant-abc')).toBeNull();
      expect(validateLlmCredentialValue('CLAUDE', 'sk-wrong')).toBe('patternMismatch');
      expect(validateLlmCredentialValue('OPENAI', 'sk-abc')).toBeNull();
      expect(validateLlmCredentialValue('GROK', 'xai-abc')).toBeNull();
      expect(validateLlmCredentialValue('GROK', 'sk-abc')).toBe('patternMismatch');
    });

    it('reports unknownProvider for an unrecognized id', () => {
      expect(validateLlmCredentialValue('NOPE', 'x')).toBe('unknownProvider');
    });
  });
});
