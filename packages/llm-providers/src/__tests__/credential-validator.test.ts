import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverByokModels,
  LlmCredentialValidationError,
  validateOpenAICompatibleBaseUrl,
} from '../byok-fetcher';
import { LLM_CREDENTIAL_KEYS } from '@StratCraft/types';

afterEach(() => {
  vi.restoreAllMocks();
});

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function errorOf(promise: Promise<unknown>): Promise<LlmCredentialValidationError> {
  return promise.then(
    () => { throw new Error('Expected rejection'); },
    reason => reason as LlmCredentialValidationError,
  );
}

describe('discoverByokModels credential validation', () => {
  it('rejects unknown providers and missing required values', async () => {
    expect((await errorOf(discoverByokModels('UNKNOWN', { primary: 'x' }))).code)
      .toBe('invalid_format');
    expect((await errorOf(discoverByokModels('OPENAI', { primary: '' }))).code)
      .toBe('invalid_format');
  });

  it('uses the provider discovery contract for a valid submitted key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, { data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-small' }] }),
    );
    await expect(discoverByokModels('OPENAI', { primary: 'sk-test' }))
      .resolves.toEqual([{ id: 'gpt-5', name: 'Gpt 5' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/models'),
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } }),
    );
  });

  it('classifies authentication, provider, network, and timeout failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(401, {}));
    expect((await errorOf(discoverByokModels('OPENAI', { primary: 'bad' }))).code)
      .toBe('auth_failed');

    vi.mocked(fetch).mockResolvedValueOnce(response(503, {}));
    expect((await errorOf(discoverByokModels('OPENAI', { primary: 'sk-test' }))).code)
      .toBe('provider_unavailable');

    vi.mocked(fetch).mockRejectedValueOnce(new Error('socket closed'));
    expect((await errorOf(discoverByokModels('OPENAI', { primary: 'sk-test' }))).code)
      .toBe('network_error');

    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));
    expect((await errorOf(discoverByokModels('OPENAI', { primary: 'sk-test' }, 1))).code)
      .toBe('timeout');
  });

  it('requires a secure custom endpoint and discovers its models', async () => {
    expect(() => validateOpenAICompatibleBaseUrl('not-a-url')).toThrow(LlmCredentialValidationError);
    expect(() => validateOpenAICompatibleBaseUrl('http://example.com')).toThrow(
      'must use HTTPS',
    );
    expect(validateOpenAICompatibleBaseUrl('http://localhost:8000/'))
      .toBe('http://localhost:8000/v1');

    expect((await errorOf(discoverByokModels('OPENAI_COMPATIBLE', {
      primary: 'sk-test',
    }))).code).toBe('invalid_format');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, { data: [{ id: 'relay-chat' }] }),
    );
    await expect(discoverByokModels('OPENAI_COMPATIBLE', {
      primary: 'sk-test',
      extra: {
        [LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL]: 'https://relay.example/v1/',
      },
    })).resolves.toEqual([{ id: 'relay-chat', name: 'Relay Chat' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.example/v1/models',
      expect.any(Object),
    );
  });

  it('uses the default local endpoint when no Ollama override is submitted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, {
      models: [{ name: 'llama3:8b', model: 'llama3:8b' }],
    }));
    await expect(discoverByokModels('OLLAMA', { primary: '' }))
      .resolves.toEqual([{ id: 'llama3:8b', name: 'Llama3' }]);
  });
});
