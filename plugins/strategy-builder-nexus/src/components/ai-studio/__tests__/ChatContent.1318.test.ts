/**
 * TICKET_1318 -- Electron AI Studio runtime rendering tests.
 *
 * AC7: the fence language hint is normalized and used, not captured-and-discarded.
 * AC9: the local regex renderer is gone.
 * AC10: TICKET_597 algorithm cards survive as typed React elements.
 * AC11: every content shape, including algorithm metadata, renders inert.
 * AC12: streaming frames keep one stable code-block wrapper.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue: string }) => options?.defaultValue ?? key,
  }),
}));

import { ChatContent } from '../ChatContent';
import { AlgorithmCard, placeAlgorithmCards } from '../AlgorithmCardList';
import { PARITY_FIXTURE, parityFingerprint, parseChatMarkdown } from '@StratCraft/chat-markdown';
import type { OpensourceAlgorithm } from '@StratCraft/ai-studio-operations/vibing-chat-protocol';

function render(content: string, algorithms?: OpensourceAlgorithm[]): string {
  return renderToStaticMarkup(createElement(ChatContent, { content, algorithms }));
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function algorithm(overrides: Partial<OpensourceAlgorithm> = {}): OpensourceAlgorithm {
  return {
    name: 'SuperTrend',
    id: 'st-1',
    strategy_type: 'indicator',
    rule_extractable: true,
    ...overrides,
  };
}

describe('AC7: fence language is normalized and used', () => {
  it('highlights a cpp fence with canonical token classes', () => {
    const html = render('```cpp\nint x = 1;\n```');
    expect(html).toContain('token token-type');
    expect(html).toContain('token token-number');
  });

  it.each([
    ['c++', 'cpp'],
    ['CPP', 'cpp'],
    ['py', 'python'],
    ['json', 'json'],
  ])('normalizes the %s hint to %s', (hint, expected) => {
    expect(render(`\`\`\`${hint}\nx\n\`\`\``)).toContain(expected);
  });

  it('renders an unknown language as plain code with no highlighted spans', () => {
    const html = render('```rust\nfn main() {}\n```');
    expect(visibleText(html)).toContain('fn main() {}');
    // The <style> block always declares .token-* rules; assert no span uses one.
    expect(html).not.toMatch(/<span class="token token-/);
  });

  it('hides the fence marker from visible text', () => {
    expect(visibleText(render('```cpp\nint x = 1;\n```'))).not.toContain('```');
  });
});

describe('AC6: block rendering and code affordances', () => {
  it('renders bold, emphasis, inline code, and lists', () => {
    expect(render('**b**')).toContain('<strong>');
    expect(render('*e*')).toContain('<em>');
    expect(render('`c`')).toContain('<code');
    expect(render('- a\n- b')).toContain('<ul');
    expect(render('1. a')).toContain('<ol');
  });

  it('renders a hard break as <br/>', () => {
    expect(render('one\ntwo')).toContain('<br/>');
  });

  it('renders one line number per code line', () => {
    const html = render('```cpp\na\nb\nc\n```');
    const gutter = /aria-hidden="true"[^>]*>(.*?)<\/div><pre/s.exec(html);
    expect(gutter).not.toBeNull();
    expect(gutter![1].match(/<div>/g) ?? []).toHaveLength(3);
  });

  it('offers a copy control on the code block', () => {
    expect(render('```cpp\nx\n```')).toContain('Copy');
  });
});

describe('AC10: TICKET_597 algorithm cards', () => {
  it('places a card after a bold-header algorithm block', () => {
    const html = render('**SuperTrend**\nA trend indicator.', [algorithm()]);
    expect(html).toContain('Indicator');
    expect(html).toContain('Code Ready');
  });

  it('places a card for each of several algorithms', () => {
    const content = [
      '**SuperTrend**',
      'First description.',
      '',
      '**MeanRev**',
      'Second description.',
    ].join('\n');

    const items = placeAlgorithmCards(parseChatMarkdown(content), [
      algorithm({ name: 'SuperTrend', id: 'a' }),
      algorithm({ name: 'MeanRev', id: 'b', strategy_type: 'mean_reversion' }),
    ]);

    expect(items.filter((i) => i.kind === 'card')).toHaveLength(2);
  });

  it('places the final algorithm card even with no trailing content', () => {
    const items = placeAlgorithmCards(parseChatMarkdown('**SuperTrend**\nOnly one.'), [
      algorithm(),
    ]);
    expect(items[items.length - 1].kind).toBe('card');
  });

  it('matches a list-item algorithm header of the form `Name (id)`', () => {
    const items = placeAlgorithmCards(parseChatMarkdown('- SuperTrend (st-1)\n- other'), [
      algorithm(),
    ]);
    expect(items.some((i) => i.kind === 'card')).toBe(true);
  });

  it('matches a plain-text `Name (id)` header', () => {
    const items = placeAlgorithmCards(parseChatMarkdown('SuperTrend (st-1) is a trend tool.'), [
      algorithm(),
    ]);
    expect(items.some((i) => i.kind === 'card')).toBe(true);
  });

  it('ends an algorithm block at a non-algorithm bold header', () => {
    const content = ['**SuperTrend**', 'Description.', '**Summary**', 'Wrap up.'].join('\n\n');
    const items = placeAlgorithmCards(parseChatMarkdown(content), [algorithm()]);

    const cardIndex = items.findIndex((i) => i.kind === 'card');
    const summaryIndex = items.findIndex(
      (i) => i.kind === 'block' && JSON.stringify(i.block).includes('Summary'),
    );
    expect(cardIndex).toBeGreaterThan(-1);
    expect(cardIndex).toBeLessThan(summaryIndex);
  });

  it('places a card adjacent to a fenced code block without disturbing it', () => {
    const content = '**SuperTrend**\nUses ATR.\n\n```cpp\nint x = 1;\n```';
    const html = render(content, [algorithm()]);
    expect(html).toContain('Indicator');
    expect(html).toContain('chat-code');
    expect(visibleText(html)).not.toContain('```');
  });

  it('renders a Reference Only badge when the algorithm is not rule-extractable', () => {
    const html = render('**SuperTrend**\nx', [algorithm({ rule_extractable: false })]);
    expect(html).toContain('Reference Only');
    expect(html).not.toContain('Code Ready');
  });

  it('falls back to the Other badge for an unknown strategy type', () => {
    const html = renderToStaticMarkup(
      createElement(AlgorithmCard, {
        algorithm: algorithm({ strategy_type: 'not-a-real-type' }),
        t: (_key: string, options?: { defaultValue: string }) => options?.defaultValue ?? _key,
      }),
    );
    expect(html).toContain('Other');
  });

  it('places each algorithm at most once even if named again later', () => {
    const content = '**SuperTrend**\nFirst.\n\n**Recap**\n\n**SuperTrend**\nAgain.';
    const items = placeAlgorithmCards(parseChatMarkdown(content), [algorithm()]);
    expect(items.filter((i) => i.kind === 'card')).toHaveLength(1);
  });

  it('returns blocks unchanged when there is no metadata', () => {
    const blocks = parseChatMarkdown('**SuperTrend**\nx');
    expect(placeAlgorithmCards(blocks, undefined).every((i) => i.kind === 'block')).toBe(true);
    expect(placeAlgorithmCards(blocks, []).every((i) => i.kind === 'block')).toBe(true);
  });

  it('leaves content unchanged when no algorithm name matches', () => {
    const items = placeAlgorithmCards(parseChatMarkdown('**Unrelated**\nx'), [algorithm()]);
    expect(items.every((i) => i.kind === 'block')).toBe(true);
  });
});

describe('AC11: XSS safety across every content shape', () => {
  const PAYLOAD = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  // Includes the SVG primitives the lucide copy/check icons render.
  const ADAPTER_TAGS =
    /<\/?(?:div|p|span|strong|em|code|pre|ul|ol|li|br|button|style|svg|path|polyline|circle|line|rect)[\s/>]/g;

  const shapes: Record<string, string> = {
    'plain text': PAYLOAD,
    'strong text': `**${PAYLOAD}**`,
    'emphasis text': `*${PAYLOAD}*`,
    'inline code': `\`${PAYLOAD}\``,
    'list item': `- ${PAYLOAD}`,
    'fenced code': `\`\`\`cpp\n${PAYLOAD}\n\`\`\``,
  };

  for (const [shape, content] of Object.entries(shapes)) {
    describe(shape, () => {
      const html = render(content);

      it('emits no script or image element', () => {
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<img');
      });

      it('opens no element other than the adapter\'s own tags', () => {
        expect(html.replace(ADAPTER_TAGS, '')).not.toContain('<');
      });

      it('shows the payload escaped as inert text', () => {
        expect(html).toContain('&lt;script&gt;');
      });
    });
  }

  it('renders hostile algorithm metadata inertly', () => {
    const html = render('**SuperTrend**\nx', [
      algorithm({ strategy_type: PAYLOAD, name: 'SuperTrend' }),
    ]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html.replace(ADAPTER_TAGS, '')).not.toContain('<');
  });

  it('never uses dangerouslySetInnerHTML as a rendering call', () => {
    for (const relative of ['../ChatContent.tsx', '../AlgorithmCardList.tsx', '../MessageBubble.tsx']) {
      expect(readSource(relative)).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    }
  });
});

describe('AC12: streaming', () => {
  const frames = [
    'Intro\n```cpp\n',
    'Intro\n```cpp\nint x',
    'Intro\n```cpp\nint x = 1;',
    'Intro\n```cpp\nint x = 1;\n```',
    'Intro\n```cpp\nint x = 1;\n```\nDone.',
  ];

  it('keeps exactly one code-block wrapper through every frame', () => {
    for (const frame of frames) {
      expect(render(frame).match(/class="chat-code[^"]*"/g) ?? []).toHaveLength(1);
    }
  });

  it('never exposes the fence marker mid-stream', () => {
    for (const frame of frames) {
      expect(visibleText(render(frame))).not.toContain('```');
    }
  });
});

describe('AC14: cross-surface parity', () => {
  // Guide WebUI resolves React 19 and this plugin React 18, so the adapters
  // cannot be co-rendered. Both render PARITY_FIXTURE and assert against the
  // same shared fingerprint; the matching block lives in the WebUI suite.
  const fingerprint = parityFingerprint();
  const html = render(PARITY_FIXTURE);

  it('emits the fingerprint token classes in order', () => {
    const emitted = [...html.matchAll(/<span class="token (token-[a-z-]+)"/g)].map((m) => m[1]);
    expect(emitted).toEqual(fingerprint.tokenClasses);
  });

  it('emits the fingerprint inline element counts', () => {
    expect(html.match(/<strong>/g) ?? []).toHaveLength(fingerprint.strongCount);
    expect(html.match(/<em>/g) ?? []).toHaveLength(fingerprint.emphasisCount);
    expect(html.match(/<li>/g) ?? []).toHaveLength(fingerprint.listItemCount);
  });

  it('renders one gutter line per code line', () => {
    expect(html.match(/<div>\d+<\/div>/g) ?? []).toHaveLength(fingerprint.codeLineCount);
  });

  it('labels the block with the fingerprint language', () => {
    expect(html).toContain(fingerprint.codeLanguage);
  });

  it('shows every required text fragment', () => {
    for (const fragment of fingerprint.visibleFragments) {
      expect(visibleText(html)).toContain(fragment);
    }
  });

  it('shows no forbidden markup fragment', () => {
    for (const fragment of fingerprint.forbiddenFragments) {
      expect(visibleText(html)).not.toContain(fragment);
    }
  });
});

describe('AC9: no local markdown parser remains in AI Studio', () => {
  const source = readSource('../MessageBubble.tsx');

  it('MessageBubble contains no fence or emphasis regex', () => {
    expect(source).not.toContain('```(\\w*)');
    expect(source).not.toMatch(/replace\(\/\\\*\\\*/);
  });

  it('MessageBubble delegates to ChatContent', () => {
    expect(source).toContain('ChatContent');
  });

  it('the HTML-string injectAlgorithmCards path is gone', () => {
    expect(readSource('../AlgorithmCardList.tsx')).not.toContain('injectAlgorithmCards');
    expect(source).not.toContain('injectAlgorithmCards');
  });
});
