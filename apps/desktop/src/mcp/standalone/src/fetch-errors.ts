/**
 * TICKET_1278_1: undici fetch error introspection + transient-dispatch
 * retry, shared by the bridge client and the agent-loop LLM calls.
 *
 * Node's fetch (undici) wraps every network-dispatch failure as
 * `TypeError('fetch failed', { cause })` where the cause carries the real
 * error: an ErrnoException (ECONNRESET, ENOTFOUND, ...), an AggregateError
 * (multi-address connect), or an undici SocketError with a UND_ERR_* code.
 * The top-level message is diagnostic-free; everything useful lives in the
 * cause chain.
 */

/** Depth bound for cause-chain traversal (defensive against cycles). */
const MAX_CAUSE_DEPTH = 5;

/** Max AggregateError members summarized inline by describeErrorChain. */
const MAX_AGGREGATE_MEMBERS = 3;

function describeOne(error: unknown, depth: number): string {
  if (error instanceof AggregateError) {
    const label = error.message || 'AggregateError';
    if (depth >= MAX_CAUSE_DEPTH || error.errors.length === 0) return label;
    const inner = error.errors
      .slice(0, MAX_AGGREGATE_MEMBERS)
      .map((e) => describeOne(e, depth + 1))
      .join('; ');
    return `${label} [${inner}]`;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message = error.message || error.name;
    return typeof code === 'string' && !message.includes(code) ? `${message} (${code})` : message;
  }
  return String(error);
}

/**
 * Human-readable rendering of the full cause chain, e.g.
 * `fetch failed -> other side closed (UND_ERR_SOCKET)`. For errors without
 * a cause this is just the message, so it is safe to apply to any error.
 */
export function describeErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
    parts.push(describeOne(current, depth));
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts.join(' -> ');
}

/**
 * Every `code` string found anywhere in the chain: the error itself, each
 * cause link, and AggregateError members (recursively).
 */
export function collectErrorCodes(error: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (!error || typeof error !== 'object' || depth > MAX_CAUSE_DEPTH) return out;
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string') out.add(code);
  if (error instanceof AggregateError) {
    for (const member of error.errors) collectErrorCodes(member, out, depth + 1);
  }
  collectErrorCodes((error as { cause?: unknown }).cause, out, depth + 1);
  return out;
}

/**
 * True iff the error is undici's dispatch-failure wrapper: the request
 * never produced a response (connect/TLS/socket-write failure), so a
 * retry is unconditionally safe even for POST.
 */
export function isFetchDispatchFailure(error: unknown): boolean {
  return error instanceof TypeError && error.message === 'fetch failed';
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export interface TransientRetryOptions {
  /** Additional attempts after the first (total attempts = retries + 1). */
  retries: number;
  /** Backoff before retry N is backoffMs[N-1]; the last entry repeats. */
  backoffMs: readonly number[];
  signal?: AbortSignal;
}

/**
 * `fetch` with bounded retry on dispatch failures ONLY. HTTP error
 * responses are returned as-is (they reached the server -- provider
 * semantics apply), and non-dispatch throws are rethrown immediately.
 * Abort stops the backoff wait and rethrows without another attempt.
 */
export async function fetchWithTransientRetry(
  url: string,
  init: RequestInit,
  opts: TransientRetryOptions,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt > 0) {
      const backoff = opts.backoffMs[Math.min(attempt - 1, opts.backoffMs.length - 1)] ?? 0;
      await abortableSleep(backoff, opts.signal);
      if (opts.signal?.aborted) throw lastError;
    }
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (opts.signal?.aborted || !isFetchDispatchFailure(error) || attempt === opts.retries) {
        throw error;
      }
      console.error(
        `[MCP] fetch dispatch to ${url} failed (attempt ${attempt + 1}/${opts.retries + 1}), retrying: ${describeErrorChain(error)}`,
      );
    }
  }
  // Unreachable: the loop always returns or throws on its last attempt.
  throw lastError;
}
