/**
 * TICKET_1318_1: ATX headings and GFM pipe tables in the shared markdown AST.
 *
 * The regression these pin is the one captured live in `logs/1.txt`: agent
 * output containing `###  Core Strategy Rules` and a pipe table rendered both
 * as literal source text, because `ChatBlock` had no variant for either and
 * every unrecognized line fell through to `consumeParagraph()`.
 */

import { describe, expect, it } from 'vitest';
import { parseChatMarkdown, type ChatBlock, type InlineNode } from '../markdown.js';

/** Flatten an inline tree to the text a renderer would display. */
function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'inlineCode') return node.content;
      if (node.type === 'hardBreak') return '\n';
      return inlineText(node.children);
    })
    .join('');
}

function headingsOf(blocks: ChatBlock[]) {
  return blocks.filter((block) => block.type === 'heading');
}

function tablesOf(blocks: ChatBlock[]) {
  return blocks.filter((block) => block.type === 'table');
}

/** The exact heading + table content the live transcript produced. */
const LIVE_TRANSCRIPT = [
  '###  Core Strategy Rules',
  '',
  'Indicators Used: Williams %R (14-period)',
  '',
  '| Direction | Entry Condition | Exit Condition |',
  '|-----------|----------------|----------------|',
  '| Long | Williams %R(14) < -80 (oversold) | Williams %R(14) > -20 |',
  '| Short | Williams %R(14) > -20 (overbought) | Williams %R(14) < -80 |',
].join('\n');

// -----------------------------------------------------------------------------
// AC1 -- ATX headings
// -----------------------------------------------------------------------------

describe('AC1: ATX headings', () => {
  it.each([1, 2, 3, 4, 5, 6])('parses a level-%i heading', (level) => {
    const blocks = parseChatMarkdown(`${'#'.repeat(level)} Title`);
    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'heading',
        level,
        children: [{ type: 'text', content: 'Title' }],
      }),
    ]);
  });

  it('strips the marker and every space after it', () => {
    // The live transcript used two spaces after `###`.
    const [heading] = headingsOf(parseChatMarkdown('###  Core Strategy Rules'));
    expect(inlineText(heading.children)).toBe('Core Strategy Rules');
    expect(inlineText(heading.children)).not.toContain('#');
  });

  it('parses inline markup inside heading text', () => {
    const [heading] = headingsOf(parseChatMarkdown('## **Bold** and *italic* and `code`'));
    expect(heading.children.map((node) => node.type)).toEqual([
      'strong',
      'text',
      'emphasis',
      'text',
      'inlineCode',
    ]);
  });

  it('drops an optional closing hash run', () => {
    const [heading] = headingsOf(parseChatMarkdown('## Title ##'));
    expect(inlineText(heading.children)).toBe('Title');
  });

  it('keeps a hash that is part of the content', () => {
    const [heading] = headingsOf(parseChatMarkdown('## C#'));
    expect(inlineText(heading.children)).toBe('C#');
  });

  it('rejects a hash run with no following space', () => {
    const blocks = parseChatMarkdown('#hashtag');
    expect(blocks[0].type).toBe('paragraph');
  });

  it('rejects a seventh hash', () => {
    const blocks = parseChatMarkdown('####### too deep');
    expect(blocks[0].type).toBe('paragraph');
  });

  it('rejects a hash run with no content', () => {
    const blocks = parseChatMarkdown('###');
    expect(blocks[0].type).toBe('paragraph');
  });

  it('starts a new block when a heading follows paragraph text', () => {
    // Without the heading guard in consumeParagraph the heading would be
    // swallowed into the preceding paragraph as a hardBreak line.
    const blocks = parseChatMarkdown('intro text\n## Heading');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'heading']);
  });

  it('does not interpret a hash inside a fenced block', () => {
    const blocks = parseChatMarkdown('```cpp\n#include <vector>\n```');
    expect(blocks.map((block) => block.type)).toEqual(['code']);
  });

  it('keeps stable source anchors', () => {
    const [heading] = headingsOf(parseChatMarkdown('lead\n\n## Title'));
    expect(heading.sourceStart).toBe(6);
    expect(heading.sourceEnd).toBe(14);
  });
});

// -----------------------------------------------------------------------------
// AC2 -- GFM pipe tables
// -----------------------------------------------------------------------------

