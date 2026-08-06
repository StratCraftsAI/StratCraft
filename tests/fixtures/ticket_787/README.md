#  Regression Fixtures

This directory holds reproducer C++ snippets for the
`Indicator<T>` / `DataFeed` API-hallucination class surfaced by the
 compile gate on 2026-05-18 between 07:56 and 08:12 UTC.

Used as regression input for whatever stratforge-API SSOT teaching
the backend lands (prompt partial + optional validator rule);
mirrors the role of `tests/fixtures/ticket_784/chip_id8_original.cpp`
for the line-indexing class.

## Why these fixtures are synthetic reproducers, not verbatim source

The verbatim Round 4 source that produced each error was discarded.
Path:

1. `discovery-orchestrator.ts:646` calls `compileTestSignalCpp({...})`
2. `cpp-compile-gate.ts:117-126` `finally` block does
   `rmSync(workDir, { recursive: true, force: true })` -- temp dir is
   wiped on every exit (success AND failure)
3. The orchestrator's reject branch
   (`discovery-orchestrator.ts:653-674`) logs the first 3 diagnostic
   lines and **drops the `signalCode` string** -- it never reaches
   `nona_signal`, never gets logged to disk, and is not echoed in
   the LSD retry path either (Phase 1 strict drop, no retry)

The diagnostic line in `apps/desktop/logs/main.log` is therefore the
only artifact. The reproducers below are the **minimal C++ that
triggers the same compile error against the same vendored stratforge
headers** -- enough to feed a future backend validator regression
test, but they do not capture the surrounding chip body the LLM
generated. Treat them as **shape evidence**, not as exact LLM output.

(Follow-up: the dropped-source path should be fixed -- see the
"Logging gap" section of `docs/design/_INDICATOR_DATAFEED_API_HALLUCINATION.md`.)

## Live evidence

### chip_StatisticalSerialCorrelationSignal_get_bars.cpp

- **Compile-gate temp dir** (cleaned): `/tmp/qnx-compile-gate-mfEN09/`
- **Diagnostic** (from `apps/desktop/logs/main.log:144401`,
  2026-05-18 07:56:18 UTC):
  ```
  /tmp/qnx-compile-gate-mfEN09/main.cpp:265:37: error: no member named
  'get_bars' in 'stratforge::DataFeed'
    265 |         const auto& bars = ctx.data.get_bars();
        |                            ~~~~~~~~ ^
  ```
- **Hallucinated API**: `DataFeed::get_bars()`
- **Truth** (`vendor/stratforge/include/stratforge/data/data_feed.hpp:145-160`):
  `DataFeed` only exposes per-line accessors --
  `datetime()` / `open()` / `high()` / `low()` / `close()` /
  `volume()` / `openinterest()` -- each returning `const Line<double>&`.
  There is no aggregate "bars" accessor. To iterate history, callers
  use `close()[-static_cast<int>(i)]` (per  section 6 teaching).

### chip_StatisticalMeanReversionSignal_sma_value.cpp

- **Compile-gate temp dir** (cleaned): `/tmp/qnx-compile-gate-b3mY3S/`
- **Diagnostic** (from `apps/desktop/logs/main.log:144444`,
  2026-05-18 08:12:32 UTC):
  ```
  /tmp/qnx-compile-gate-b3mY3S/main.cpp:272:32: error: no member named
  'value' in 'stratforge::SMA'
    272 |         double sma_val = sma_->value();
        |                          ~~~~~~^
  ```
- **Hallucinated API**: `SMA::value()` (and by symmetry: any
  `Indicator<Derived>::value()`).
- **Truth** (`vendor/stratforge/include/stratforge/indicators/indicator.hpp:11-44`):
  `IndicatorBase` exposes `line()` (returns `Line<double>&`) and
  `operator[](int)` (subscript shortcut). The correct access for
  "current SMA value" is `(*sma_)[0]` or `sma_->line()[0]`. There
  is no `value()` / `current()` / `last()` accessor.

## Reproducer files

Each file is a **minimal TU** that triggers the exact diagnostic
when compiled with `clang++ -std=c++23 -fsyntax-only -I<stratforge>`.
They do not need to link or run -- the gate is `-fsyntax-only`, so
type-checking is sufficient.

The reproducers are commented at the top with the diagnostic they
target and the line number that should error.

## Do NOT

- Modify reproducer content without filing a follow-up: they are
  pinned to specific diagnostic lines in main.log.
- Use these as ground-truth Round 4 LLM output. They are minimal
  shapes, not transcripts.
- Add new reproducers here unless tied to a  a new
  fixture-tracked hallucination class.
