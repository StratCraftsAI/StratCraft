# Modern C++ Audit Boundary Map

## Phase 0 status

This map freezes the repository-derived production topology. The scanner reads
the pnpm workspace, package, Python, and CMake build manifests and follows their
source roots and runtime entry scripts. The exact detected responsibility set is
stored in `approved-boundaries.json`; `pnpm ci:modern-cpp-boundaries` rejects a
new or changed source root, manifest, process boundary, file-mediated boundary,
or same-process numerical owner.

## V3 process topology

```text
Renderer / Web UI
  | contextBridge / typed IPC or HTTP
  v
Electron Main (lifecycle, security, persistence, supervision)
  |-- spawn packaged C++ stratforge-runner / discovery / fusion hosts
  |     |-- bounded Parquet reads -> ABI v2 strategy -> typed result envelope
  |-- spawn Python training, research, provider, scoreboard, and promotion CLIs
  |     |-- Parquet / JSON / stdout / artifact files
  |-- fork Node utility/plugin workers
  `-- SQLite transactions and UI-visible progress/error propagation
```

No Extension Host, gRPC, SharedMemory V1, ABI v1, or Python strategy-generation
path is part of the target.

## Representative owning traces

| Journey | Owning path | Persistence and result | Error / cancellation | Enforcement |
|---|---|---|---|---|
| C++ strategy backtest | Renderer -> preload -> V3 IPC -> `executor-service.ts` -> `stratforge-runner` -> Parquet -> ABI v2 | Runner result -> Electron -> UI | Child stderr/exit and abort signal return through IPC | Electron supervision and OS child limits |
| Signal discovery | Renderer -> IPC -> `discovery-orchestrator.ts` -> C++ hosts and Python fit adapters | Evaluation Parquet/SQLite -> canonical UI result | Orchestrator progress/cancel/error events | TS/Python governance plus systemd/cgroup where configured |
| Scoreboard | Electron queue -> Python `nona_algorithm.scoreboard` | stdout JSON plus SQLite score rows | Queue cancellation and child exit parsing | Electron queue and Python process limits |
| Promotion | Electron `promotion-cli.ts` -> Python promotion CLI | Registry/audit artifacts -> Electron result | Child signal and structured/exit error | Electron child supervision |
| Provider acquisition | UI/IPC -> IDataProvider -> provider TS or Python helper | Normalized OHLCV -> cache/Parquet | Provider-specific error propagated through IDataProvider | Requested provider window contract |
| ML training/inference | Discovery -> LSTM/fit launcher -> Python fit; accepted ONNX may execute in C++ | Versioned artifact and evaluation outputs | Progress stream, cancellation, child exit | Scheduler settings, watchdog, systemd/cgroup |

## Authoritative contracts and identified splits

| Shape or control | Current authority | Phase decision |
|---|---|---|
| Desktop request/lifecycle | Preload and Electron IPC types | Retain |
| Strategy binary boundary | C++ ABI v2 factory and runner | Retain |
| Provider date window |  provider online range contract | Retain; C++ data plane must consume it |
| CV sizing | `cv-sizing-contract.ts` | Preserve semantics; migrate ownership under MC-11 |
| Canonical signal result | `SignalOutputRow` contract with TS adapters | Freeze then move producer ownership under MC-04 |
| Statistical verdict | Split across TS/Python/C++ | Consolidate under MC-01/02 |
| Arrow/Parquet schema and window | Split across TS/Python/C++ readers | Consolidate under MC-07 |
| Resource geometry | Split across UI estimator, TS launchers, Python, systemd/cgroup | Measure under MC-10/12 before ownership decision |
| Errors/progress/cancellation | Per-command TS/JSON/stdout contracts | Version in Phase 1; UI propagation remains mandatory |

## Static boundary evidence

The Phase A scanner records process launches, Node and browser workers,
Electron utility processes, shell wrappers, native bindings, Parquet and JSON
producer-consumer sites, same-process numerical owners and constants, migration
opt-in/opt-out gates, and numerical fallback sites. Imports and launch calls are
both kept because an unused import and a launch hidden behind a wrapper have
different review implications. Test, fixture, build-output, and third-party
directories are excluded.

Boundary IDs combine the boundary kind, repository path, enclosing symbol, and
normalized owning source line. Unrelated insertions therefore do not renumber
later findings. `approved-boundaries.json` contains one decision and evidence
reference per exact ID; path-prefix approvals are invalid.

`scripts/ci/modern-cpp-phase0-evidence.mjs` derives the candidate set from
`inventory.csv`, validates required fields and child-ticket references, and
requires every inventory row to have evidence or an explicit tracked gap. A
completed migration must register an accepted-migration policy and provide
pre-migration observation, representative post-migration evidence, removal
evidence, and a default-path assertion. The accepted-migration boundary gate
then rejects residual opt-in gates, numerical fallbacks, and non-canonical
formula owners.
