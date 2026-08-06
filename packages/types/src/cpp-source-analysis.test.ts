/**
 * TICKET_661_1 AC-10 coverage for the single shared C++ source-analysis owner.
 *
 * Two behaviours are contractual here:
 * - the TICKET_1226 regression (a comment-blind matcher reading
 *   `// ... base class headers` as a declared class) must stay fixed;
 * - Python `class Foo(bt.Strategy):` must NOT yield a class name, because the
 *   deleted `backtest-api.ts` copy returned `MyPyStrategy` for it and thereby
 *   satisfied the C++-name precondition on the execution path (section 3.1).
 */

import { describe, it, expect } from 'vitest';
import {
  extractCppClassName,
  extractDeclaredCppClassNames,
  sanitizeForClassExtraction,
} from './cpp-source-analysis';

describe('extractCppClassName', () => {
  it('returns null for Backtrader-style Python source (section 3.1 reproduction)', () => {
    const python = `
import backtrader as bt

class MyPyStrategy(bt.Strategy):
    def next(self):
        self.buy()
`;
    // The deleted comment-blind copy returned 'MyPyStrategy' here, which let a
    // Python body reach generateMainCpp() and produce a compiler syntax dump.
    expect(extractCppClassName(python)).toBeNull();
  });

  it('ignores class names appearing only in comments (TICKET_1226)', () => {
    const code = `
// Required StratForge base class headers
#include <stratforge/strategy.hpp>
class RealStrategy final : public stratforge::Strategy {};
`;
    expect(extractCppClassName(code)).toBe('RealStrategy');
  });

  it('ignores a class name that appears only inside a block comment', () => {
    const code = `/* class Ghost {}; */ class Real : public stratforge::Strategy {};`;
    expect(extractCppClassName(code)).toBe('Real');
  });

  it('prefers the class inheriting a framework strategy base over a helper', () => {
    const code = `
class HelperThing { int x; };
class TheStrategy final : public stratforge::Strategy {};
`;
    expect(extractCppClassName(code)).toBe('TheStrategy');
  });

  it('recognizes the nonabt base namespace as well as stratforge', () => {
    const code = `class NbStrategy : public nonabt::Strategy {};`;
    expect(extractCppClassName(code)).toBe('NbStrategy');
  });

  it('falls back to the first declared class when none inherits a framework base', () => {
    const code = `class Plain { int x; };`;
    expect(extractCppClassName(code)).toBe('Plain');
  });

  it('matches a forward declaration', () => {
    expect(extractCppClassName('class Fwd;')).toBe('Fwd');
  });

  it('returns null when the source declares no class at all', () => {
    expect(extractCppClassName('int main() { return 0; }')).toBeNull();
  });

  it('is not affected by the global regex lastIndex across repeated calls', () => {
    const code = `class Alpha { };`;
    expect(extractCppClassName(code)).toBe('Alpha');
    expect(extractCppClassName(code)).toBe('Alpha');
    expect(extractCppClassName(code)).toBe('Alpha');
  });
});

describe('extractDeclaredCppClassNames', () => {
  it('lists every declared class and excludes comment text', () => {
    const code = `
// class Commented
class A {};
class B final : public stratforge::Strategy {};
`;
    expect(extractDeclaredCppClassNames(code)).toEqual(['A', 'B']);
  });

  it('excludes Python class statements', () => {
    expect(extractDeclaredCppClassNames('class Foo(bt.Strategy):')).toEqual([]);
  });

  it('does not report enum class names as classes', () => {
    const code = `enum class Color { Red }; class Real {};`;
    expect(extractDeclaredCppClassNames(code)).toEqual(['Real']);
  });
});

describe('sanitizeForClassExtraction', () => {
  it('strips line and block comments and neutralizes enum class', () => {
    const sanitized = sanitizeForClassExtraction(
      '// gone\n/* also gone */ enum class E {}; class Kept {};',
    );
    expect(sanitized).not.toContain('gone');
    expect(sanitized).not.toContain('enum class');
    expect(sanitized).toContain('class Kept');
  });
});
