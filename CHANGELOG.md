# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Plugin distribution system with dual-path loading (bundled + user plugins)
- GitHub Actions CI/CD workflows for TypeScript, C++ Core, and Electron packaging
- Git submodule integration for plugin management
- Open source preparation files (LICENSE, CONTRIBUTING, etc.)
- Startup audit persistence table: persists health check results to `startup_audit` SQLite table with migration v40, startup-audit-service, IPC handlers, and preload API
- `MigrationResult` structured return type for `migrateFromOldAppName()` to feed startup audit data
- `detectCodeLanguage()` shared utility for Python/C++ language detection with content heuristics fallback
- `separateCppIncludes()` function to extract and hoist `#include` directives from LLM-generated C++ code to file scope
- Unified CV sizing contract for Signal Discovery: `cv-sizing-contract.ts` is now the single source of truth for pull width / fold split / refusal floor; `walk_forward`, `cpcv`, `single_split`, and `expanding` schemes all derive from one struct. AC4 property test (200 fast-check cases) guarantees `checkRefusal=null` implies every planned path clears the warmup floor.
- Combinatorial Purged K-Fold Cross-Validation (CPCV) per Lopez de Prado AFML Ch. 7, available as an opt-in `cv_scheme` on `DataSnapshotSpec`. Produces `C(N, k)` backtest paths per arm with multi-test-segment purging instead of the single-path walk-forward default.
- Probabilistic Sharpe Ratio (PSR) and Deflated Sharpe Ratio (DSR) closed-form statistics (AFML Ch. 14.2 / 14.4) in `cpcv-statistics.ts`. CPCV dispatches collapse per-path Sharpes into a single PSR-derived `signal_run.p_value` consumable by the existing Family-BH adjustment.
- Codegen pipeline `pnpm --filter @StratCraft/desktop codegen:floors` that mirrors each Python signal source's `minimum_training_bars(params)` classmethod into `signal-source-floors.generated.ts`. Pre-commit hook runs `codegen:floors:check` so Python-side floor changes without a regenerated TS mirror fail the commit.
- Per-provider self-declared `capabilities.calendarPaddingRatio` on every `IDataProvider`, enabling new providers to ship without touching the discovery orchestrator. Equity providers report ~3.4x intraday / 1.4x daily; crypto / FX default to 1.0.

### Changed
- Updated plugin loader to support `scanAll` API for dual-path discovery
- `migrateFromOldAppName()` returns `MigrationResult` instead of void
- `buildCompilableCppSource()` now hoists LLM `#include` directives to file scope and strips `#pragma once` to prevent anonymous namespace nesting
- All 8 strategy generation/save code paths use `detectCodeLanguage()` for consistent C++ detection
- Signal Discovery now sizes pull / split / refuse from one shared contract. Arms that previously refused with `below_min_training_bars` at default settings (Run #51 HMM closed loop -- pull 306, slice to 172, refuse at 172<362) now size their pull correctly. Default 1h S&P 500 Top 50 sweep at `N=6, K=5` pulls 732 market bars instead of 306; the HMM arm is dispatched.
- The legacy `EQUITY_CALENDAR_RATIO` global table is now `@deprecated` for main-process callers. Calendar inflation is a provider concern; `pullBarsToCalendarMs(bars, timeframe, providerId)` reads each provider's self-declared ratio. The global table survives only as a renderer-side fallback.

### Fixed
- C++ strategies misidentified as Python when backend omits `file_path` and `code_kind` fields, causing `ast.parse` validation failure
- C++ strategy compilation failure when LLM-generated `#include` directives are embedded inside anonymous namespace, creating conflicting `(anonymous)::nonabt` vs `::nonabt` types
- Signal Discovery Tool Sweep dispatch closed loop (Run #51): the pull-width formula said 306 bars while the walk-forward planner sliced into 172-bar folds and the refusal check demanded 362-bar per-fold IS, so the HMM arm refused itself on default settings with no slider movement able to fix it. Resolved by collapsing pull / split / refuse into one `CvSizingContract`; the legacy `floor(totalBars / (K+1))` formula, the `100 * n_states` HMM hardcode, and the `inferAssetClass()` provider-string heuristic are all permanently retired.

### Security
- N/A

## [0.1.0] - 2026-01-06

### Added
- Initial release of StratCraft Desktop
- Electron-based desktop application framework
- C++ core engine with gRPC communication
- Plugin system architecture
- Chart plugin with TradingView-style visualization
- Backtest engine plugin
- Data plugin for market data sources
- Credential security system
- Authorization and authentication modules
- System configuration management

### Security
- Context isolation enabled
- Sandbox mode enabled
- CSP headers configured
- Secure credential storage

[Unreleased]: https://github.com/StratCraftsAI/StratCraft/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/StratCraftsAI/StratCraft/releases/tag/v0.1.0
