/**
 * TICKET_1318 AC8 / AC14: fence language normalization -- every alias, casing
 * and whitespace variation, unknown hints, and absent hints.
 */

import { describe, expect, it } from 'vitest';
import { normalizeLanguage } from '../language.js';

describe('normalizeLanguage', () => {
  it.each([
    ['cpp', 'cpp'],
    ['c++', 'cpp'],
    ['cxx', 'cpp'],
    ['cc', 'cpp'],
    ['py', 'python'],
    ['python', 'python'],
    ['json', 'json'],
  ])('maps alias %s to %s', (hint, expected) => {
    expect(normalizeLanguage(hint)).toBe(expected);
  });

  it.each(['CPP', 'C++', 'Python', 'PY', 'JSON', 'CxX'])(
    'matches case-insensitively: %s',
    (hint) => {
      expect(normalizeLanguage(hint)).not.toBeNull();
    },
  );

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeLanguage('  cpp  ')).toBe('cpp');
    expect(normalizeLanguage('\tpython\n')).toBe('python');
  });

  it('returns null for unknown languages', () => {
    expect(normalizeLanguage('rust')).toBeNull();
    expect(normalizeLanguage('typescript')).toBeNull();
  });

  it('returns null for absent or blank hints', () => {
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage('   ')).toBeNull();
  });

  it('does not inherit Object.prototype keys as languages', () => {
    expect(normalizeLanguage('constructor')).toBeNull();
    expect(normalizeLanguage('toString')).toBeNull();
  });
});
