/**
 * The authoritative chat markdown AST -- TICKET_1318 AC3.
 *
 * Every surface that renders LLM chat output consumes `parseChatMarkdown()`.
 * No surface may independently decide bold, emphasis, inline code, lists, line
 * breaks, fenced blocks, or fence language.
 *
 * The supported dialect is deliberately bounded: paragraphs, ATX headings,
 * GFM pipe tables, unordered lists, ordered lists, fenced code, and the inline
 * nodes below. Raw HTML is not part of the contract -- it stays inert text, and
 * renderers create React text nodes from it rather than trusted HTML.
 */

import { splitContentSegments, type Segment } from './segment.js';
import type { CodeLanguage } from './language.js';

export type InlineNode =
  | { type: 'text'; content: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'emphasis'; children: InlineNode[] }
  | { type: 'inlineCode'; content: string }
  | { type: 'hardBreak' };

/** Column alignment declared by a table's delimiter row. */
export type TableAlignment = 'left' | 'center' | 'right';

export type ChatBlock =
  | {
      type: 'paragraph';
      children: InlineNode[];
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: 'heading';
      /** ATX depth, 1..6. */
      level: number;
      children: InlineNode[];
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: 'table';
      header: InlineNode[][];
      /** One entry per column; `null` where the delimiter declared no alignment. */
      alignments: (TableAlignment | null)[];
      /** Body rows, each normalized to exactly `header.length` cells. */
      rows: InlineNode[][][];
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: 'unorderedList';
      items: InlineNode[][];
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: 'orderedList';
      items: InlineNode[][];
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: 'code';
      content: string;
      language: CodeLanguage | null;
      closed: boolean;
      sourceStart: number;
      sourceEnd: number;
    };

const UNORDERED_ITEM = /^[ \t]*[-*+][ \t]+(.*)$/;
const ORDERED_ITEM = /^[ \t]*\d+[.)][ \t]+(.*)$/;
/**
 * ATX heading. The space after the `#` run is required -- `#hashtag` is not a
 * heading -- and `{1,6}` plus the `[^#]` guard reject a seventh `#`, so
 * `####### x` stays paragraph text as CommonMark specifies.
 */
const ATX_HEADING = /^[ \t]*(#{1,6})[ \t]+(?=[^#\s]|#*[^#\s])(.*)$/;
/** A line is table-shaped if it carries an unescaped pipe. */
const TABLE_ROW = /(^|[^\\])\|/;
/** One delimiter cell: `---`, `:---`, `---:`, or `:---:`. */
const DELIMITER_CELL = /^:?-+:?$/;

/**
 * Parse raw chat content into the authoritative block sequence.
 *
 * Fences are segmented first so markdown inside a code block is never
 * interpreted. Within a text segment, consecutive list lines of the same kind
 * group into one list block, and runs of non-list lines become paragraphs split
 * on blank lines with single newlines preserved as hard breaks.
 */
export function parseChatMarkdown(raw: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];

  for (const segment of splitContentSegments(raw)) {
    if (segment.type === 'code') {
      blocks.push({
        type: 'code',
        content: segment.content,
        language: segment.language,
        closed: segment.closed,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
      });
      continue;
    }
    parseTextSegment(segment, blocks);
  }

  return blocks;
}

/** Line with its absolute offsets, so every block keeps stable source anchors. */
interface SourceLine {
  text: string;
  start: number;
  end: number;
}

function parseTextSegment(segment: Segment & { type: 'text' }, blocks: ChatBlock[]): void {
  const lines = splitLines(segment.content, segment.sourceStart);

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.text.trim() === '') {
      index += 1;
      continue;
    }

    const heading = ATX_HEADING.exec(line.text);
    if (heading !== null) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(stripClosingSequence(heading[2])),
        sourceStart: line.start,
        sourceEnd: line.end,
      });
      index += 1;
      continue;
    }

    const listKind = listKindOf(line.text);
    if (listKind !== null) {
      index = consumeList(lines, index, listKind, blocks);
      continue;
    }

    // A table needs its delimiter row to already be present, so a half-streamed
    // table stays paragraph text until it is unambiguous (AC5).
    const table = consumeTable(lines, index, blocks);
    if (table !== null) {
      index = table;
      continue;
    }

    index = consumeParagraph(lines, index, blocks);
  }
}

type ListKind = 'unorderedList' | 'orderedList';

function listKindOf(text: string): ListKind | null {
  if (UNORDERED_ITEM.test(text)) return 'unorderedList';
  if (ORDERED_ITEM.test(text)) return 'orderedList';
  return null;
}

/** Consume a run of same-kind list lines into one list block. */
function consumeList(
  lines: SourceLine[],
  start: number,
  kind: ListKind,
  blocks: ChatBlock[],
): number {
  const items: InlineNode[][] = [];
  let index = start;

  while (index < lines.length && listKindOf(lines[index].text) === kind) {
    const pattern = kind === 'unorderedList' ? UNORDERED_ITEM : ORDERED_ITEM;
    const match = pattern.exec(lines[index].text);
    /* c8 ignore next -- listKindOf already proved the pattern matches */
    items.push(parseInline(match ? match[1] : ''));
    index += 1;
  }

  blocks.push({
    type: kind,
    items,
    sourceStart: lines[start].start,
    sourceEnd: lines[index - 1].end,
  });
  return index;
}

/**
 * Consume a table starting at `start`, or return `null` if these lines are not
 * one.
 *
 * A table is a header row plus a delimiter row whose cell count matches. Any
 * other pipe-bearing text -- including a header whose delimiter has not streamed
 * in yet -- is rejected here and handled as a paragraph (AC3, AC5).
 */
