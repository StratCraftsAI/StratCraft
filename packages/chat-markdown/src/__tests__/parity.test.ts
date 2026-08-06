/**
 * TICKET_1318 AC14: the parity golden itself must be correct, since both
 * surfaces' runtime tests assert against it.
 */

import { describe, expect, it } from 'vitest';
import { PARITY_FIXTURE, parityFingerprint } from '../parity.js';
import { parseChatMarkdown } from '../markdown.js';

const fingerprint = parityFingerprint();

describe('PARITY_FIXTURE', () => {
  it('exercises every block kind the contract supports', () => {
    expect(fingerprint.blockTypes).toEqual([
      'heading',
      'paragraph',
      'table',
      'unorderedList',
      'orderedList',
      'code',
      'paragraph',
    ]);
  });

  it('exercises every inline node kind', () => {
    // One strong in the lead paragraph; emphasis in a list item and a table
    // cell; inline code in a list item and a table cell.
    expect(fingerprint.strongCount).toBe(1);
    expect(fingerprint.emphasisCount).toBe(2);
    expect(fingerprint.inlineCodeCount).toBe(2);
  });

  it('contains a closed cpp code block', () => {
    const code = parseChatMarkdown(PARITY_FIXTURE).find((b) => b.type === 'code');
    expect(code).toMatchObject({ language: 'cpp', closed: true });
    expect(fingerprint.codeLanguage).toBe('cpp');
  });
});

describe('parityFingerprint', () => {
  it('counts every list item across both lists', () => {
    expect(fingerprint.listItemCount).toBe(4);
  });

  it('reports the fenced block line count', () => {
    expect(fingerprint.codeLineCount).toBe(5);
  });

  it('reports canonical token classes in order', () => {
    expect(fingerprint.tokenClasses.length).toBeGreaterThan(0);
    for (const cls of fingerprint.tokenClasses) {
      expect(cls).toMatch(/^token-[a-z-]+$/);
    }
    expect(fingerprint.tokenClasses).toContain('token-comment');
    expect(fingerprint.tokenClasses).toContain('token-class-name');
    expect(fingerprint.tokenClasses).toContain('token-string');
  });

  it('never reports a plain token class', () => {
    expect(fingerprint.tokenClasses).not.toContain('token-plain');
  });

  it('lists visible text and forbidden markup fragments', () => {
    expect(fingerprint.visibleFragments).toContain('Larry Williams');
    expect(fingerprint.forbiddenFragments).toContain('```');
  });

  it('is deterministic', () => {
    expect(parityFingerprint()).toEqual(fingerprint);
  });

  it('counts inline nodes nested inside strong/emphasis', () => {
    // Guards the recursive descent in countInline against a flat-scan regression.
    expect(fingerprint.strongCount + fingerprint.emphasisCount).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // TICKET_1318_1 AC7 -- headings and tables participate in the parity golden
  // ---------------------------------------------------------------------------

  it('reports the heading levels in source order', () => {
    expect(fingerprint.headingLevels).toEqual([2]);
  });

  it('reports table dimensions', () => {
    expect(fingerprint.tableColumnCounts).toEqual([3]);
    // The fixture's second body row is ragged and must still be normalized to
    // a full row rather than dropped (AC4).
    expect(fingerprint.tableRowCounts).toEqual([2]);
  });

  it('reports every declared column alignment', () => {
    expect(fingerprint.tableAlignments).toEqual(['left', 'center', 'right']);
  });

  it('forbids heading and table markup from reaching the reader', () => {
    expect(fingerprint.forbiddenFragments).toContain('## ');
    expect(fingerprint.forbiddenFragments).toContain('|---');
  });

  it('requires heading and table text to be visible', () => {
    expect(fingerprint.visibleFragments).toContain('Core Strategy Rules');
    expect(fingerprint.visibleFragments).toContain('Direction');
  });
});
