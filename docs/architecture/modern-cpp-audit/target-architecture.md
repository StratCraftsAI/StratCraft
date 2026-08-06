# Modern C++ First Target Architecture

## Target

QuantNexus remains a V3 Builder/Executor system. Electron Renderer owns
presentation and Layer 2 state. Electron Main owns desktop security, IPC,
lifecycle, bounded control-plane persistence, and supervision. Packaged C++23
libraries and existing runner/host commands own deterministic production
execution, numerical gates, canonical evaluation output, bounded Arrow/Parquet
operations, planning, governance, and accepted-model inference.

Python remains an explicit adapter for research, model fitting, hyperparameter
search, symbolic candidate generation, and vendor SDK acquisition where the
ecosystem is the material capability. A retained adapter may not become the
authoritative owner of production preprocessing, evaluation, scoring,
promotion, resource policy, or schema reconstruction.

## Ownership transition

| Target C++ owner | Candidates | Superseded production ownership |
|---|---|---|
| Statistical evaluation and canonical envelope | MC-01/02/04 | TS statistical gates and canonical adapters |
| Portfolio/fusion/scoring/promotion evaluation | MC-03/05/06/14 | TS and Python numerical owners |
| Bounded Arrow/Parquet data plane | MC-07 plus common MC-16/18 portion | Duplicate TS/Python readers and schema logic |
| Accepted factor runtime | MC-08 | Python production evaluation fallback |
| C++/Clang strategy admission | MC-09 | Python AST-era validators |
| Planning geometry | MC-11 | Python embargo helper and duplicated formulas |
| Production inference | MC-13 and accepted MC-17 families | Python inference after artifact acceptance |

MC-10, MC-12, MC-15, MC-16, MC-17, and MC-19 stay in `measure` until a
representative end-to-end baseline resolves their binding constraints. MC-18
retains vendor acquisition by default while common normalization/storage moves
with MC-07. MC-20 remains Electron-owned CRUD and migration control plane.

MC-07 selected Path M on 2026-07-24. The versioned C++23 eval data-plane
library and existing packaged executor command own canonical-score,
forward-return, and eval-cache Parquet reads, writes, schemas, ordering, joins,
and requested-window enforcement. Electron and Python are process adapters
only. MC-16 DuckDB cache creation and trace copying remain a separate measured
candidate. Production cold/warm acceptance evidence is still pending.

## Non-negotiable terminal properties

- Existing runner/host topology is reused; no new daemon or protocol.
- ABI v2 and C++-only strategy generation remain exclusive.
- Every requested storage window is pushed into the read.
- Each migrated capability moves validation, configuration, errors, tests, and
  enforcement together and deletes the superseded path.
- UI-visible error and cancellation behavior remains end to end.
- C++ targets are built and packaged through `start.sh`.
- Phase 0 measurements are compared again in Phase 9 before performance claims.