function consumeTable(lines: SourceLine[], start: number, blocks: ChatBlock[]): number | null {
  const delimiterLine = lines[start + 1];
  if (delimiterLine === undefined) return null;
  if (!TABLE_ROW.test(lines[start].text) || !TABLE_ROW.test(delimiterLine.text)) return null;

  const headerCells = splitTableRow(lines[start].text);
  const delimiterCells = splitTableRow(delimiterLine.text);
  if (delimiterCells.length !== headerCells.length) return null;
  if (!delimiterCells.every((cell) => DELIMITER_CELL.test(cell))) return null;

  const rows: InlineNode[][][] = [];
  let index = start + 2;

  while (index < lines.length && TABLE_ROW.test(lines[index].text)) {
    const cells = splitTableRow(lines[index].text);
    // Ragged rows are normalized rather than dropped, so every table renders
    // rectangular (AC4).
    rows.push(
      Array.from({ length: headerCells.length }, (_, column) =>
        parseInline(unescapePipes(cells[column] ?? '')),
      ),
    );
    index += 1;
  }

  blocks.push({
    type: 'table',
    header: headerCells.map((cell) => parseInline(unescapePipes(cell))),
    alignments: delimiterCells.map(alignmentOf),
    rows,
    sourceStart: lines[start].start,
    sourceEnd: lines[index - 1].end,
  });
  return index;
}

/**
 * Split one table row into trimmed cells.
 *
 * Leading and trailing pipes are optional delimiters rather than empty cells;
 * `\|` is a literal pipe and does not split.
 */
function splitTableRow(text: string): string[] {
  const cells: string[] = [];
  let cell = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') {
      cell += '\\|';
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell);

  if (cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();

  return cells.map((value) => value.trim());
}

/** Turn `\|` into a literal pipe once the cell boundaries are already decided. */
function unescapePipes(cell: string): string {
  return cell.replace(/\\\|/g, '|');
}

function alignmentOf(cell: string): TableAlignment | null {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/**
 * Drop a heading's optional closing `#` run: `## Title ##` reads as `Title`.
 * A run not preceded by whitespace is content, so `## C#` keeps its `#`.
 */
function stripClosingSequence(text: string): string {
  return text.replace(/(^|[ \t])#+[ \t]*$/, '$1').trim();
}

/** Consume a run of non-list, non-blank lines into one paragraph block. */
function consumeParagraph(lines: SourceLine[], start: number, blocks: ChatBlock[]): number {
  const children: InlineNode[] = [];
  let index = start;

  while (
    index < lines.length &&
    lines[index].text.trim() !== '' &&
    listKindOf(lines[index].text) === null &&
    !ATX_HEADING.test(lines[index].text)
  ) {
    if (index > start) children.push({ type: 'hardBreak' });
    children.push(...parseInline(lines[index].text));
    index += 1;
  }

  blocks.push({
    type: 'paragraph',
    children,
    sourceStart: lines[start].start,
    sourceEnd: lines[index - 1].end,
  });
  return index;
}

function splitLines(content: string, offset: number): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  for (;;) {
    const newline = content.indexOf('\n', start);
    const end = newline === -1 ? content.length : newline;
    lines.push({
      text: content.slice(start, end),
      start: offset + start,
      end: offset + end,
    });
    if (newline === -1) break;
    start = newline + 1;
  }

  return lines;
}

// -----------------------------------------------------------------------------
// Inline parsing
// -----------------------------------------------------------------------------

/**
 * Inline delimiters, longest-first so `**` wins over `*`. Inline code is
 * scanned before emphasis so `` `a * b` `` keeps its asterisk literal.
 */
const INLINE_CODE = /`([^`\n]+)`/;
/**
 * `(?!\*)` makes the closing `**` the end of its asterisk run, so
 * `**bold *and italic***` closes the strong span at the final `***` and lets
 * the inner `*and italic*` parse as emphasis instead of leaving a stray `*`.
 */
const STRONG = /\*\*([\s\S]+?)\*\*(?!\*)/;
const EMPHASIS = /\*([^*\n]+)\*/;

/**
 * Parse one line of inline markdown. Unmatched delimiters stay literal text --
 * a stray `**` while streaming must not swallow the rest of the message.
 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;

  while (rest !== '') {
    const code = INLINE_CODE.exec(rest);
    const strong = STRONG.exec(rest);
    const emphasis = EMPHASIS.exec(rest);

    const next = earliest([
      code === null ? null : { index: code.index, match: code, kind: 'inlineCode' as const },
      strong === null ? null : { index: strong.index, match: strong, kind: 'strong' as const },
      emphasis === null
        ? null
        : { index: emphasis.index, match: emphasis, kind: 'emphasis' as const },
    ]);

    if (next === null) {
      pushText(nodes, rest);
      break;
    }

    pushText(nodes, rest.slice(0, next.index));

    if (next.kind === 'inlineCode') {
      nodes.push({ type: 'inlineCode', content: next.match[1] });
    } else {
      nodes.push({ type: next.kind, children: parseInline(next.match[1]) });
    }

    rest = rest.slice(next.index + next.match[0].length);
  }

  return nodes;
}

interface InlineCandidate {
  index: number;
  match: RegExpExecArray;
  kind: 'inlineCode' | 'strong' | 'emphasis';
}

/**
 * Pick the leftmost candidate. Ties break in array order, which is
 * inline-code > strong > emphasis -- so `**bold**` is never read as an
 * emphasis wrapping a `*bold*`.
 */
function earliest(candidates: (InlineCandidate | null)[]): InlineCandidate | null {
  let best: InlineCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate === null) continue;
    if (best === null || candidate.index < best.index) best = candidate;
  }
  return best;
}

function pushText(nodes: InlineNode[], content: string): void {
  if (content === '') return;
  nodes.push({ type: 'text', content });
}
