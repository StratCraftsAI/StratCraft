/**
 * SliderInputGroup Unit Tests
 *
 * Covers the TICKET_077_27 step 3B additive enhancement: the `sliderTestId`
 * / `labelTestId` / `rangeTextTestId` / `labelTitle` props and the widening
 * of `rangeText` from string to ReactNode. The Parameter Sweep tab's
 * training-bars slider migration pins these testids; the SliderInputGroup
 * must stamp them on the right DOM nodes without forcing every consumer to
 * adopt them.
 *
 * This project does not use @testing-library (vitest runs in `node` env), so
 * we validate the prop interface and pin the rendering branches in source --
 * the same convention as GenerateActionBar.test.ts / CollapsiblePanel.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SliderInputGroupProps } from '../SliderInputGroup';

const src = readFileSync(
  resolve(__dirname, '..', 'SliderInputGroup.tsx'),
  'utf-8',
);

describe('SliderInputGroup props interface (TICKET_077_27 step 3B)', () => {
  it('all new props are optional', () => {
    const minimal: SliderInputGroupProps = {
      label: 'Training bars',
      value: 100,
      onChange: () => {},
      min: 5,
      max: 500,
      step: 1,
    };
    expect(minimal.sliderTestId).toBeUndefined();
    expect(minimal.labelTestId).toBeUndefined();
    expect(minimal.rangeTextTestId).toBeUndefined();
    expect(minimal.labelTitle).toBeUndefined();
  });

  it('rangeText accepts a ReactNode (not just string)', () => {
    // The Parameter Sweep floor-help line composes two i18n strings into a
    // fragment. Widening the type from `string` to `ReactNode` is the whole
    // point of step 3B.
    const withFragment: SliderInputGroupProps = {
      label: 'Training bars',
      value: 100,
      onChange: () => {},
      min: 5,
      max: 500,
      step: 1,
      rangeText: null, // null is a valid ReactNode
    };
    expect(withFragment.rangeText).toBeNull();
  });
});

describe('SliderInputGroup rendering branches (TICKET_077_27 step 3B)', () => {
  it('stamps sliderTestId on the range <input> (not the number input)', () => {
    // The range input must carry `sliderTestId` -- it's the element the
    // Parameter Sweep tests assert with `lookback-bars-slider`. Pinning the
    // numeric input instead would silently move the testid off the slider
    // (TICKET_858 silent failure).
    const rangeBlock = src.slice(
      src.indexOf('type="range"'),
      src.indexOf('aria-label={label}'),
    );
    expect(rangeBlock).toMatch(/data-testid=\{sliderTestId\}/);
  });

  it('stamps labelTestId + labelTitle on the <label> above the controls', () => {
    expect(src).toMatch(/data-testid=\{labelTestId\}\s*\n\s*title=\{labelTitle\}/);
  });

  it('stamps rangeTextTestId on the rangeText <p>', () => {
    // Pin: the rangeText paragraph is the help-text node ToolSweepTab pins
    // as `lookback-bars-floor-help`. The attribute must land on the <p> that
    // actually renders the text, not the wrapping <div>.
    const rangeTextBlock = src.slice(
      src.indexOf('{rangeText && ('),
      src.indexOf('{rangeText}'),
    );
    expect(rangeTextBlock).toMatch(/data-testid=\{rangeTextTestId\}/);
  });
});
