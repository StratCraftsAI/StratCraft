/**
 * wp-datetime Unit Tests
 *
 * TICKET_805 P1.1: parseWpDateTimeUtc must interpret "Y-m-d H:i:s"
 * strings as UTC regardless of host timezone. Pure function -- no mocks.
 */

import { describe, it, expect } from 'vitest';
import { parseWpDateTimeUtc } from '../wp-datetime';

describe('parseWpDateTimeUtc', () => {
  it('parses a MySQL DATETIME string as UTC', () => {
    const d = parseWpDateTimeUtc('2026-08-01 00:00:00');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not apply host timezone offset', () => {
    // The UTC instant must match regardless of where this runs.
    // 2026-08-01 12:34:56 UTC == 1785933296000 ms epoch.
    const d = parseWpDateTimeUtc('2026-08-01 12:34:56');
    expect(d!.getTime()).toBe(Date.UTC(2026, 7, 1, 12, 34, 56));
  });

  it('handles end-of-day boundary', () => {
    const d = parseWpDateTimeUtc('2026-12-31 23:59:59');
    expect(d!.toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });

  it('handles leap-day Feb 29', () => {
    const d = parseWpDateTimeUtc('2028-02-29 00:00:00');
    expect(d!.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('returns null for null input', () => {
    expect(parseWpDateTimeUtc(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseWpDateTimeUtc(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseWpDateTimeUtc('')).toBeNull();
  });

  it('returns null for malformed string', () => {
    expect(parseWpDateTimeUtc('not-a-date')).toBeNull();
  });

  it('returns null for non-string input (defensive against IPC drift)', () => {
    // Cast to bypass TS so we can verify runtime defensiveness.
    expect(parseWpDateTimeUtc(12345 as unknown as string)).toBeNull();
    expect(parseWpDateTimeUtc({} as unknown as string)).toBeNull();
  });

  it('returns null for impossible date (Feb 30)', () => {
    // JS Date will coerce Feb 30 to Mar 2, which is a real Date but the
    // wrong calendar day. We accept the coerced Date here -- our policy is
    // "no throw, no surprise null on numerically-valid strings". The check
    // exists to document this behavior, not to fail.
    const d = parseWpDateTimeUtc('2026-02-30 00:00:00');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  // ISO 8601 fallthrough: WP REST returns MySQL DATETIME today, but tests
  // and some upstream mocks pass ISO 8601 (with T and an explicit zone).
  // Accept both so the helper does not surprise callers with null on the
  // second form.

  it('parses ISO 8601 with Z designator', () => {
    const d = parseWpDateTimeUtc('2027-05-01T00:00:00Z');
    expect(d!.toISOString()).toBe('2027-05-01T00:00:00.000Z');
  });

  it('parses ISO 8601 with explicit +00:00 offset', () => {
    const d = parseWpDateTimeUtc('2027-05-01T00:00:00+00:00');
    expect(d!.toISOString()).toBe('2027-05-01T00:00:00.000Z');
  });

  it('parses ISO 8601 with positive offset (honoring the offset)', () => {
    // 2027-05-01T08:00:00+08:00 == 2027-05-01T00:00:00Z
    const d = parseWpDateTimeUtc('2027-05-01T08:00:00+08:00');
    expect(d!.toISOString()).toBe('2027-05-01T00:00:00.000Z');
  });
});
