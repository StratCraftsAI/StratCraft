/**
 * TICKET_1318 AC3 / AC14: the authoritative markdown AST -- every block and
 * inline node kind, mixed content, malformed input, and streaming transitions.
 */

import { describe, expect, it } from 'vitest';
import { parseChatMarkdown, parseInline, type ChatBlock, type InlineNode } from '../markdown.js';

/** Flatten an inline tree to its visible text, as a renderer would display it. */
function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return node.content;
      if (node.type === 'inlineCode') return node.content;
      if (node.type === 'hardBreak') return '\n';
      return inlineText(node.children);
    })
    .join('');
}

/** Flatten every block to visible text -- used for "no fence marker" assertions. */
function visibleText(blocks: ChatBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'code') return block.content;
      if (block.type === 'paragraph' || block.type === 'heading') {
        return inlineText(block.children);
      }
      if (block.type === 'table') {
        return [block.header, ...block.rows].map((row) => row.map(inlineText).join(' ')).join('\n');
      }
      return block.items.map(inlineText).join('\n');
    })
    .join('\n');
}

describe('parseChatMarkdown -- blocks', () => {
  it('returns nothing for empty input', () => {
    expect(parseChatMarkdown('')).toEqual([]);
  });

  it('returns nothing for whitespace-only input', () => {
    expect(parseChatMarkdown('\n\n   \n')).toEqual([]);
  });

  it('parses a single paragraph', () => {
    const blocks = parseChatMarkdown('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'paragraph', sourceStart: 0 });
  });

  it('splits paragraphs on blank lines', () => {
    const blocks = parseChatMarkdown('First para\n\nSecond para');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(inlineText((blocks[0] as { children: InlineNode[] }).children)).toBe('First para');
    expect(inlineText((blocks[1] as { children: InlineNode[] }).children)).toBe('Second para');
  });

  it('keeps a single newline inside a paragraph as a hard break', () => {
    const blocks = parseChatMarkdown('line one\nline two');
    expect(blocks).toHaveLength(1);
    const children = (blocks[0] as { children: InlineNode[] }).children;
    expect(children.filter((n) => n.type === 'hardBreak')).toHaveLength(1);
  });

  it('parses an unordered list into one block with per-item inline trees', () => {
    const blocks = parseChatMarkdown('- alpha\n- beta\n- gamma');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('unorderedList');
    const items = (blocks[0] as { items: InlineNode[][] }).items;
    expect(items.map(inlineText)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it.each(['-', '*', '+'])('accepts %s as an unordered list marker', (marker) => {
    const blocks = parseChatMarkdown(`${marker} item`);
    expect(blocks[0].type).toBe('unorderedList');
  });

  it('parses an ordered list', () => {
    const blocks = parseChatMarkdown('1. first\n2. second');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('orderedList');
    expect((blocks[0] as { items: InlineNode[][] }).items.map(inlineText)).toEqual([
      'first',
      'second',
    ]);
  });

  it('accepts `)` as an ordered list delimiter', () => {
    expect(parseChatMarkdown('1) first')[0].type).toBe('orderedList');
  });

  it('starts a new block when the list kind changes', () => {
    const blocks = parseChatMarkdown('- bullet\n1. numbered');
    expect(blocks.map((b) => b.type)).toEqual(['unorderedList', 'orderedList']);
  });

  it('ends a paragraph when a list begins', () => {
    const blocks = parseChatMarkdown('Intro text\n- item');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'unorderedList']);
  });

  it('parses a fenced code block with its language', () => {
    const blocks = parseChatMarkdown('```cpp\nint x = 1;\n```');
    expect(blocks).toEqual([
      {
        type: 'code',
        content: 'int x = 1;',
        language: 'cpp',
        closed: true,
        sourceStart: 0,
        sourceEnd: 21,
      },
    ]);
  });

  it('never interprets markdown inside a code block', () => {
    const blocks = parseChatMarkdown('```cpp\n// **not bold** and - not a list\n```');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { content: string }).content).toBe('// **not bold** and - not a list');
  });

  it('parses mixed prose, list, and code in source order', () => {
    const raw = [
      '**Larry Williams** volatility breakout:',
      '',
      '- computes a daily range',
      '- enters on the breakout',
      '',
      '```cpp',
      'double range = high - low;',
      '```',
      'Done.',
    ].join('\n');

    const blocks = parseChatMarkdown(raw);
    expect(blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'unorderedList',
      'code',
      'paragraph',
    ]);
    expect(visibleText(blocks)).not.toContain('```');
    expect(visibleText(blocks)).not.toContain('**');
  });

  it('assigns non-decreasing source offsets to every block', () => {
    const blocks = parseChatMarkdown('a\n\n- b\n\n```cpp\nc\n```\n\nd');
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].sourceStart).toBeGreaterThan(blocks[i - 1].sourceStart);
    }
  });

  it('marks an unterminated fence as open (AC12)', () => {
    const blocks = parseChatMarkdown('Intro\n```cpp\nint x = 1;');
    expect(blocks[1]).toMatchObject({ type: 'code', closed: false, content: 'int x = 1;' });
  });

  it('keeps the code block key stable across streaming frames (AC12)', () => {
    const frames = [
      'Intro\n```cpp\n',
      'Intro\n```cpp\nint x',
      'Intro\n```cpp\nint x = 1;\n```',
    ];
    const keys = frames.map((frame) => {
      const code = parseChatMarkdown(frame).find((b) => b.type === 'code')!;
      return `${code.type}:${code.sourceStart}`;
    });
    expect(new Set(keys).size).toBe(1);
  });

  it('renders raw HTML as inert text rather than markup (AC11)', () => {
    const blocks = parseChatMarkdown('<script>alert(1)</script>');
    expect(blocks).toHaveLength(1);
    expect(inlineText((blocks[0] as { children: InlineNode[] }).children)).toBe(
      '<script>alert(1)</script>',
    );
  });
});

