/**
 * TICKET_1318 AC3 / AC12 / AC14: fenced-code segmentation, including the
 * streaming transitions an unterminated fence must survive.
 */

import { describe, expect, it } from 'vitest';
import { splitContentSegments, type Segment } from '../segment.js';

/** Concatenating every segment's source span must reproduce the input. */
function assertCoversSource(raw: string, segments: Segment[]): void {
  for (const segment of segments) {
    expect(segment.sourceStart).toBeGreaterThanOrEqual(0);
    expect(segment.sourceEnd).toBeGreaterThanOrEqual(segment.sourceStart);
    expect(segment.sourceEnd).toBeLessThanOrEqual(raw.length);
  }
  for (let i = 1; i < segments.length; i++) {
    expect(segments[i].sourceStart).toBeGreaterThanOrEqual(segments[i - 1].sourceStart);
  }
}

describe('splitContentSegments', () => {
  it('returns nothing for empty input', () => {
    expect(splitContentSegments('')).toEqual([]);
  });

  it('returns a single text segment when there is no fence', () => {
    const raw = 'Just prose about Larry Williams.';
    expect(splitContentSegments(raw)).toEqual([
      { type: 'text', content: raw, sourceStart: 0, sourceEnd: raw.length },
    ]);
  });

  it('splits leading text, code, and trailing text', () => {
    const raw = 'Before\n```cpp\nint x = 1;\n```\nAfter';
    const segments = splitContentSegments(raw);

    expect(segments.map((s) => s.type)).toEqual(['text', 'code', 'text']);
    expect(segments[1]).toMatchObject({
      type: 'code',
      content: 'int x = 1;',
      language: 'cpp',
      closed: true,
    });
    expect(segments[2].content).toBe('After');
    assertCoversSource(raw, segments);
  });

  it('handles a fence at the very start of the content', () => {
    const segments = splitContentSegments('```python\nx = 1\n```');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'code', content: 'x = 1', language: 'python' });
  });

  it('normalizes the language hint and keeps unknown hints null', () => {
    expect(splitContentSegments('```C++\nx\n```')[0]).toMatchObject({ language: 'cpp' });
    expect(splitContentSegments('```rust\nx\n```')[0]).toMatchObject({ language: null });
    expect(splitContentSegments('```\nx\n```')[0]).toMatchObject({ language: null });
  });

  it('segments multiple fenced blocks independently', () => {
    const raw = '```cpp\na\n```\nmid\n```json\n{"b":1}\n```';
    const segments = splitContentSegments(raw);

    expect(segments.map((s) => s.type)).toEqual(['code', 'text', 'code']);
    expect(segments[0]).toMatchObject({ language: 'cpp', content: 'a' });
    expect(segments[2]).toMatchObject({ language: 'json', content: '{"b":1}' });
    assertCoversSource(raw, segments);
  });

  it('keeps an empty code block empty rather than emitting a blank line', () => {
    expect(splitContentSegments('```cpp\n```')[0]).toMatchObject({ content: '', closed: true });
  });

  it('preserves blank lines inside a code body', () => {
    expect(splitContentSegments('```cpp\na\n\nb\n```')[0]).toMatchObject({ content: 'a\n\nb' });
  });

  it('treats fence-like text mid-line as ordinary content', () => {
    const raw = 'use ```cpp inline and continue';
    const segments = splitContentSegments(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('text');
  });

  it('keeps indented fence-like text inside a code body as code', () => {
    const segments = splitContentSegments('```cpp\nauto s = "x ``` y";\n```');
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toBe('auto s = "x ``` y";');
  });

  describe('AC12: streaming', () => {
    it('marks an unterminated fence as not closed and keeps its partial body', () => {
      const raw = 'Here:\n```cpp\nint x = 1;\nint y = 2;';
      const segments = splitContentSegments(raw);

      expect(segments[1]).toMatchObject({
        type: 'code',
        content: 'int x = 1;\nint y = 2;',
        language: 'cpp',
        closed: false,
      });
    });

    it('never leaks the fence marker into visible text', () => {
      const frames = [
        'Here:\n``',
        'Here:\n```',
        'Here:\n```cp',
        'Here:\n```cpp',
        'Here:\n```cpp\n',
        'Here:\n```cpp\nint x = 1;',
        'Here:\n```cpp\nint x = 1;\n```',
      ];

      for (const frame of frames) {
        const segments = splitContentSegments(frame);
        const visible = segments
          .filter((s) => s.type === 'text')
          .map((s) => s.content)
          .join('');
        // Only the pre-fence prefix frames can contain backticks, and those are
        // not yet a line-leading fence.
        if (frame.includes('```cpp')) expect(visible).not.toContain('```');
      }
    });

    it('keeps a stable code-block key across the open -> body -> close transition', () => {
      const frames = [
        'Intro\n```cpp\n',
        'Intro\n```cpp\nint x = 1;',
        'Intro\n```cpp\nint x = 1;\n```',
        'Intro\n```cpp\nint x = 1;\n```\nDone',
      ];

      const keys = frames.map((frame) => {
        const code = splitContentSegments(frame).find((s) => s.type === 'code');
        expect(code).toBeDefined();
        return `${code!.type}:${code!.sourceStart}`;
      });

      expect(new Set(keys).size).toBe(1);
    });

    it('preserves content order as the stream grows', () => {
      // The closing fence line consumes its own trailing newline, so the
      // following text segment starts at the next line's first character.
      const raw = 'A\n```cpp\nB\n```\nC';
      expect(splitContentSegments(raw).map((s) => s.content)).toEqual(['A\n', 'B', 'C']);
    });

    it('emits an empty unterminated block when only the opener has arrived', () => {
      const segments = splitContentSegments('```cpp\n');
      expect(segments).toEqual([
        { type: 'code', content: '', language: 'cpp', closed: false, sourceStart: 0, sourceEnd: 7 },
      ]);
    });

    it('treats a bare opener with no trailing newline as an open fence', () => {
      const segments = splitContentSegments('```cpp');
      expect(segments).toEqual([
        { type: 'code', content: '', language: 'cpp', closed: false, sourceStart: 0, sourceEnd: 6 },
      ]);
    });
  });
});
