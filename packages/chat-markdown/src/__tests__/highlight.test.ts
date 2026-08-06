/**
 * TICKET_1318 AC4 / AC14: typed syntax tokenization.
 *
 * The tokenizer replaced a regex-to-HTML builder, so two properties matter as
 * much as the token kinds themselves: it never returns HTML, and concatenating
 * token contents reproduces the source exactly.
 */

import { describe, expect, it } from 'vitest';
import { tokenizeCode } from '../highlight.js';
import { SYNTAX_TOKEN_KINDS, type HighlightToken } from '../tokens.js';

/** Token contents must rejoin into the original source, byte for byte. */
function assertLossless(code: string, tokens: HighlightToken[]): void {
  expect(tokens.map((t) => t.content).join('')).toBe(code);
}

function kindsOf(tokens: HighlightToken[]): Set<string> {
  return new Set(tokens.map((t) => t.kind));
}

function contentOfKind(tokens: HighlightToken[], kind: string): string[] {
  return tokens.filter((t) => t.kind === kind).map((t) => t.content);
}

describe('tokenizeCode -- contract', () => {
  it('returns nothing for empty code', () => {
    expect(tokenizeCode('', 'cpp')).toEqual([]);
    expect(tokenizeCode('', null)).toEqual([]);
  });

  it('returns a single plain token when the language is unknown', () => {
    const code = 'class Foo { int x = 1; }';
    expect(tokenizeCode(code, null)).toEqual([{ kind: 'plain', content: code }]);
  });

  it('never emits HTML markup in token content', () => {
    const code = '// <script>alert(1)</script>\nint x = 1;';
    for (const token of tokenizeCode(code, 'cpp')) {
      expect(token.content).not.toContain('<span');
      expect(token.content).not.toContain('&amp;');
      expect(token.content).not.toContain('__REPLACE_');
    }
  });

  it('preserves dangerous source text verbatim rather than escaping it (AC11)', () => {
    const code = 'auto s = "<img src=x onerror=alert(1)>";';
    const tokens = tokenizeCode(code, 'cpp');
    assertLossless(code, tokens);
  });

  it.each(['cpp', 'python', 'json'] as const)('emits only known kinds for %s', (language) => {
    const samples = {
      cpp: '#include <vector>\nclass A { int x = 1; };',
      python: '# c\ndef f():\n    return len("s")',
      json: '{"a": 1, "b": "s", "c": true}',
    };
    for (const token of tokenizeCode(samples[language], language)) {
      expect([...SYNTAX_TOKEN_KINDS, 'plain']).toContain(token.kind);
    }
  });
});

describe('tokenizeCode -- C++', () => {
  const code = [
    '#include <vector>',
    '/* block comment */',
    '// line comment',
    'namespace app {',
    'class MyStrategy {',
    '  double value = 1.5;',
    '  auto name = "text";',
    '  stratforge::Bar bar;',
    '};',
  ].join('\n');

  const tokens = tokenizeCode(code, 'cpp');

  it('is lossless', () => assertLossless(code, tokens));

  it('emits preprocessor, comment, string, keyword, type, number, class-name, namespace', () => {
    const kinds = kindsOf(tokens);
    for (const expected of [
      'preprocessor',
      'comment',
      'string',
      'keyword',
      'type',
      'number',
      'class-name',
      'namespace',
    ]) {
      expect(kinds).toContain(expected);
    }
  });

  it('names the class after the `class` keyword', () => {
    expect(contentOfKind(tokens, 'class-name')).toContain('MyStrategy');
  });

  it('tokenizes the stratforge:: namespace prefix', () => {
    expect(contentOfKind(tokens, 'namespace')).toContain('stratforge::');
  });

  it('does not highlight keywords inside comments or strings', () => {
    const t = tokenizeCode('// class Foo return\nauto s = "class Foo";', 'cpp');
    expect(contentOfKind(t, 'class-name')).toEqual([]);
    expect(contentOfKind(t, 'keyword')).toEqual(['auto']);
  });

  it('tokenizes `struct` definitions as well as `class`', () => {
    const t = tokenizeCode('struct Point { int x; };', 'cpp');
    expect(contentOfKind(t, 'class-name')).toEqual(['Point']);
  });

  it('tokenizes raw string literals', () => {
    const code2 = 'auto q = R"sql(SELECT "a" FROM t)sql";';
    const t = tokenizeCode(code2, 'cpp');
    assertLossless(code2, t);
    expect(contentOfKind(t, 'string')[0]).toContain('SELECT');
  });

  it.each(['1', '1.5', '1e9', '1.5f', '10UL', '.5'])('tokenizes numeric literal %s', (n) => {
    const t = tokenizeCode(`x = ${n};`, 'cpp');
    expect(kindsOf(t)).toContain('number');
  });

  it('handles code with no highlightable tokens', () => {
    expect(tokenizeCode('   ', 'cpp')).toEqual([{ kind: 'plain', content: '   ' }]);
  });
});

