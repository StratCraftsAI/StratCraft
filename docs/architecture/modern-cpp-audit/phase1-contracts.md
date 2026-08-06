# Phase 1 C++ Contract Freeze

Status: frozen for `qnx.evaluation-envelope/1.0.0` and
`qnx.evaluation-arrow/1.0.0`.

## Authority

The C++23 runtime owns the evaluation value types and semantic validation in
`packages/executor/include/quantnexus/executor/evaluation_contract.hpp` and
`packages/executor/src/evaluation_contract.cpp`. The language-neutral wire
source of truth is
`packages/executor/schemas/evaluation_envelope.schema.json`. TypeScript and
Python are validation-only consumers; they must not reconstruct rows,
statistics, verdict inputs, progress, cancellation, or errors.

The contract version changes whenever a field, unit, null rule, ordering rule,
or semantic invariant changes. Additive changes are not silently accepted by
version 1 readers because unknown fields fail validation.

## Value and envelope semantics

- Timestamps are signed 64-bit Unix epoch milliseconds in UTC and identify bar
  close. Version 1 accepts only non-negative values.
- Windows are inclusive at both ends:
  `start_ms <= timestamp_ms <= end_ms`. Storage readers must push this window
  into the storage query.
- Prices, returns, effect sizes, signal scores, confidence values, and p-values
  are finite binary64 values. Signal scores are within `[-1, 1]`; confidence
  and p-values are within `[0, 1]`.
- A missing forward horizon is `null`. Signal score and confidence are never
  null. A producer canonicalizes a non-finite score or confidence to the
  explicit abstention pair `(0.0, 0.0)` before creating the envelope.
- Rows are unique and ordered by symbol using UTF-8 byte order and then by
  ascending `timestamp_ms`.
- Sample counts are non-negative 64-bit integers. The minimum sample count is
  at least one.
- `partial` and `failed` envelopes contain at least one actionable error.
  `cancelled` status and the cancellation object must agree, and a completed
  cancellation requires an actionable reason.
- Missing symbols remain explicit in `missing_symbols`; they are never inferred
  from absent rows.

## Arrow and Parquet schema

`packages/executor/schemas/evaluation_arrow_schema_v1.json` and
`packages/executor/schemas/market_data_arrow_schema_v1.json` freeze column
order, Arrow and Parquet physical/logical types, nullability, ordering,
timestamp unit, timezone, window semantics, required file metadata, OHLC
invariants, and canonical non-finite behavior. Phase 3 must consume these files
and may not define a second storage schema.

## Golden parity corpus

The shared fixtures are:

- `packages/executor/tests/fixtures/evaluation_envelope_v1.json`
- `packages/executor/tests/fixtures/evaluation_parity_cases_v1.json`

They pin valid rows and statistics, average ranks for ties, NaN and infinity
canonicalization, empty and thin samples, epoch boundaries, a missing symbol,
an actionable failure, and cancellation. C++, TypeScript, and Python read these
same files and return the envelope without reshaping it.

## Packaged command boundary

Electron Main uses the existing packaged `StratCraft-executor` plugin host,
resolved through `CompilerResolverService.resolvePluginExecutor()`. No daemon,
socket, or new protocol is introduced.

```text
StratCraft-executor --contract-info
StratCraft-executor --validate-evaluation-envelope=/absolute/path/envelope.json
```

The validation command writes the canonical envelope as one JSON line on
stdout and exits `0`. A contract failure writes an actionable JSON error on
stderr and exits `2`. The TypeScript argument constructor is
`evaluationEnvelopeValidationArgs()`.

## Phase boundary

Phase 1 freezes types, schemas, fixtures, and the command boundary only. It does
not migrate the current statistical implementations or canonical producers.
Those ownership changes begin in Phase 2 and must consume version 1 directly.

## Verification evidence

Recorded on 2026-07-23:

| Boundary | Evidence | Result |
|---|---|---|
| C++ typed contract and JSON Schema | `test_evaluation_contract` | 101 assertions pass; instrumented `evaluation_contract.cpp` line coverage is 100 percent |
| Packaged C++ command | three CTest command cases for info, valid input, and invalid input | 3 of 3 pass with exit and output contracts verified |
| TypeScript reader | focused Vitest suite with V8 coverage | 36 tests pass; statements, branches, functions, and lines are 100 percent |
| Python reader | focused pytest suite with branch coverage | 34 tests pass; statements and branches are 100 percent |
| Cross-language identity | all three readers consume the two shared fixtures; C++ and consumer tests compare the unmodified document | identical JSON values, timestamp boundaries, errors, and cancellation state |
| TypeScript language boundary | desktop Main `tsc --noEmit` log filtered for `evaluation-contract` | no Phase 1 diagnostic; the repository-wide check remains red on pre-existing unrelated diagnostics |

Broader regression evidence is 38 of 40 CTest cases passing and 108 Python
canonical tests passing. The two CTest failures are outside the Phase 1 owning
path: `test_signal_fusion_plugin` expects a `per_bar` member absent from its
current output, and `test_factor_eval_s9_bulk_smoke` reports the existing Aroon
finite-output and zero-deferred-registry assertions. The three TypeScript
canonical/adapter suites pass 104 tests; the separately included scoreboard
suite has 17 existing failures because its test database lacks the `score_30`
column. None of these failing files or owners is changed by Phase 1.
