/**
 * Fenced-code segmentation -- TICKET_1318 AC3 / AC12.
 *
 * Splits raw chat content into alternating text and fenced-code segments. This
 * is the lower-level primitive under `parseChatMarkdown()`; it is exported so a
 * surface that only needs fence boundaries does not re-derive them.
 *
 * Streaming safety: a fence that has been opened but not closed yields a code
 * segment with `closed: false` carrying its complete partial body. Content is
 * never dropped and the fence marker is never exposed as visible text.
 *
 * Source offsets are UTF-16 code-unit indices into the raw JavaScript string.
 * Adapters use `type + sourceStart` as a stable React key so arrival of the
 * closing fence does not remount the code block.
 */

import { normalizeLanguage, type CodeLanguage } from './language.js';

export type Segment =
  | {
      type: 'text';
      content: string;
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

/** Matches a fence opener at the start of a line, capturing its language hint. */
const FENCE_OPEN = /(^|\n)[ \t]*```([^\n`]*)(?:\n|$)/;

/**
 * Split raw content into text and code segments.
 *
 * Only fences that begin a line open a code block, so a backtick run inside a
 * sentence stays text. Inside an open fence the first line-leading ``` closes
 * it; fence-like text on a non-leading column stays part of the code body.
 */
export function splitContentSegments(raw: string): Segment[] {
  const segments: Segment[] = [];
  if (raw === '') return segments;

  let cursor = 0;

  while (cursor < raw.length) {
    const rest = raw.slice(cursor);
    const open = FENCE_OPEN.exec(rest);

    if (!open) {
      // `cursor < raw.length` bounds the loop, so this tail is never empty.
      pushText(segments, raw.slice(cursor), cursor);
      break;
    }

    // `open[1]` is the newline that anchored the fence to a line start; it
    // belongs to the preceding text, not to the fence.
    const fenceStart = cursor + open.index + open[1].length;
    if (fenceStart > cursor) {
      pushText(segments, raw.slice(cursor, fenceStart), cursor);
    }

    const bodyStart = cursor + open.index + open[0].length;
    const language = normalizeLanguage(open[2]);
    const close = findClosingFence(raw, bodyStart);

    if (close === null) {
      segments.push({
        type: 'code',
        content: stripTrailingNewline(raw.slice(bodyStart)),
        language,
        closed: false,
        sourceStart: fenceStart,
        sourceEnd: raw.length,
      });
      break;
    }

    segments.push({
      type: 'code',
      content: stripTrailingNewline(raw.slice(bodyStart, close.bodyEnd)),
      language,
      closed: true,
      sourceStart: fenceStart,
      sourceEnd: close.fenceEnd,
    });
    cursor = close.fenceEnd;
  }

  return segments;
}

interface ClosingFence {
  /** Offset where the code body ends (before the closing fence line). */
  bodyEnd: number;
  /** Offset just past the closing fence line, where scanning resumes. */
  fenceEnd: number;
}

/**
 * Find the first line-leading ``` at or after `from`.
 *
 * Walks line by line; the final line (no trailing newline) is the loop's exit,
 * so every iteration either returns or advances past a newline.
 */
function findClosingFence(raw: string, from: number): ClosingFence | null {
  let lineStart = from;

  for (;;) {
    const newline = raw.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? raw.length : newline;

    if (raw.slice(lineStart, lineEnd).trim().startsWith('```')) {
      return {
        bodyEnd: lineStart,
        fenceEnd: newline === -1 ? raw.length : newline + 1,
      };
    }

    if (newline === -1) return null;
    lineStart = newline + 1;
  }
}

/**
 * Push a text segment. Both call sites already prove `content` is non-empty --
 * one is bounded by `cursor < raw.length`, the other by `fenceStart > cursor` --
 * so adapters never receive a blank text node.
 */
function pushText(segments: Segment[], content: string, sourceStart: number): void {
  segments.push({
    type: 'text',
    content,
    sourceStart,
    sourceEnd: sourceStart + content.length,
  });
}

/**
 * Drop the single newline that separates the code body from its closing fence.
 * A body that is entirely a newline collapses to an empty block rather than a
 * spurious blank line.
 */
function stripTrailingNewline(body: string): string {
  return body.endsWith('\n') ? body.slice(0, -1) : body;
}
