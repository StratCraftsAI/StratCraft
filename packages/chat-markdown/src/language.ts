/**
 * Fence language normalization -- TICKET_1318 AC8.
 *
 * The AI Studio renderer previously captured the fence language hint as `$1`
 * and discarded it. This module is the single place a hint becomes a supported
 * language, so both surfaces highlight identically.
 */

/** Languages the shared tokenizer supports. */
export type CodeLanguage = 'cpp' | 'python' | 'json';

/**
 * Alias table. A `Map` rather than an object literal so a hint like
 * `constructor` or `toString` cannot resolve through `Object.prototype`.
 */
const LANGUAGE_ALIASES: ReadonlyMap<string, CodeLanguage> = new Map<string, CodeLanguage>([
  ['cpp', 'cpp'],
  ['c++', 'cpp'],
  ['cxx', 'cpp'],
  ['cc', 'cpp'],
  ['py', 'python'],
  ['python', 'python'],
  ['json', 'json'],
]);

/**
 * Normalize a fence language hint. Matching is case-insensitive after trimming.
 * Unknown or absent hints return `null` and render as plain monospace -- never
 * as a silently guessed language.
 */
export function normalizeLanguage(hint: string | null | undefined): CodeLanguage | null {
  if (hint === null || hint === undefined) return null;
  const key = hint.trim().toLowerCase();
  if (key === '') return null;
  return LANGUAGE_ALIASES.get(key) ?? null;
}
