/**
 * Syntax token contract -- the single authoritative token kind set, the
 * canonical CSS class mapping, and the hex fallback palette.
 *
 * TICKET_1318 root cause 3: `CodeDisplay` emitted `class="token keyword"` while
 * its stylesheet selected `.token-keyword`. No `.token.keyword` rule existed
 * anywhere in the repository, so syntax highlighting never applied. This module
 * defines one mapping used by every renderer and stylesheet.
 *
 * TICKET_179: `SYNTAX_COLORS` lives here and is re-exported by
 * `apps/desktop/src/shared/constants/colors.ts` so existing import paths keep
 * resolving against a single source of truth.
 */

/** Every token kind a renderer may receive from `tokenizeCode()`. */
export type SyntaxTokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'class-name'
  | 'decorator'
  | 'builtin'
  | 'property'
  | 'preprocessor'
  | 'type'
  | 'namespace';

/** A contiguous run of source text carrying one token kind. */
export interface HighlightToken {
  kind: SyntaxTokenKind;
  content: string;
}

/**
 * All non-plain token kinds, in declaration order. Stylesheets and style
 * regression tests iterate this list so a new kind cannot be added without a
 * matching rule.
 */
export const SYNTAX_TOKEN_KINDS: readonly SyntaxTokenKind[] = [
  'keyword',
  'string',
  'comment',
  'number',
  'function',
  'class-name',
  'decorator',
  'builtin',
  'property',
  'preprocessor',
  'type',
  'namespace',
] as const;

/**
 * Canonical CSS class for a token. `plain` carries no class so renderers emit a
 * bare text node instead of a redundant span.
 */
export function tokenClassName(kind: SyntaxTokenKind): string | null {
  if (kind === 'plain') return null;
  return `token token-${kind}`;
}

/**
 * Syntax highlighting fallback colors -- used as the `var(--x, fallback)`
 * second argument by every surface stylesheet.
 */
export const SYNTAX_COLORS = {
  /** Keyword token (teal-300) */
  KEYWORD: '#64ffda',
  /** String token (green) */
  STRING: '#98c379',
  /** Comment token (muted gray) */
  COMMENT: '#5c6773',
  /** Number token (orange) */
  NUMBER: '#d19a66',
  /** Function/class name token (gold) */
  FUNCTION: '#D4AF37',
  /** Built-in token (warm yellow) */
  BUILTIN: '#e5c07b',
  /** Property token (blue) */
  PROPERTY: '#61afef',
  /** Preprocessor token (violet) */
  PREPROCESSOR: '#c792ea',
} as const;
