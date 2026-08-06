/**
 * RiskOverrideRuleCard Unit Tests (TICKET_786_17 Category G)
 *
 * Verifies that getRuleSummary() uses i18n translation keys instead of
 * hardcoded English strings. Since this project does not use
 * @testing-library/react, we validate via source-code analysis (the same
 * convention as CollapsiblePanel.test.ts / GenerateActionBar.test.ts).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  resolve(__dirname, '..', 'RiskOverrideRuleCard.tsx'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Extract the getRuleSummary function body for focused assertions
// ---------------------------------------------------------------------------
const fnMatch = src.match(
  /function getRuleSummary\(rule: RiskOverrideRule, t: \(key: string, options\?: Record<string, unknown>\) => string\): string \{([\s\S]*?)^}/m,
);
const fnBody = fnMatch ? fnMatch[1] : '';

describe('getRuleSummary i18n (TICKET_786_17 Category G)', () => {
  it('accepts t as second parameter', () => {
    expect(src).toContain(
      'function getRuleSummary(rule: RiskOverrideRule, t: (key: string, options?: Record<string, unknown>) => string): string',
    );
  });

  it('passes t to getRuleSummary at the call site', () => {
    expect(src).toContain('getRuleSummary(rule, t)');
  });

  // -------------------------------------------------------------------------
  // G1: 'Close All' replaced with t() in all branches
  // -------------------------------------------------------------------------
  it('G1: uses t() for Close All label (no hardcoded string)', () => {
    expect(fnBody).not.toMatch(/'Close All'/);
    expect(fnBody).toContain("t(`${ns}.closeAll`)");
  });

  // -------------------------------------------------------------------------
  // G2: 'Per Position' replaced with t()
  // -------------------------------------------------------------------------
  it('G2: uses t() for Per Position scope label', () => {
    expect(fnBody).not.toMatch(/'Per Position'/);
    expect(fnBody).toContain("t(`${ns}.scopePerPosition`)");
  });

  // -------------------------------------------------------------------------
  // G3: 'Per Group' replaced with t()
  // -------------------------------------------------------------------------
  it('G3: uses t() for Per Group scope label', () => {
    expect(fnBody).not.toMatch(/'Per Group'/);
    expect(fnBody).toContain("t(`${ns}.scopePerGroup`)");
  });

  // -------------------------------------------------------------------------
  // G4: 'Portfolio' replaced with t()
  // -------------------------------------------------------------------------
  it('G4: uses t() for Portfolio scope label', () => {
    expect(fnBody).not.toMatch(/'Portfolio'/);
    expect(fnBody).toContain("t(`${ns}.scopePortfolio`)");
  });

  // -------------------------------------------------------------------------
  // G5: 'No decay' replaced with t()
  // -------------------------------------------------------------------------
  it('G5: uses t() for No decay label', () => {
    expect(fnBody).not.toMatch(/'No decay'/);
    expect(fnBody).toContain("t(`${ns}.noDecay`)");
  });

  // -------------------------------------------------------------------------
  // G6: 'Halt Entry' replaced with t()
  // -------------------------------------------------------------------------
  it('G6: uses t() for Halt Entry action label', () => {
    expect(fnBody).not.toMatch(/'Halt Entry'/);
    expect(fnBody).toContain("t(`${ns}.haltEntry`)");
  });

  // -------------------------------------------------------------------------
  // G7: 'Halt Trading' replaced with t()
  // -------------------------------------------------------------------------
  it('G7: uses t() for Halt Trading action label', () => {
    expect(fnBody).not.toMatch(/'Halt Trading'/);
    expect(fnBody).toContain("t(`${ns}.haltTrading`)");
  });

  // -------------------------------------------------------------------------
  // G8: 'Close Position' replaced with t()
  // -------------------------------------------------------------------------
  it('G8: uses t() for Close Position action label', () => {
    expect(fnBody).not.toMatch(/'Close Position'/);
    expect(fnBody).toContain("t(`${ns}.closePosition`)");
  });

  // -------------------------------------------------------------------------
  // Additional: decay, reduce, recovery, na, drawdownLabel also use t()
  // -------------------------------------------------------------------------
  it('uses t() for decay suffix label', () => {
    expect(fnBody).toContain("t(`${ns}.decay`)");
  });

  it('uses t() for reduce label', () => {
    expect(fnBody).toContain("t(`${ns}.reduce`)");
  });

  it('uses t() for recovery label', () => {
    expect(fnBody).toContain("t(`${ns}.recovery`)");
  });

  it('uses t() for N/A fallback label', () => {
    expect(fnBody).toContain("t(`${ns}.na`)");
  });

  it('uses t() for drawdown label prefix', () => {
    expect(fnBody).toContain("t(`${ns}.drawdownLabel`)");
  });

  // -------------------------------------------------------------------------
  // Namespace constant
  // -------------------------------------------------------------------------
  it('defines the namespace constant for riskOverrideRuleCard', () => {
    expect(fnBody).toContain("const ns = 'ui.riskOverrideRuleCard'");
  });
});
