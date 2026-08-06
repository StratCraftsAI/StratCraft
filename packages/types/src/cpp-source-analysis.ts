/**
 * TICKET_661_1 AC-10: the single shared owner of pure C++ source analysis.
 *
 * `extractCppClassName()` previously existed twice: a hardened, comment-aware,
 * inheritance-aware copy in `algorithm-compilation-service.ts` carrying the
 * TICKET_1226 production fix, and a bare `/\bclass\s+([A-Za-z_]\w*)\b/` copy in
 * `backtest-api.ts` that was comment-blind and inheritance-blind. The
 * TICKET_1226 incident (`QNX_STRATEGY_FACTORY_EXPORT(headers)` emitted because
 * a comment-blind matcher read the comment `// Required StratForge base class
 * headers` as a class declaration) was fixed only in the first copy.
 *
 * That duplication violated TICKET_854 (code reuse) and, worse, the bare copy
 * happily returned `MyPyStrategy` from Backtrader source
 * `class MyPyStrategy(bt.Strategy)` -- satisfying the C++-name precondition on
 * the execution path and feeding Python bytes to the C++ wrapper generator
 * (TICKET_661_1 section 3.1).
 *
 * This module is Electron-free and dependency-free so Electron Main, the
 * standalone MCP/Guide surface, and any future surface consume the exact same
 * implementation.
 */

/**
 * Strip comments and neutralize `enum class` so class-name extraction only sees
 * real declarations.
 *
 * TICKET_1226 live incident: the comment `// Required StratForge base class
 * headers` made a naive matcher treat `headers` as a declared class.
 */
export function sanitizeForClassExtraction(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\benum\s+(?:class|struct)\b/g, 'enum');
}

/**
 * Every C++ class name declared in `code`, comments excluded.
 *
 * Only C++-shaped declarations match: a Python `class Foo(bt.Strategy):` has a
 * `(` where C++ requires `{`, `:`, `final`, or `;`, so it is not reported as a
 * declared C++ class.
 */
export function extractDeclaredCppClassNames(code: string): string[] {
  const sanitized = sanitizeForClassExtraction(code);
  return [...sanitized.matchAll(CPP_CLASS_DECLARATION_PATTERN)].map((match) => match[1]);
}

/**
 * A C++ class declaration: `class Name` followed by a base-clause `:`, an
 * opening brace, a `final` specifier, or a forward-declaration `;`.
 *
 * The trailing lookahead is what separates C++ from Python. Python's
 * `class MyStrategy(bt.Strategy):` puts `(` immediately after the name and is
 * therefore never matched -- which is the property that closes the section 3.1
 * bypass at the class-name precondition even when a caller reaches it.
 */
const CPP_CLASS_DECLARATION_PATTERN = /\bclass\s+([A-Za-z_]\w*)\s*(?=(?:final\b|:|\{|;))/g;

/** Base namespaces whose subclass is the real strategy class. */
const STRATEGY_BASE_NAMESPACE_PATTERN =
  /\bclass\s+([A-Za-z_]\w*)\s*(?:final\s*)?:\s*public\s+(?:stratforge|nonabt)::/;

/**
 * The strategy class declared in `code`, or `null` when the source declares no
 * C++ class.
 *
 * TICKET_1226: prefers the class inheriting a framework strategy base, because
 * LLM output may declare helper classes before the strategy class.
 */
export function extractCppClassName(code: string): string | null {
  const sanitized = sanitizeForClassExtraction(code);

  const inheriting = sanitized.match(STRATEGY_BASE_NAMESPACE_PATTERN);
  if (inheriting) {
    return inheriting[1];
  }

  // Fresh regex state: CPP_CLASS_DECLARATION_PATTERN is global and stateful.
  const first = new RegExp(CPP_CLASS_DECLARATION_PATTERN.source).exec(sanitized);
  return first ? first[1] : null;
}
