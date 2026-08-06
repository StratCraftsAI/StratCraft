/**
 * TICKET_1074 / TICKET_1078: opaque error detection.
 *
 * dukascopy-node (and some other providers) wrap both network failures
 * AND missing CDN artifacts as generic Error('Unknown error'), discarding
 * the original cause. This utility detects those opaque messages so
 * callers can distinguish transient/retryable errors from programming
 * errors (validation, unsupported interval, etc.).
 *
 * Shared between the Dukascopy provider (error enrichment) and the
 * DataCacheManager (chunk-level retry/skip in fetchRange).
 */

const OPAQUE_ERROR_PATTERNS = [
  'unknown error',
  'fetch failed',
  'econnreset',
  'etimedout',
  'enotfound',
  'socket hang up',
  'network error',
] as const;

export function isOpaqueError(message: string): boolean {
  const lower = message.toLowerCase();
  return OPAQUE_ERROR_PATTERNS.some(p => lower.includes(p));
}
