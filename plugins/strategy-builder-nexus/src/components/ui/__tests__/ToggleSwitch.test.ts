/**
 * ToggleSwitch Unit Tests
 *
 * Covers the TICKET_077_27 step 3E additive enhancement: the
 * `checkboxTestId` (underlying `<input type=checkbox>`) and `testId`
 * (outer `<label>` wrapper) props. The Parameter Sweep single-asset
 * migration pins these so the existing `single-asset-mode-checkbox`
 * integration-test hook lands on the real checkbox -- NOT on a hidden
 * sibling input (which would violate TICKET_851 / TICKET_858 by giving
 * the panel two checked-state inputs that can drift).
 *
 * This project does not use @testing-library (vitest runs in `node`
 * env), so we validate the prop interface and pin the rendering
 * branches in source.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToggleSwitchProps } from '../ToggleSwitch';

const src = readFileSync(
  resolve(__dirname, '..', 'ToggleSwitch.tsx'),
  'utf-8',
);

describe('ToggleSwitch props interface (TICKET_077_27 step 3E)', () => {
  it('checkboxTestId + testId are optional', () => {
    const minimal: ToggleSwitchProps = {
      label: 'Use single-asset mode for this run',
      checked: false,
      onChange: () => {},
    };
    expect(minimal.checkboxTestId).toBeUndefined();
    expect(minimal.testId).toBeUndefined();
  });

  it('accepts both pins together', () => {
    const full: ToggleSwitchProps = {
      label: 'Use single-asset mode for this run',
      checked: true,
      onChange: () => {},
      checkboxTestId: 'single-asset-mode-checkbox',
      testId: 'single-asset-toggle-row',
    };
    expect(full.checkboxTestId).toBe('single-asset-mode-checkbox');
    expect(full.testId).toBe('single-asset-toggle-row');
  });
});

describe('ToggleSwitch rendering branches (TICKET_077_27 step 3E)', () => {
  it('stamps checkboxTestId on the underlying <input type="checkbox">', () => {
    // The `data-testid` MUST land on the real input -- the one that owns
    // the `checked` state and fires `handleChange`. Pinning a sibling
    // would re-introduce the dual-state anti-pattern this prop replaces.
    const inputBlock = src.slice(
      src.indexOf('<input'),
      src.indexOf('aria-label={label}'),
    );
    expect(inputBlock).toMatch(/data-testid=\{checkboxTestId\}/);
    expect(inputBlock).toMatch(/type="checkbox"/);
    expect(inputBlock).toMatch(/checked=\{checked\}/);
    expect(inputBlock).toMatch(/onChange=\{handleChange\}/);
  });

  it('stamps testId on the outer <label> wrapper', () => {
    expect(src).toMatch(/<label\s+htmlFor=\{inputId\}\s+data-testid=\{testId\}/);
  });
});
