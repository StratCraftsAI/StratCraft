import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccessGateProps } from '../AccessGate';

const src = readFileSync(
  resolve(__dirname, '..', 'AccessGate.tsx'),
  'utf-8',
);

describe('AccessGate', () => {
  it('exports AccessGateProps with required fields', () => {
    const dummy: AccessGateProps = {
      title: 'T',
      description: 'D',
      ctaLabel: 'C',
      onAction: () => {},
    };
    expect(dummy.title).toBe('T');
    expect(dummy.description).toBe('D');
    expect(dummy.ctaLabel).toBe('C');
  });

  it('defaults icon to ShieldAlert', () => {
    expect(src).toContain("icon: Icon = ShieldAlert");
  });

  it('defaults testId to access-gate', () => {
    expect(src).toContain("testId = 'access-gate'");
  });

  it('renders data-testid attribute', () => {
    expect(src).toContain('data-testid={testId}');
  });

  it('renders title, description, and CTA button', () => {
    expect(src).toContain('{title}');
    expect(src).toContain('{description}');
    expect(src).toContain('{ctaLabel}');
  });

  it('calls onAction on button click', () => {
    expect(src).toContain('onClick={onAction}');
  });

  it('conditionally renders ctaIcon', () => {
    expect(src).toContain('CtaIcon &&');
  });

  it('uses amber color scheme matching EntitlementExpiredBanner', () => {
    expect(src).toContain('text-amber-500');
    expect(src).toContain('bg-amber-500/20');
    expect(src).toContain('text-amber-400');
  });

  it('accepts optional icon and ctaIcon props', () => {
    const withIcons: AccessGateProps = {
      title: 'T',
      description: 'D',
      ctaLabel: 'C',
      onAction: () => {},
      icon: {} as any,
      ctaIcon: {} as any,
      testId: 'custom',
    };
    expect(withIcons.testId).toBe('custom');
  });
});