describe('tokenizeCode -- Python', () => {
  const code = [
    '# comment',
    '"""docstring"""',
    '@decorator',
    'class Model:',
    '    def run(self):',
    '        return len("abc") + 42',
  ].join('\n');

  const tokens = tokenizeCode(code, 'python');

  it('is lossless', () => assertLossless(code, tokens));

  it('emits comment, string, decorator, keyword, class-name, function, builtin, number', () => {
    const kinds = kindsOf(tokens);
    for (const expected of [
      'comment',
      'string',
      'decorator',
      'keyword',
      'class-name',
      'function',
      'builtin',
      'number',
    ]) {
      expect(kinds).toContain(expected);
    }
  });

  it('names a def as a function and a class as a class-name', () => {
    expect(contentOfKind(tokens, 'function')).toContain('run');
    expect(contentOfKind(tokens, 'class-name')).toContain('Model');
  });

  it('tokenizes single-quoted strings and triple-single-quoted docstrings', () => {
    expect(kindsOf(tokenizeCode("s = 'text'", 'python'))).toContain('string');
    expect(kindsOf(tokenizeCode("'''doc'''", 'python'))).toContain('string');
  });

  it('tokenizes dotted decorators', () => {
    expect(contentOfKind(tokenizeCode('@app.route', 'python'), 'decorator')).toEqual(['@app.route']);
  });

  it('does not highlight keywords inside comments', () => {
    expect(contentOfKind(tokenizeCode('# import os', 'python'), 'keyword')).toEqual([]);
  });

  it('tokenizes float literals with a leading dot', () => {
    expect(kindsOf(tokenizeCode('x = .5', 'python'))).toContain('number');
  });
});

describe('tokenizeCode -- JSON', () => {
  const code = '{\n  "name": "alpha",\n  "count": 12,\n  "ok": true,\n  "none": null\n}';
  const tokens = tokenizeCode(code, 'json');

  it('is lossless', () => assertLossless(code, tokens));

  it('emits property, string, number, and keyword kinds', () => {
    const kinds = kindsOf(tokens);
    for (const expected of ['property', 'string', 'number', 'keyword']) {
      expect(kinds).toContain(expected);
    }
  });

  it('distinguishes a key from a string value', () => {
    expect(contentOfKind(tokens, 'property')).toContain('"name"');
    expect(contentOfKind(tokens, 'string')).toContain('"alpha"');
  });

  it('tokenizes negative and exponent numbers', () => {
    expect(kindsOf(tokenizeCode('{"a": -1.5e3}', 'json'))).toContain('number');
  });

  it('tokenizes true, false, and null', () => {
    const t = tokenizeCode('[true, false, null]', 'json');
    expect(contentOfKind(t, 'keyword')).toEqual(['true', 'false', 'null']);
  });

  it('handles a string containing an escaped quote', () => {
    const code2 = '{"a": "he said \\"hi\\""}';
    assertLossless(code2, tokenizeCode(code2, 'json'));
  });
});
