# PLUGIN_Third-Party Plugin Directory Structure Standard

## Status: APPROVED

## Problem

Third-party/marketplace plugins (e.g., `quant-lab-plugin`) lack a standardized directory structure convention. Without a clear specification, plugin developers may organize files inconsistently, causing build issues (e.g., missing dependencies, broken type declarations) and making maintenance difficult.

## Scope

This ticket defines the **mandatory directory structure** for all third-party plugins distributed via the marketplace (`"distribution": "marketplace"` in manifest).

## Standard Directory Layout

```
plugins/<plugin-name>/
+-- manifest.json                  # Plugin manifest (required)
+-- CMakeLists.txt                 # C++ build config (if plugin has native code)
+-- scripts/                       # Lifecycle scripts
|   +-- install.js                 #   onInstall handler
|   +-- upgrade.js                 #   onUpgrade handler
|   +-- uninstall.js               #   onUninstall handler
+-- packages/                      # Native/Python packages (optional)
|   +-- <package-name>/            #   Each package is self-contained
|       +-- CMakeLists.txt
|       +-- include/
|       +-- src/
|       +-- ...
+-- ui/                            # UI module (required for nexus-type plugins)
|   +-- <plugin-name>-nexus/       #   Naming: <plugin-name>-nexus or <plugin-id>-nexus
|       +-- package.json           #   Own dependencies (devDependencies for host-provided libs)
|       +-- tsconfig.json          #   TypeScript config
|       +-- src/
|           +-- index.tsx          #   Entry point (must match manifest.main)
|           +-- types/
|           |   +-- global.d.ts    #   Ambient type declarations (window.electronAPI subset)
|           +-- components/        #   Reusable UI components
|           +-- pages/             #   Page-level components
|           +-- hooks/             #   Custom React hooks
|           +-- constants.ts       #   Plugin-specific constants
+-- locales/                       # i18n files (optional)
    +-- <namespace>/
```

## Key Rules

### 1. UI Module Naming
- Directory: `ui/<plugin-name>-nexus/` (e.g., `ui/quant-lab-nexus/`)
- Package name in `package.json`: matches directory name

### 2. Dependencies in `package.json`
| Dependency | Location | Reason |
|---|---|---|
| `react`, `react-dom` | `dependencies` + `peerDependencies` | Host-provided at runtime |
| `lucide-react` | `devDependencies` | Icons, host-provided at runtime |
| `reactflow` | `dependencies` | Plugin-specific, bundled |
| `@types/react`, `@types/react-dom` | `devDependencies` | Build-time only |
| `typescript` | `devDependencies` | Build-time only |

### 3. Type Declarations (`src/types/global.d.ts`)
Every plugin **must** declare the subset of `window.electronAPI` it uses:

