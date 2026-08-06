# Open-Source Manifest

This file defines which files belong to the open-source (public) layer
and which belong to the closed-source (proprietary) layer.

## Open-Source Layer (Apache-2.0 License)

```
apps/desktop/
  src/
    renderer/           # React UI (all files)
    preload/            # IPC bridge (type signatures only)
    shared/             # Types, constants, format utils
  tsconfig.renderer.json
  electron.vite.config.ts  # Build configuration (public)

plugins/
  */ui/                 # Plugin frontend components
  */src/                # Plugin client-side services

docs/
  plugin/              # Plugin development documentation
```

### Shared Types Package (@StratCraft/shared-types)
```
apps/desktop/src/shared/
  constants/            # IPC channels, intervals, plugin IDs, timing, trading
  types/                # Algorithm, API, auth, backtest, config, data, market, plugin
  utils/                # format-locale, lookback-constraints
```

## Closed-Source Layer (Proprietary)

```
apps/desktop/
  src/
    main/               # Electron main process
      database/         # SQLite services, migrations
      grpc/             # gRPC clients (V1 legacy)
      ipc/              # IPC handlers (business logic)
      services/         # Auth, credential, data providers, executor
      utils/            # Logger, API request utils

packages/
  executor/             # C++ backtest engine (pybind11)
  builder-templates/    # Python strategy framework

apps/server/            # Python backend (backend_server)

docs/
  design/               # Internal architecture documents
  private/              # Business analysis (gitignored)
```

## API Contract Boundary

The preload file (`src/preload/index.ts`) defines the stable API contract.
- Type signatures: Open-source (public)
- Handler implementations: Closed-source (proprietary)
- API version: Tracked via `api.version` constant

## Build-Time Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `StratCraft_API_URL` | Backend API base URL | `DESKTOP_API_BASE_URL` (see `packages/types/src/api-config.ts`) |

Set via `__API_BASE_URL__` webpack DefinePlugin in `electron.vite.config.ts`.
