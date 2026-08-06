/**
 * Typed syntax tokenizer -- TICKET_1318 AC4.
 *
 * Returns `HighlightToken[]`, never HTML. The previous implementation in
 * `CodeDisplay.tsx` built an HTML string with placeholder substitution and fed
 * it to `dangerouslySetInnerHTML`; the language rules are preserved here, but
 * the output is data that renderers turn into React spans.
 *
 * Concatenating every token's `content` reproduces the input exactly, so a
 * renderer can rely on tokens alone for display, copy, and line counting.
 */

import type { CodeLanguage } from './language.js';
import type { HighlightToken, SyntaxTokenKind } from './tokens.js';

/**
 * Tokenize source text for a supported language.
 *
 * An unknown/absent language or empty input yields no highlighting: the whole
 * input comes back as a single `plain` token, never silently guessed.
 */
export function tokenizeCode(code: string, language: CodeLanguage | null): HighlightToken[] {
  if (code === '') return [];
  if (language === null) return [{ kind: 'plain', content: code }];
  if (language === 'json') return tokenize(code, JSON_RULES);
  if (language === 'cpp') return tokenize(code, CPP_RULES);
  return tokenize(code, PYTHON_RULES);
}

// -----------------------------------------------------------------------------
// Rule engine
// -----------------------------------------------------------------------------

/**
 * A rule maps one regex match to one or more tokens.
 *
 * A `kind` rule assigns one kind to the whole match. A `parts` rule assigns one
 * kind per capture group -- which is how `def name` becomes a keyword plus a
 * function name in a single pass. A `parts` rule's capture groups must together
 * cover the entire match with no gaps, so the separators between them carry
 * their own kind (usually `plain`) rather than being reconstructed.
 */
type HighlightRule =
  | { pattern: RegExp; kind: SyntaxTokenKind; parts?: undefined }
  | { pattern: RegExp; parts: SyntaxTokenKind[]; kind?: undefined };

/**
 * Scan left to right; at each position the earliest match across all rules
 * wins, with ties broken by rule order. Because matched regions are consumed
 * whole, a keyword inside a string or comment can never be re-tokenized -- the
 * property the old placeholder technique existed to provide.
 */
function tokenize(code: string, rules: HighlightRule[]): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let cursor = 0;

  while (cursor < code.length) {
    const hit = nextMatch(code, cursor, rules);

    if (hit === null) {
      pushToken(tokens, 'plain', code.slice(cursor));
      break;
    }

    if (hit.start > cursor) {
      pushToken(tokens, 'plain', code.slice(cursor, hit.start));
    }

    emit(tokens, hit);
    cursor = hit.start + hit.match[0].length;
  }

  return tokens;
}

interface RuleHit {
  start: number;
  match: RegExpExecArray;
  rule: HighlightRule;
}

function nextMatch(code: string, from: number, rules: HighlightRule[]): RuleHit | null {
  let best: RuleHit | null = null;

  for (const rule of rules) {
    rule.pattern.lastIndex = from;
    const match = rule.pattern.exec(code);
    if (match === null) continue;
    if (best === null || match.index < best.start) {
      best = { start: match.index, match, rule };
    }
  }

  return best;
}

/**
 * Emit tokens for one hit. A `parts` rule assigns each capture group its own
 * kind in order; because the groups cover the whole match, emitting them in
 * sequence reproduces the matched text exactly.
 */
function emit(tokens: HighlightToken[], hit: RuleHit): void {
  const { match, rule } = hit;

  if (rule.parts === undefined) {
    pushToken(tokens, rule.kind, match[0]);
    return;
  }

  for (let group = 0; group < rule.parts.length; group++) {
    pushToken(tokens, rule.parts[group], match[group + 1]);
  }
}

/**
 * Append a token, merging adjacent same-kind runs so output stays compact.
 *
 * `content` is never empty: plain slices are pushed only when the gap is
 * non-zero, and every rule pattern and capture group is `+`-quantified or a
 * literal, so no match or group can be zero-length.
 */
function pushToken(tokens: HighlightToken[], kind: SyntaxTokenKind, content: string): void {
  const last = tokens[tokens.length - 1];
  if (last !== undefined && last.kind === kind) {
    last.content += content;
    return;
  }
  tokens.push({ kind, content });
}

