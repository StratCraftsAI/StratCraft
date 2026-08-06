/**
 * TICKET_1318 AC5 -- CodeDisplay delegates to the shared tokenizer.
 *
 * The regression this pins is root cause 3: emitted spans carried
 * `class="token keyword"` while the component's own stylesheet selected
 * `.token-keyword`, so highlighting never applied. Every emitted token class
 * must now have a matching style selector.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CodeDisplay, type CodeDisplayProps } from '../CodeDisplay';
import { SYNTAX_TOKEN_KINDS, tokenizeCode } from '@StratCraft/chat-markdown';

function render(props: CodeDisplayProps): string {
  return renderToStaticMarkup(createElement(CodeDisplay, props));
}

function readSource(): string {
  return readFileSync(fileURLToPath(new URL('../CodeDisplay.tsx', import.meta.url)), 'utf-8');
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** Token classes actually emitted as spans in the rendered output. */
function emittedTokenClasses(html: string): string[] {
  return [...html.matchAll(/<span class="token (token-[a-z-]+)"/g)].map((m) => m[1]);
}

/** Token classes the component's <style> block defines rules for. */
function styledTokenClasses(html: string): Set<string> {
  return new Set([...html.matchAll(/\.code-display \.(token-[a-z-]+)/g)].map((m) => m[1]));
}

const CPP_SAMPLE = [
  '#include <vector>',
  '// comment',
  'namespace app {',
  'class MyStrategy {',
  '  double value = 1.5;',
  '  auto name = "text";',
  '  stratforge::Bar bar;',
  '};',
].join('\n');

const PYTHON_SAMPLE = '# c\n@dec\nclass Model:\n    def run(self):\n        return len("s") + 1';
const JSON_SAMPLE = '{"name": "alpha", "count": 12, "ok": true}';

describe('AC5: the token class contract is consistent', () => {
  it.each([
    ['cpp', CPP_SAMPLE],
    ['python', PYTHON_SAMPLE],
    ['json', JSON_SAMPLE],
  ] as const)('every %s token class emitted has a matching style rule', (language, code) => {
    const html = render({ code, language });
    const emitted = emittedTokenClasses(html);
    const styled = styledTokenClasses(html);

    expect(emitted.length).toBeGreaterThan(0);
    for (const cls of new Set(emitted)) {
      expect(styled).toContain(cls);
    }
  });

  it('defines a style rule for every canonical token kind', () => {
    const styled = styledTokenClasses(render({ code: CPP_SAMPLE, language: 'cpp' }));
    for (const kind of SYNTAX_TOKEN_KINDS) {
      expect(styled).toContain(`token-${kind}`);
    }
  });

  it('emits no legacy space-separated `token <kind>` class', () => {
    const html = render({ code: CPP_SAMPLE, language: 'cpp' });
    expect(html).not.toMatch(/class="token (keyword|string|comment|number|type|namespace)"/);
  });

  it('styles no token class it never emits for any supported language', () => {
    const styled = styledTokenClasses(render({ code: CPP_SAMPLE, language: 'cpp' }));
    const canonical = new Set(SYNTAX_TOKEN_KINDS.map((k) => `token-${k}`));
    for (const cls of styled) {
      expect(canonical).toContain(cls);
    }
  });
});

describe('AC5: rendering delegates to the shared tokenizer', () => {
  it('renders exactly the shared tokenizer output', () => {
    const html = render({ code: CPP_SAMPLE, language: 'cpp' });
    const expected = tokenizeCode(CPP_SAMPLE, 'cpp')
      .filter((t) => t.kind !== 'plain')
      .map((t) => `token-${t.kind}`);
    expect(emittedTokenClasses(html)).toEqual(expected);
  });

  it('preserves the source text exactly', () => {
    const html = render({ code: CPP_SAMPLE, language: 'cpp', showLineNumbers: false });
    expect(visibleText(html)).toContain('stratforge::Bar bar;');
    expect(visibleText(html)).toContain('double value = 1.5;');
  });

  it('defines no local tokenizer', () => {
    const source = readSource();
    for (const removed of [
      'function highlightPythonCode',
      'function highlightJsonCode',
      'function highlightCppCode',
      'function highlightCode',
      '__REPLACE_',
    ]) {
      expect(source).not.toContain(removed);
    }
  });

  it('never uses dangerouslySetInnerHTML as a rendering call', () => {
    expect(readSource()).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });

  it('imports the tokenizer from the shared package', () => {
    expect(readSource()).toContain("from '@StratCraft/chat-markdown'");
  });
});

describe('AC5: public props and states remain compatible', () => {
  it('defaults to python highlighting', () => {
    expect(emittedTokenClasses(render({ code: PYTHON_SAMPLE })).length).toBeGreaterThan(0);
  });

  it('renders the loading skeleton and no code', () => {
    const html = render({ code: CPP_SAMPLE, state: 'loading' });
    expect(html).toContain('skeleton-line');
    expect(emittedTokenClasses(html)).toEqual([]);
  });

  it('renders the error state with its message', () => {
    const html = render({ code: CPP_SAMPLE, state: 'error', errorMessage: 'boom' });
    expect(html).toContain('boom');
    expect(emittedTokenClasses(html)).toEqual([]);
  });

  it('renders the empty state for blank code', () => {
    expect(render({ code: '' })).toContain('ui.codeDisplayLabels.noCode');
    expect(render({ code: '   ' })).toContain('ui.codeDisplayLabels.noCode');
  });

  it('renders a copy control when code is present', () => {
    expect(render({ code: CPP_SAMPLE, language: 'cpp' })).toContain('ui.codeDisplayLabels.copy');
  });

  it('hides the copy control in loading and error states', () => {
    expect(render({ code: CPP_SAMPLE, state: 'loading' })).not.toContain(
      'ui.codeDisplayLabels.copy',
    );
    expect(render({ code: CPP_SAMPLE, state: 'error' })).not.toContain(
      'ui.codeDisplayLabels.copy',
    );
  });

  it('renders one line number per line when enabled', () => {
    const html = render({ code: 'a\nb\nc', language: 'cpp', showLineNumbers: true });
    // The gutter holds one bare <div>N</div> per line; code spans carry classes.
    expect(html.match(/<div>\d+<\/div>/g) ?? []).toHaveLength(3);
  });

  it('omits line numbers when disabled', () => {
    expect(render({ code: 'a\nb', showLineNumbers: false })).not.toContain('select-none');
  });

  it('honours a custom title, maxHeight, and className', () => {
    const html = render({
      code: CPP_SAMPLE,
      language: 'cpp',
      title: 'Strategy',
      maxHeight: '123px',
      className: 'extra-class',
    });
    expect(html).toContain('Strategy');
    expect(html).toContain('123px');
    expect(html).toContain('extra-class');
  });

  it('uses the default title when none is supplied', () => {
    expect(render({ code: CPP_SAMPLE })).toContain('ui.codeDisplayLabels.title');
  });
});

describe('AC11: CodeDisplay renders hostile code inertly', () => {
  const PAYLOAD = 'auto s = "<script>alert(1)</script><img src=x onerror=alert(2)>";';

  it('escapes markup in code content', () => {
    const html = render({ code: PAYLOAD, language: 'cpp' });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