```typescript
interface ElectronAPI {
  // Only declare APIs this plugin actually calls
  someApi: {
    method: () => Promise<{ success: boolean; data?: T; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

### 4. `tsconfig.json` Path Mapping
Plugins that reference shared host types must use path aliases:

```json
{
  "compilerOptions": {
    "paths": {
      "@shared/types": ["../../../../apps/desktop/src/shared/types/index.ts"]
    }
  },
  "include": ["src/**/*", "../../../../apps/desktop/src/shared/types/**/*"]
}
```

### 5. Manifest `main` Field
Must point to the compiled entry point relative to the plugin root:

```json
{
  "main": "./ui/<plugin-name>-nexus/dist/plugins/<plugin-name>/ui/<plugin-name>-nexus/src/index.js"
}
```

### 6. Manifest i18n Contract
User-visible manifest strings (`displayName`, `description`, service `name` /
`description` / `category`, view `name`, view-container `title`, editor
`displayName`, command `title` / `category`, configuration `title`, configSchema
property `description` / `category`, main/side/bottom panel `title`) MAY declare
optional `*Key` siblings that point at i18n keys in the plugin's own namespace.
The host's `resolveManifestI18n(manifest)` helper walks the manifest at render
time and replaces each value with `t(<plugin-ns>:<*Key>)` when the key resolves
to a non-empty string; otherwise it preserves the literal value. Locale changes
propagate via the existing `useTranslation()` React subscription -- the
resolver itself is not a hook.

Required JSON shape (each plugin's `locales/<locale>/<ns>.json`):

```jsonc
{
  "manifest": {
    "displayName": "StratForge",
    "description": "Strategy creation, market regime classification, ...",
    "services": {
      "regimeMode": {
        "name": "Regime Detector",
        "description": "Market environment and regime classification",
        "category": "REGIME MODE"
      }
    },
    "viewsContainers": { "sidebar": "STRATEGY" },
    "views": { "tree": "Strategy Tree" },
    "editors": { "regimeEditor": "Regime Detector" },
    "commands": { "openHub": "Open Strategy Hub" },
    "configuration": {
      "title": "StratForge Settings",
      "properties": {
        "strategyDataSource": {
          "description": "Data storage mode for strategies",
          "category": "Data"
        }
      }
    }
  }
}
```

Example manifest excerpt that declares `*Key` siblings:

```jsonc
{
  "displayName": "StratForge",
  "displayNameKey": "manifest.displayName",
  "description": "...",
  "descriptionKey": "manifest.description",
  "entitlements": {
    "services": [{
      "id": "regime_mode",
      "name": "Regime Detector",
      "nameKey": "manifest.services.regimeMode.name",
      "description": "...",
      "descriptionKey": "manifest.services.regimeMode.description",
      "category": "REGIME MODE",
      "categoryKey": "manifest.services.regimeMode.category",
      "tier": "free",
      "defaultEnabled": true
    }]
  },
  "contributes": {
    "i18n": { "path": "./locales", "namespaces": ["strategy-builder"] }
  }
}
```

All `*Key` siblings are optional and additive; a manifest that omits them
ships untouched through the resolver. Tier 0 plugins follow the same rules.

## Comparison: Built-in vs Third-Party

| Aspect | Built-in (strategy-builder-nexus) | Third-Party (quant-lab-plugin) |
|---|---|---|
| Location | `plugins/<name>/` | `plugins/<name>/` |
| UI source | `src/` (direct) | `ui/<name>-nexus/src/` (nested) |
| Native code | N/A | `packages/` (optional) |
| Distribution | `bundled` (implicit) | `marketplace` |
| Dependencies | Own `package.json` | Own `package.json` in `ui/` subdir |

## Plugin Tier System (Layered Architecture)

### Problem

PLUGIN_TICKET_009 originally enforced flat isolation: **no plugin may import from another plugin**. A layered dependency model allows controlled cross-plugin imports, reducing code duplication across business-layer plugins.

### Tier Definitions

| Tier | Name | Purpose | Examples |
|------|------|---------|----------|
| **Tier 0** | Foundation | Shared infrastructure consumed by all upper-tier plugins | `data-plugin` (data providers, data source selector) |
| **Tier 1** | Business | Domain-specific features, the main user-facing plugins | `strategy-builder-nexus`, `back-test-nexus`, `quant-lab-nexus` |

### Dependency Rules

```
Tier 0 (Foundation)              <-- Can be imported by any Tier 1 plugin
   ^           ^
   |           |
Tier 1A <---> Tier 1B            <-- Same-tier imports ALLOWED
(builder)   (quant-lab)
```

**Allowed**:
- Tier 1 plugin **may** import from Tier 0 plugin (downward dependency)
- Tier 1 plugin **may** import from another Tier 1 plugin (same-tier dependency)
- Any plugin **may** call host-layer IPC APIs (not a plugin-to-plugin dependency)

**Prohibited**:
- Tier 0 plugin **must NOT** import from Tier 1 plugin (no upward dependency)

### Manifest Declaration

Plugins declare their tier in `manifest.json`:

```json
{
  "name": "data-plugin",
  "tier": 0,
  "distribution": "marketplace"
}
```

```json
{
  "name": "quant-lab-plugin",
  "tier": 1,
  "distribution": "marketplace",
  "dependencies": {
    "plugins": ["data-plugin"]
  }
}
```

### Tier 0 Plugin Requirements

Foundation plugins have additional constraints:

1. **Stable API Surface** - Exported components and types form a public contract; breaking changes require version bump
2. **No Business Logic** - Must remain domain-agnostic (data fetching, not strategy execution)
3. **Minimal External Dependencies** - Foundation plugins should minimize third-party dependencies to avoid transitive bloat
4. **Explicit Exports** - Must define a clear `exports` entry in `package.json` or barrel file (`index.ts`)

### Import Resolution

Tier 1 plugins reference Tier 0 plugins via path alias in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@plugins/data-plugin/*": ["../../../data-plugin/ui/data-nexus/src/*"]
    }
  }
}
```

### Enforcement Updates

- Plugin verifier validates `tier` field in manifest
- Plugin verifier rejects imports that violate tier dependency rules (upward: Tier 0 importing Tier 1)
- CI pipeline resolves `dependencies.plugins` and verifies tier ordering

## Enforcement

- Plugin verifier (`@StratCraft/plugin-verifier`) should validate directory structure
- CI pipeline checks manifest.main resolves to a valid path
- Missing `src/types/global.d.ts` in UI module is a build error
- Plugin verifier validates tier dependency rules (see Plugin Tier System above)
