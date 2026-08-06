/**
 * CollapsiblePanel Unit Tests
 *
 * Covers the TICKET_077_27 additive enhancement: collapsed-header
 * `selectionLabel` + `Change` link (`onChange` / `changeLabel`) and the
 * `keepMounted` (display:none) content mode. Pre-existing behaviour (badge,
 * subtitle, controlled/uncontrolled expand) must remain intact.
 *
 * This project does not use @testing-library (vitest runs in `node` env), so
 * we validate the prop interface and pin the rendering branches in source --
 * the same convention as GenerateActionBar.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CollapsiblePanelProps } from '../CollapsiblePanel';

const src = readFileSync(
  resolve(__dirname, '..', 'CollapsiblePanel.tsx'),
  'utf-8',
);

describe('CollapsiblePanel props interface (TICKET_077_27)', () => {
  it('accepts the new optional props without requiring them', () => {
    // Minimal props still compile -- the enhancement is purely additive.
    const minimal: CollapsiblePanelProps = {
      title: 'Universe',
      children: null,
    };
    expect(minimal.selectionLabel).toBeUndefined();
    expect(minimal.onChange).toBeUndefined();
    expect(minimal.keepMounted).toBeUndefined();

    const full: CollapsiblePanelProps = {
      title: 'Universe',
      children: null,
      selectionLabel: 'S&P 500 Top 50',
      onChange: vi.fn(),
      changeLabel: 'Change',
      keepMounted: true,
    };
    expect(full.selectionLabel).toBe('S&P 500 Top 50');
    expect(typeof full.onChange).toBe('function');
    expect(full.keepMounted).toBe(true);
  });
});

describe('CollapsiblePanel rendering branches (TICKET_077_27)', () => {
  it('shows the selection summary only when collapsed and selectionLabel is set', () => {
    expect(src).toMatch(/!isExpanded && selectionLabel && \(/);
  });

  it('renders the Change link as a sibling of the toggle button (not nested)', () => {
    // The Change link is a real interactive control -- nesting it inside the
    // header <button> would be invalid HTML. It must be a sibling guarded by
    // showChangeLink.
    expect(src).toMatch(/const showChangeLink =\s*!isExpanded && !!selectionLabel && !!onChange/);
    expect(src).toMatch(/\{showChangeLink && \(/);
    expect(src).toMatch(/onClick=\{handleChangeClick\}/);
  });

  it('the Change click re-expands the panel then notifies the caller', () => {
    expect(src).toMatch(/setInternalExpanded\(true\)/);
    expect(src).toMatch(/onExpandedChange\?\.\(true\)/);
    expect(src).toMatch(/onChange\?\.\(\)/);
    // stopPropagation so the underlying toggle does not also fire.
    expect(src).toMatch(/e\.stopPropagation\(\)/);
  });

  it('keepMounted renders children with display:none instead of grid collapse', () => {
    expect(src).toMatch(/keepMounted \?/);
    expect(src).toMatch(/display: isExpanded \? 'block' : 'none'/);
    expect(src).toMatch(/aria-hidden=\{!isExpanded\}/);
  });

  it('default (keepMounted=false) keeps the grid-rows animation', () => {
    expect(src).toMatch(/grid transition-\[grid-template-rows\]/);
    expect(src).toMatch(/isExpanded \? 'grid-rows-\[1fr\]' : 'grid-rows-\[0fr\]'/);
  });

  it('changeLabel defaults to "Change"', () => {
    expect(src).toMatch(/changeLabel = 'Change'/);
  });

  it('headerTestId is stamped on the toggle button (TICKET_077_27 step 3E)', () => {
    // ToolSweepTab's single-asset migration pins `single-asset-toggle` on the
    // header click target via `headerTestId`. The attribute must land on the
    // <button> that toggles expansion, not on the root <div> (which already
    // has `testId`).
    const buttonStart = src.indexOf('<button\n          type="button"\n          data-testid={headerTestId}');
    expect(buttonStart).toBeGreaterThan(0);
    // And it is the SAME button that calls handleToggle.
    const buttonEnd = src.indexOf('</button>', buttonStart);
    const buttonBlock = src.slice(buttonStart, buttonEnd);
    expect(buttonBlock).toMatch(/onClick=\{handleToggle\}/);
  });
});

describe('CollapsiblePanel headerTestId prop (TICKET_077_27 step 3E)', () => {
  it('is optional', () => {
    const minimal: CollapsiblePanelProps = { title: 'Universe', children: null };
    expect(minimal.headerTestId).toBeUndefined();
    const full: CollapsiblePanelProps = {
      title: 'Universe',
      children: null,
      headerTestId: 'single-asset-toggle',
    };
    expect(full.headerTestId).toBe('single-asset-toggle');
  });
});
