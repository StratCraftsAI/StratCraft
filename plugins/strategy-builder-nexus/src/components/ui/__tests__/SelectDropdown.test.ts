/**
 * SelectDropdown Unit Tests (TICKET_883_1)
 *
 * Source-pin tests validating the SelectDropdown component interface,
 * rendering branches, and Tailwind class usage.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SelectDropdownProps, SelectOption } from '../SelectDropdown';

const src = readFileSync(
  resolve(__dirname, '..', 'SelectDropdown.tsx'),
  'utf-8',
);

describe('SelectDropdown props interface (TICKET_883_1)', () => {
  it('accepts minimal required props', () => {
    const minimal: SelectDropdownProps = {
      value: 'a',
      onChange: vi.fn(),
      options: [{ value: 'a', label: 'Alpha' }],
    };
    expect(minimal.placeholder).toBeUndefined();
    expect(minimal.label).toBeUndefined();
    expect(minimal.disabled).toBeUndefined();
    expect(minimal.className).toBeUndefined();
    expect(minimal.testId).toBeUndefined();
  });

  it('accepts all optional props', () => {
    const full: SelectDropdownProps = {
      value: 'b',
      onChange: vi.fn(),
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo', disabled: true },
      ],
      placeholder: 'Choose...',
      label: 'Source',
      disabled: true,
      className: 'flex-1',
      testId: 'my-select',
    };
    expect(full.disabled).toBe(true);
  });

  it('SelectOption supports disabled flag', () => {
    const opt: SelectOption = { value: 'x', label: 'X', disabled: true };
    expect(opt.disabled).toBe(true);
  });

  it('SelectOption supports statusColor and statusTooltip', () => {
    const opt: SelectOption = {
      value: 'y',
      label: 'Y',
      statusColor: '#22c55e',
      statusTooltip: 'Connected',
    };
    expect(opt.statusColor).toBe('#22c55e');
    expect(opt.statusTooltip).toBe('Connected');
  });
});

describe('SelectDropdown source pins', () => {
  it('exports SelectDropdown function', () => {
    expect(src).toContain('export function SelectDropdown');
  });

  it('exports SelectDropdownProps interface', () => {
    expect(src).toContain('export interface SelectDropdownProps');
  });

  it('exports SelectOption interface', () => {
    expect(src).toContain('export interface SelectOption');
  });

  it('uses 077 terminal design tokens', () => {
    expect(src).toContain('bg-color-terminal-surface');
    expect(src).toContain('text-color-terminal-text');
    expect(src).toContain('border-color-terminal-border');
    expect(src).toContain('border-color-terminal-accent-teal');
  });

  it('renders data-testid when testId prop is provided', () => {
    expect(src).toContain('data-testid={testId}');
  });

  it('renders placeholder as first option when provided', () => {
    expect(src).toContain('{placeholder && (');
  });

  it('renders label with htmlFor when label prop is provided', () => {
    expect(src).toContain('htmlFor={selectId}');
    expect(src).toContain("if (!label) return content");
  });

  it('handles disabled state via Tailwind classes', () => {
    expect(src).toContain("disabled && 'opacity-50 cursor-not-allowed'");
  });

  it('uses PortalDropdown for option list (not native select)', () => {
    expect(src).toContain("import { PortalDropdown }");
    expect(src).toContain('<PortalDropdown');
    expect(src).not.toContain('<select');
    expect(src).not.toContain('<option');
  });

  it('renders chevron indicator with rotation on open', () => {
    expect(src).toContain('ChevronDown');
    expect(src).toContain("isOpen && 'rotate-180'");
  });

  it('supports keyboard navigation (Enter, Space, Escape)', () => {
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("e.key === ' '");
    expect(src).toContain("e.key === 'Escape'");
  });

  it('highlights the selected option', () => {
    expect(src).toContain("opt.value === value && 'bg-color-terminal-accent-teal/30'");
  });

  it('renders status dot in trigger when selectedOption has statusColor', () => {
    expect(src).toContain('selectedOption?.statusColor');
    expect(src).toContain('selectedOption.statusColor');
  });

  it('renders status dot per option row when statusColor is set', () => {
    expect(src).toContain('opt.statusColor');
    expect(src).toContain('opt.statusTooltip');
  });
});