describe('AC2: GFM pipe tables', () => {
  it('parses the live transcript table', () => {
    const [table] = tablesOf(parseChatMarkdown(LIVE_TRANSCRIPT));
    expect(table.header.map(inlineText)).toEqual([
      'Direction',
      'Entry Condition',
      'Exit Condition',
    ]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].map(inlineText)).toEqual([
      'Long',
      'Williams %R(14) < -80 (oversold)',
      'Williams %R(14) > -20',
    ]);
  });

  it('renders the live transcript as heading + paragraph + table', () => {
    expect(parseChatMarkdown(LIVE_TRANSCRIPT).map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'table',
    ]);
  });

  it('never leaks pipe or delimiter markup to the reader', () => {
    const [table] = tablesOf(parseChatMarkdown(LIVE_TRANSCRIPT));
    const text = [table.header, ...table.rows].flat().map(inlineText).join(' ');
    expect(text).not.toContain('|');
    expect(text).not.toContain('---');
  });

  it('accepts rows without leading and trailing pipes', () => {
    const [table] = tablesOf(parseChatMarkdown('a | b\n--- | ---\n1 | 2'));
    expect(table.header.map(inlineText)).toEqual(['a', 'b']);
    expect(table.rows[0].map(inlineText)).toEqual(['1', '2']);
  });

  it('parses inline markup inside cells', () => {
    const [table] = tablesOf(parseChatMarkdown('| h |\n| --- |\n| **b** `c` |'));
    expect(table.rows[0][0].map((node) => node.type)).toEqual(['strong', 'text', 'inlineCode']);
  });

  it('treats an escaped pipe as literal content, not a separator', () => {
    const [table] = tablesOf(parseChatMarkdown('| expr |\n| --- |\n| a \\| b |'));
    expect(table.rows[0]).toHaveLength(1);
    expect(inlineText(table.rows[0][0])).toBe('a | b');
  });

  it('keeps a table with an empty body', () => {
    const [table] = tablesOf(parseChatMarkdown('| a | b |\n| --- | --- |'));
    expect(table.header).toHaveLength(2);
    expect(table.rows).toEqual([]);
  });

  it('ends the table at the first non-pipe line', () => {
    const blocks = parseChatMarkdown('| a |\n| --- |\n| 1 |\n\nafter');
    expect(blocks.map((block) => block.type)).toEqual(['table', 'paragraph']);
  });

  it('keeps stable source anchors', () => {
    const [table] = tablesOf(parseChatMarkdown('| a |\n| --- |\n| 1 |'));
    expect(table.sourceStart).toBe(0);
    expect(table.sourceEnd).toBe(19);
  });

  it('does not interpret pipes inside a fenced block', () => {
    const blocks = parseChatMarkdown('```\n| a |\n| --- |\n```');
    expect(blocks.map((block) => block.type)).toEqual(['code']);
  });
});

describe('AC2: column alignment', () => {
  it.each([
    ['---', null],
    [':---', 'left'],
    ['---:', 'right'],
    [':---:', 'center'],
  ])('reads %s as %s', (delimiter, expected) => {
    const [table] = tablesOf(parseChatMarkdown(`| h |\n| ${delimiter} |\n| v |`));
    expect(table.alignments).toEqual([expected]);
  });

  it('reads a mixed delimiter row', () => {
    const [table] = tablesOf(parseChatMarkdown('| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |'));
    expect(table.alignments).toEqual(['left', 'center', 'right']);
  });

  it('accepts a single-dash delimiter cell', () => {
    const [table] = tablesOf(parseChatMarkdown('| a |\n| - |\n| 1 |'));
    expect(table.alignments).toEqual([null]);
  });
});

// -----------------------------------------------------------------------------
// AC3 -- malformed tables degrade to paragraphs
// -----------------------------------------------------------------------------

