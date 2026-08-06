/**
 * TICKET_1318 AC4 / AC5 / AC14: the canonical token-class contract.
 *
 * Root cause 3 was a class mismatch -- spans carried `token keyword` while
 * stylesheets selected `.token-keyword`. These tests pin the corrected mapping.
 */

import { describe, expect, it } from 'vitest';
import { SYNTAX_COLORS, SYNTAX_TOKEN_KINDS, tokenClassName } from '../tokens.js';

describe('tokenClassName', () => {
  it('emits `token token-<kind>` for every non-plain kind', () => {
    for (const kind of SYNTAX_TOKEN_KINDS) {
      expect(tokenClassName(kind)).toBe(`token token-${kind}`);
    }
  });

  it('emits no class for plain tokens so renderers use bare text nodes', () => {
    expect(tokenClassName('plain')).toBeNull();
  });

  it('never emits the legacy space-separated `token <kind>` form', () => {
    for (const kind of SYNTAX_TOKEN_KINDS) {
      expect(tokenClassName(kind)).not.toBe(`token ${kind}`);
    }
  });
});

describe('SYNTAX_TOKEN_KINDS', () => {
  it('excludes `plain`, which carries no class or color', () => {
    expect(SYNTAX_TOKEN_KINDS).not.toContain('plain');
  });

  it('has no duplicate kinds', () => {
    expect(new Set(SYNTAX_TOKEN_KINDS).size).toBe(SYNTAX_TOKEN_KINDS.length);
  });
});

describe('SYNTAX_COLORS', () => {
  it('exposes a hex fallback for every color entry', () => {
    for (const value of Object.values(SYNTAX_COLORS)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