describe('parseInline', () => {
  it('returns nothing for an empty line', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('parses plain text as a single node', () => {
    expect(parseInline('hello')).toEqual([{ type: 'text', content: 'hello' }]);
  });

  it('parses **strong**', () => {
    expect(parseInline('**Larry Williams**')).toEqual([
      { type: 'strong', children: [{ type: 'text', content: 'Larry Williams' }] },
    ]);
  });

  it('parses *emphasis*', () => {
    expect(parseInline('*subtle*')).toEqual([
      { type: 'emphasis', children: [{ type: 'text', content: 'subtle' }] },
    ]);
  });

  it('prefers strong over emphasis for a double delimiter', () => {
    expect(parseInline('**bold**')[0].type).toBe('strong');
  });

  it('parses `inline code`', () => {
    expect(parseInline('call `foo()` now')).toEqual([
      { type: 'text', content: 'call ' },
      { type: 'inlineCode', content: 'foo()' },
      { type: 'text', content: ' now' },
    ]);
  });

  it('does not interpret markdown inside inline code', () => {
    expect(parseInline('`a * b ** c`')).toEqual([{ type: 'inlineCode', content: 'a * b ** c' }]);
  });

  it('parses nested emphasis inside strong', () => {
    const nodes = parseInline('**bold *and italic***');
    expect(nodes[0].type).toBe('strong');
    const children = (nodes[0] as { children: InlineNode[] }).children;
    expect(children.some((n) => n.type === 'emphasis')).toBe(true);
  });

  it('parses several inline spans on one line', () => {
    const nodes = parseInline('**a** then `b` then *c*');
    expect(nodes.map((n) => n.type)).toEqual([
      'strong',
      'text',
      'inlineCode',
      'text',
      'emphasis',
    ]);
  });

  it('leaves an unmatched delimiter literal while streaming', () => {
    expect(parseInline('**Larry Willi')).toEqual([{ type: 'text', content: '**Larry Willi' }]);
    expect(parseInline('a ` b')).toEqual([{ type: 'text', content: 'a ` b' }]);
  });

  it('leaves a lone asterisk literal', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', content: '2 * 3 = 6' }]);
  });

  it('handles an inline span at the start and end of the line', () => {
    expect(parseInline('**a**')).toHaveLength(1);
    expect(parseInline('x**a**')).toHaveLength(2);
  });

  it('escapes nothing -- delimiters are structure, content stays verbatim', () => {
    expect(parseInline('**<b>x</b>**')).toEqual([
      { type: 'strong', children: [{ type: 'text', content: '<b>x</b>' }] },
    ]);
  });
});
