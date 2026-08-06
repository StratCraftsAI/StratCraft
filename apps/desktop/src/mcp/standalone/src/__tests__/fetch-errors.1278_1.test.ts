/**
 * TICKET_1278_1: fetch-errors shared module.
 *
 * Covers cause-chain description (errno suffix, AggregateError branch,
 * depth bound), code collection, dispatch-failure classification, and
 * fetchWithTransientRetry (retry only on dispatch failure, HTTP errors
 * passed through, non-dispatch throws immediate, abort during backoff).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  describeErrorChain,
  collectErrorCodes,
  isFetchDispatchFailure,
  fetchWithTransientRetry,
} from '../fetch-errors';

function errno(message: string, code: string): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

/** undici shape: TypeError('fetch failed') with a cause. */
function dispatchFailure(cause: unknown): TypeError {
  return new TypeError('fetch failed', { cause });
}

const RETRY_OPTS = { retries: 2, backoffMs: [1, 1] as const };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('describeErrorChain', () => {
  it('renders the cause chain with errno codes', () => {
    const e = dispatchFailure(errno('other side closed', 'UND_ERR_SOCKET'));
    expect(describeErrorChain(e)).toBe('fetch failed -> other side closed (UND_ERR_SOCKET)');
  });

  it('summarizes AggregateError members inline', () => {
    const agg = new AggregateError([errno('connect ECONNREFUSED ::1:443', 'ECONNREFUSED'), errno('reset', 'ECONNRESET')], '');
    const rendered = describeErrorChain(dispatchFailure(agg));
    expect(rendered).toContain('ECONNREFUSED');
    expect(rendered).toContain('reset (ECONNRESET)');
  });

  it('does not duplicate a code already present in the message', () => {
    expect(describeErrorChain(errno('connect ECONNREFUSED 1.2.3.4:443', 'ECONNREFUSED'))).toBe('connect ECONNREFUSED 1.2.3.4:443');
  });

  it('is the plain message for cause-less errors and bounds depth', () => {
    expect(describeErrorChain(new Error('Anthropic API 401: bad key'))).toBe('Anthropic API 401: bad key');
    let deep: Error = new Error('leaf');
    for (let i = 0; i < 10; i++) deep = new Error(`layer${i}`, { cause: deep });
    expect(describeErrorChain(deep).split(' -> ').length).toBeLessThanOrEqual(5);
  });

  it('stringifies non-Error values', () => {
    expect(describeErrorChain('boom')).toBe('boom');
  });
});

describe('collectErrorCodes', () => {
  it('collects codes across cause links and AggregateError members', () => {
    const agg = new AggregateError([errno('a', 'ENETUNREACH'), errno('b', 'EHOSTUNREACH')], '');
    const e = dispatchFailure(new Error('wrap', { cause: agg }));
    expect([...collectErrorCodes(e)].sort()).toEqual(['EHOSTUNREACH', 'ENETUNREACH']);
  });

  it('returns empty for code-less errors and non-objects', () => {
    expect(collectErrorCodes(new Error('plain')).size).toBe(0);
    expect(collectErrorCodes('str').size).toBe(0);
    expect(collectErrorCodes(null).size).toBe(0);
  });
});

describe('isFetchDispatchFailure', () => {
  it('matches only the undici wrapper', () => {
    expect(isFetchDispatchFailure(dispatchFailure(errno('x', 'ECONNRESET')))).toBe(true);
    expect(isFetchDispatchFailure(new TypeError('Failed to parse URL'))).toBe(false);
    expect(isFetchDispatchFailure(new Error('fetch failed'))).toBe(false);
  });
});

describe('fetchWithTransientRetry', () => {
  it('retries dispatch failures and returns the eventual response', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(dispatchFailure(errno('reset', 'ECONNRESET')))
      .mockRejectedValueOnce(dispatchFailure(errno('reset', 'ECONNRESET')))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithTransientRetry('http://x/', { method: 'POST' }, RETRY_OPTS);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws the last dispatch failure once the budget is exhausted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(dispatchFailure(errno('reset', 'ECONNRESET')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithTransientRetry('http://x/', {}, RETRY_OPTS)).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns HTTP error responses without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithTransientRetry('http://x/', {}, RETRY_OPTS);
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-dispatch errors immediately', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithTransientRetry('http://x/', {}, RETRY_OPTS)).rejects.toThrow('boom');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops during backoff when aborted', async () => {
    const failure = dispatchFailure(errno('reset', 'ECONNRESET'));
    const abort = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      abort.abort();
      return Promise.reject(failure);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithTransientRetry('http://x/', {}, { retries: 2, backoffMs: [60_000], signal: abort.signal }),
    ).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