describe('AC3: malformed tables degrade to paragraph text', () => {
  it('rejects a pipe row with no delimiter row', () => {
    const blocks = parseChatMarkdown('| a | b |\n| 1 | 2 |');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  it('rejects a delimiter row with a different cell count', () => {
    const blocks = parseChatMarkdown('| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  it('rejects a delimiter row containing a non-delimiter cell', () => {
    const blocks = parseChatMarkdown('| a | b |\n| --- | xx |\n| 1 | 2 |');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  it('rejects a header line with no pipe at all', () => {
    const blocks = parseChatMarkdown('not a table\n| --- |');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  it('rejects a second line with no pipe', () => {
    const blocks = parseChatMarkdown('| a |\nplain text');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  it('rejects a header whose only pipe is escaped', () => {
    const blocks = parseChatMarkdown('a \\| b\n| --- |');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
  });

  it('loses no text when it degrades', () => {
    const blocks = parseChatMarkdown('| a | b |\n| 1 | 2 |');
    expect(blocks[0].type).toBe('paragraph');
    const paragraph = blocks[0];
    if (paragraph.type !== 'paragraph') throw new Error('expected a paragraph');
    expect(inlineText(paragraph.children)).toBe('| a | b |\n| 1 | 2 |');
  });
});

// -----------------------------------------------------------------------------
// AC4 -- ragged rows are normalized
// -----------------------------------------------------------------------------

describe('AC4: ragged body rows', () => {
  it('pads a short row with empty cells', () => {
    const [table] = tablesOf(parseChatMarkdown('| a | b | c |\n|---|---|---|\n| 1 |'));
    expect(table.rows[0]).toHaveLength(3);
    expect(table.rows[0].map(inlineText)).toEqual(['1', '', '']);
  });

  it('truncates a long row', () => {
    const [table] = tablesOf(parseChatMarkdown('| a | b |\n|---|---|\n| 1 | 2 | 3 |'));
    expect(table.rows[0]).toHaveLength(2);
    expect(table.rows[0].map(inlineText)).toEqual(['1', '2']);
  });

  it('makes every row exactly as wide as the header', () => {
    const [table] = tablesOf(
      parseChatMarkdown('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n| 1 | 2 | 3 |'),
    );
    for (const row of table.rows) expect(row).toHaveLength(table.header.length);
  });
});

// -----------------------------------------------------------------------------
// AC5 -- streaming safety
// -----------------------------------------------------------------------------

describe('AC5: streaming safety', () => {
  /** Every prefix of the transcript, as a stream would deliver it. */
  const prefixes = Array.from(
    { length: LIVE_TRANSCRIPT.length + 1 },
    (_, i) => LIVE_TRANSCRIPT.slice(0, i),
  );

  it('never throws on any prefix of a streaming table', () => {
    for (const prefix of prefixes) {
      expect(() => parseChatMarkdown(prefix)).not.toThrow();
    }
  });

  it('keeps a header-only table as paragraph text until the delimiter arrives', () => {
    const before = parseChatMarkdown('| a | b |');
    expect(before.map((block) => block.type)).toEqual(['paragraph']);

    const after = parseChatMarkdown('| a | b |\n| --- | --- |');
    expect(after.map((block) => block.type)).toEqual(['table']);
  });

  it('accepts a body row arriving mid-line', () => {
    const [table] = tablesOf(parseChatMarkdown('| a | b |\n| --- | --- |\n| 1 | 2'));
    expect(table.rows[0].map(inlineText)).toEqual(['1', '2']);
  });

  it('keeps a partial heading marker as text', () => {
    expect(parseChatMarkdown('##')[0].type).toBe('paragraph');
  });

  it('never swallows content that follows a partial table', () => {
    const blocks = parseChatMarkdown('| a | b |\n\nfollowing paragraph');
    expect(blocks).toHaveLength(2);
    const last = blocks[1];
    if (last.type !== 'paragraph') throw new Error('expected a paragraph');
    expect(inlineText(last.children)).toBe('following paragraph');
  });
});

// -----------------------------------------------------------------------------
// AC8 -- hostile content stays inert data
// -----------------------------------------------------------------------------

describe('AC8: XSS safety', () => {
  it('keeps a script tag in a heading as literal text', () => {
    const [heading] = headingsOf(parseChatMarkdown('## <script>alert(1)</script>'));
    expect(inlineText(heading.children)).toBe('<script>alert(1)</script>');
    expect(heading.children.every((node) => node.type === 'text')).toBe(true);
  });

  it('keeps an event-handler payload in a cell as literal text', () => {
    const [table] = tablesOf(
      parseChatMarkdown('| h |\n| --- |\n| <img src=x onerror=alert(1)> |'),
    );
    expect(inlineText(table.rows[0][0])).toBe('<img src=x onerror=alert(1)>');
  });

  it('produces only typed nodes, never raw markup strings', () => {
    const blocks = parseChatMarkdown('## <b>h</b>\n\n| <i>c</i> |\n| --- |\n| <u>v</u> |');
    for (const block of blocks) {
      expect(['heading', 'table']).toContain(block.type);
    }
  });
});
