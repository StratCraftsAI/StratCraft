/**
 * Cross-surface parity fixture and fingerprint -- TICKET_1318 AC14.
 *
 * Guide WebUI (React 19) and the AI Studio plugin (React 18) resolve different
 * React majors, so they cannot be rendered inside one module graph. Parity is
 * therefore enforced by deriving the expected rendering shape here, from the
 * shared contract, and having each surface's own runtime test render
 * `PARITY_FIXTURE` and assert against `parityFingerprint()`.
 *
 * If either adapter drifts -- a different parse, a different token sequence,
 * different token classes, a different code line count, or a missing inline
 * element -- that surface's test fails against this single golden.
 */

import { parseChatMarkdown, type ChatBlock, type InlineNode, type TableAlignment } from './markdown.js';
import { tokenizeCode } from './highlight.js';
import type { CodeLanguage } from './language.js';

/** One fixture exercising every construct both surfaces must handle. */
export const PARITY_FIXTURE = [
  '## Core Strategy Rules',
  '',
  '**Larry Williams** volatility breakout:',
  '',
  '| Direction | Entry | Exit |',
  '|:---|:---:|---:|',
  '| Long | `range` breakout | *target* |',
  '| Short | reversal |',
  '',
  '- computes a daily `range`',
  '- enters on the *breakout*',
  '',
  '1. compute',
  '2. enter',
  '',
  '```cpp',
  '// entry rule',
  'class Breakout {',
  '  double range = high - low;',
  '  auto name = "larry";',
  '};',
  '```',
  '',
  'Done.',
].join('\n');

export interface ParityFingerprint {
  /** Block types in source order. */
  blockTypes: string[];
  /** Normalized language of the fenced block. */
  codeLanguage: CodeLanguage | null;
  /** Line count of the fenced block -- each surface's gutter must match. */
  codeLineCount: number;
  /** Canonical token classes emitted for the fenced block, in order. */
  tokenClasses: string[];
  /** Inline element counts every renderer must produce. */
  strongCount: number;
  emphasisCount: number;
  inlineCodeCount: number;
  listItemCount: number;
  /** ATX depths in source order -- each must become the matching `<h*>`. */
  headingLevels: number[];
  /** Column count of each table's header row. */
  tableColumnCounts: number[];
  /** Body row count of each table. */
  tableRowCounts: number[];
  /** Declared column alignments, flattened in source order. */
  tableAlignments: (TableAlignment | null)[];
  /** Text that must be visible to the reader. */
  visibleFragments: string[];
  /** Markup syntax that must never reach the reader. */
  forbiddenFragments: string[];
}

/** Derive the expected rendering fingerprint from the shared contract. */
export function parityFingerprint(): ParityFingerprint {
  const blocks = parseChatMarkdown(PARITY_FIXTURE);

  // `PARITY_FIXTURE` is a module constant containing exactly one fenced block,
  // and `parity.test.ts` pins that. Narrowing by filter keeps the invariant
  // expressed in the types rather than as an unreachable runtime guard.
  const [code] = blocks.filter((block) => block.type === 'code');

  let strongCount = 0;
  let emphasisCount = 0;
  let inlineCodeCount = 0;
  let listItemCount = 0;

  const headingLevels: number[] = [];
  const tableColumnCounts: number[] = [];
  const tableRowCounts: number[] = [];
  const tableAlignments: (TableAlignment | null)[] = [];

  for (const block of blocks) {
    if (block.type === 'code') continue;

    const groups = inlineGroupsOf(block);

    if (block.type === 'heading') {
      headingLevels.push(block.level);
    } else if (block.type === 'table') {
      tableColumnCounts.push(block.header.length);
      tableRowCounts.push(block.rows.length);
      tableAlignments.push(...block.alignments);
    } else if (block.type !== 'paragraph') {
      listItemCount += block.items.length;
    }

    for (const group of groups) {
      const counts = countInline(group);
      strongCount += counts.strong;
      emphasisCount += counts.emphasis;
      inlineCodeCount += counts.inlineCode;
    }
  }

  return {
    blockTypes: blocks.map((block) => block.type),
    codeLanguage: code.language,
    codeLineCount: code.content.split('\n').length,
    tokenClasses: tokenizeCode(code.content, code.language)
      .filter((token) => token.kind !== 'plain')
      .map((token) => `token-${token.kind}`),
    strongCount,
    emphasisCount,
    inlineCodeCount,
    listItemCount,
    headingLevels,
    tableColumnCounts,
    tableRowCounts,
    tableAlignments,
    visibleFragments: [
      'Larry Williams',
      'double range = high - low;',
      'Core Strategy Rules',
      'Direction',
      'reversal',
      'Done.',
    ],
    // `##` and `|---` must never survive to the reader, exactly as ``` and **
    // must not -- that is the whole defect TICKET_1318_1 fixes.
    forbiddenFragments: ['```', '**', '## ', '|---'],
  };
}

/** Every inline group a block contributes, so counting stays exhaustive. */
function inlineGroupsOf(block: Exclude<ChatBlock, { type: 'code' }>): InlineNode[][] {
  if (block.type === 'paragraph' || block.type === 'heading') return [block.children];
  if (block.type === 'table') return [...block.header, ...block.rows.flat()];
  return block.items;
}

interface InlineCounts {
  strong: number;
  emphasis: number;
  inlineCode: number;
}

/** Count inline elements, descending into nested strong/emphasis children. */
function countInline(nodes: InlineNode[]): InlineCounts {
  const counts: InlineCounts = { strong: 0, emphasis: 0, inlineCode: 0 };

  for (const node of nodes) {
    if (node.type === 'inlineCode') {
      counts.inlineCode += 1;
      continue;
    }
    if (node.type !== 'strong' && node.type !== 'emphasis') continue;

    if (node.type === 'strong') counts.strong += 1;
    else counts.emphasis += 1;

    const nested = countInline(node.children);
    counts.strong += nested.strong;
    counts.emphasis += nested.emphasis;
    counts.inlineCode += nested.inlineCode;
  }

  return counts;
}