/** Build an alternation matching any of `words` on word boundaries. */
function wordsPattern(words: string[]): RegExp {
  return new RegExp(`\\b(?:${words.join('|')})\\b`, 'g');
}

// -----------------------------------------------------------------------------
// Python
// -----------------------------------------------------------------------------

const PYTHON_KEYWORDS = [
  'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'while',
  'in', 'is', 'not', 'and', 'or', 'with', 'as', 'try', 'except',
  'finally', 'raise', 'assert', 'break', 'continue', 'pass', 'yield',
  'lambda', 'global', 'nonlocal', 'async', 'await', 'True', 'False', 'None',
];

const PYTHON_BUILTINS = [
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict',
  'set', 'tuple', 'bool', 'type', 'isinstance', 'hasattr', 'getattr',
  'setattr', 'open', 'enumerate', 'zip', 'map', 'filter', 'sorted',
  'min', 'max', 'sum', 'any', 'all', 'super', 'self',
];

const PYTHON_RULES: HighlightRule[] = [
  { pattern: /#.*/g, kind: 'comment' },
  { pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''/g, kind: 'string' },
  { pattern: /(["'])(?:(?!\1)[^\\\r\n]|\\.)*\1/g, kind: 'string' },
  { pattern: /\b(def)(\s+)([A-Za-z_]\w*)/g, parts: ['keyword', 'plain', 'function'] },
  { pattern: /\b(class)(\s+)([A-Za-z_]\w*)/g, parts: ['keyword', 'plain', 'class-name'] },
  { pattern: /@[A-Za-z_]\w*(?:\.\w+)*/g, kind: 'decorator' },
  { pattern: wordsPattern(PYTHON_KEYWORDS), kind: 'keyword' },
  { pattern: wordsPattern(PYTHON_BUILTINS), kind: 'builtin' },
  { pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?\b|\.\d+\b/g, kind: 'number' },
];

// -----------------------------------------------------------------------------
// JSON
// -----------------------------------------------------------------------------

const JSON_RULES: HighlightRule[] = [
  { pattern: /("(?:[^"\\]|\\.)*")(\s*:)/g, parts: ['property', 'plain'] },
  { pattern: /"(?:[^"\\]|\\.)*"/g, kind: 'string' },
  { pattern: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, kind: 'number' },
  { pattern: /\b(?:true|false|null)\b/g, kind: 'keyword' },
];

// -----------------------------------------------------------------------------
// C++
// -----------------------------------------------------------------------------

const CPP_KEYWORDS = [
  'template', 'typename', 'concept', 'requires', 'constexpr', 'consteval',
  'auto', 'namespace', 'using', 'virtual', 'override', 'final',
  'static', 'inline', 'const', 'noexcept',
  'if', 'else', 'for', 'while', 'return', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'throw', 'nullptr', 'true', 'false', 'this',
  'co_await', 'co_yield', 'co_return',
  'public', 'private', 'protected', 'explicit', 'enum',
];

const CPP_TYPES = [
  'int', 'double', 'float', 'bool', 'void', 'size_t', 'string',
  'vector', 'array', 'optional', 'expected', 'span', 'string_view',
  'map', 'unordered_map', 'pair', 'tuple',
];

const CPP_RULES: HighlightRule[] = [
  { pattern: /\/\*[\s\S]*?\*\//g, kind: 'comment' },
  { pattern: /\/\/.*/g, kind: 'comment' },
  {
    pattern:
      /^[ \t]*#\s*(?:include|pragma|define|ifdef|ifndef|endif|if|else|elif|undef)\b.*/gm,
    kind: 'preprocessor',
  },
  { pattern: /R"([^(]*)\([\s\S]*?\)\1"/g, kind: 'string' },
  { pattern: /(["'])(?:(?!\1)[^\\\r\n]|\\.)*\1/g, kind: 'string' },
  { pattern: /\bstratforge::/g, kind: 'namespace' },
  { pattern: /\b(class|struct)(\s+)([A-Za-z_]\w*)/g, parts: ['keyword', 'plain', 'class-name'] },
  { pattern: wordsPattern(CPP_KEYWORDS), kind: 'keyword' },
  { pattern: wordsPattern(CPP_TYPES), kind: 'type' },
  {
    pattern: /\b\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*\b|\.\d+(?:[eE][+-]?\d+)?[fF]?\b/g,
    kind: 'number',
  },
];
