# Plugin Manifest Reference

Complete field reference for `manifest.json` - the metadata file required at the root of every StratCraft plugin.

## Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string | Reverse-domain unique identifier. Must match pattern `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$` | `"com.example.my-plugin"` |
| `name` | string | Short technical name (kebab-case). Used as directory name. | `"my-plugin"` |
| `displayName` | string | Human-readable name shown in Nexus Hub and Marketplace | `"My Data Provider"` |
| `version` | string | Semantic version. Must match `^\d+\.\d+\.\d+(-[\w.]+)?$` | `"1.0.0"` |
| `main` | string | Path to built IIFE entry point, relative to plugin root | `"./ui/my-plugin-nexus/dist/index.js"` |

## Recommended Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `tier` | number | Plugin tier: `0` (Foundation) or `1` (Business). Default: `1` | `1` |
| `distribution` | string | `"marketplace"` for third-party, `"bundled"` for built-in. Default: `"bundled"` | `"marketplace"` |
| `description` | string | Short description (shown in Marketplace) | `"Real-time crypto data"` |
| `author` | string | Author or organization name | `"Your Name"` |
| `license` | string | SPDX license identifier | `"MIT"` |

## Optional Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `homepage` | string | Project homepage URL | `"https://github.com/..."` |
| `repository` | string | Source repository URL | `"https://github.com/..."` |
| `type` | PluginType | Plugin classification | `"nexus"` |
| `category` | PluginCategory | Marketplace category | `"data"` |
| `isolation` | string | `"sandbox"` (default) or `"trusted"` | `"sandbox"` |
| `activationEvents` | string[] | Events that trigger activation | `["onCommand:my.cmd"]` |
| `dependencies` | object | Plugin and module dependencies | See below |
| `permissions` | string[] | Required permissions | See below |
| `detailedPermissions` | object | Fine-grained permission declarations | See below |
| `contributes` | object | UI extension points | See below |
| `configSchema` | object | Runtime configuration schema | See below |
| `entitlements` | object | Service entitlement definitions | See below |

---

## Plugin Types

Valid values for the `type` field:

| Type | Purpose |
|------|---------|
| `nexus` | Full-page Nexus Hub plugin (most common for Tier 1) |
| `ui` | General UI components |
| `data-source` | Market data provider |
| `indicator` | Technical indicators |
| `strategy` | Trading strategies |
| `execution` | Order execution |
| `analysis` | Analysis tools |
| `utility` | General utilities |

## Categories

Valid values for the `category` field (Marketplace filtering):

| Category | Description |
|----------|-------------|
| `visualization` | Charts, dashboards |
| `trading` | Strategy, execution |
| `data` | Data providers, feeds |
| `ai` | AI/ML tools |
| `tools` | Utilities |
| `themes` | Visual themes |

---

## Tier System

```json
{
  "tier": 1
}
```

| Tier | Name | Purpose | Dependency Rule |
|------|------|---------|-----------------|
| `0` | Foundation | Shared infrastructure (data providers, UI components) | Cannot import from any plugin |
| `1` | Business | Domain-specific features (strategies, backtests) | Can import from Tier 0 and other Tier 1 |

**Rules enforced by plugin verifier:**
- Tier 1 may import Tier 0 (downward)
- Tier 1 may import other Tier 1 (same-tier)
- Upward imports prohibited (Tier 0 cannot import Tier 1)

---

## Dependencies

### Plugin Dependencies

Declare required plugins that must be installed and activated before your plugin:

```json
{
  "dependencies": {
    "plugins": ["data-plugin"]
  }
}
```

The installer resolves these recursively - if `data-plugin` itself depends on other plugins, those are installed first.

### Module Dependencies

Standard npm-style dependencies (for future use):

```json
{
  "dependencies": {
    "lodash": "^4.17.0"
  }
}
```

---

## Permissions

### Simple Permissions

```json
{
  "permissions": ["network", "filesystem", "database"]
}
```

| Permission | Description | Risk Level |
|------------|-------------|------------|
| `network` | HTTP requests (internal only) | Low |
| `network:internal` | Access internal StratCraft APIs | Low |
| `filesystem` | Sandboxed file access (plugin directory only) | Low |
| `filesystem:full` | Full filesystem access | High |
| `database` | Local SQLite database access | Medium |
| `notification` | System notifications | Low |
| `clipboard` | System clipboard access | Medium |
| `shell` | Shell command execution | High |
| `native` | Native Node.js APIs | High |

### Detailed Permissions

Fine-grained permission declarations with justification:

```json
{
  "detailedPermissions": {
    "network": {
      "hosts": ["api.binance.com", "api.coinbase.com"],
      "reason": "Fetch real-time cryptocurrency market data"
    },
    "fs": {
      "read": ["$PLUGIN_DATA/cache", "$PLUGIN_DATA/config"],
      "write": ["$PLUGIN_DATA/cache"],
      "reason": "Cache downloaded OHLCV data to reduce API calls"
    }
  }
}
```

**Path variables:**
- `$PLUGIN_DATA` - Plugin's data directory (`~/.config/@StratCraft/desktop/plugins/<id>/`)
- `$USER_DATA` - Application data directory

---

## Contributes

Extension points that the plugin registers with the host.

### Views

```json
{
  "contributes": {
    "mainView": [{
      "id": "my-plugin.dashboard",
      "title": "Dashboard",
      "entry": "./dist/DashboardView.js",
      "icon": "layout-dashboard",
      "route": "/my-plugin/dashboard",
      "order": 10
    }],
    "sidePanel": [{
      "id": "my-plugin.sidebar",
      "title": "My Plugin",
      "entry": "./dist/Sidebar.js",
      "icon": "puzzle"
    }],
    "bottomPanel": [{
      "id": "my-plugin.output",
      "title": "Output",
      "entry": "./dist/OutputPanel.js"
    }]
  }
}
```

### Commands

```json
{
  "contributes": {
    "commands": [{
      "id": "my-plugin.refresh",
      "title": "Refresh Data",
      "category": "My Plugin",
      "icon": "refresh-cw",
      "keybinding": "Ctrl+Shift+R"
    }]
  }
}
```

### Configuration

User-editable settings shown in Plugin Settings panel:

```json
{
  "contributes": {
    "configuration": {
      "title": "My Plugin Settings",
      "properties": {
        "my-plugin.refreshInterval": {
          "type": "number",
          "default": 60,
          "description": "Data refresh interval in seconds",
          "minimum": 10,
          "maximum": 3600,
          "order": 1
        },
        "my-plugin.theme": {
          "type": "string",
          "default": "dark",
          "enum": ["dark", "light", "auto"],
          "enumDescriptions": ["Dark theme", "Light theme", "Follow system"],
          "order": 2
        },
        "my-plugin.apiKey": {
          "type": "string",
          "description": "API key for data provider",
          "secret": true,
          "order": 3
        }
      }
    }
  }
}
```

**Property types:**

| Type | Additional Fields |
|------|------------------|
| `string` | `enum`, `enumDescriptions`, `pattern`, `secret` |
| `number` | `minimum`, `maximum` |
| `boolean` | (none) |
| `array` | (none) |
| `object` | (none) |

Common fields: `default`, `description`, `order`, `category`.

### i18n

```json
{
  "contributes": {
    "i18n": {
      "path": "./locales",
      "namespaces": ["my-plugin"]
    }
  }
}
```

Expected file structure:
```
locales/
+-- my-plugin/
    +-- en.json
    +-- zh.json
    +-- ja.json
```

### Views Containers and Tree Data Providers

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "my-plugin-explorer",
        "title": "My Plugin",
        "icon": "puzzle"
      }]
    },
    "views": {
      "my-plugin-explorer": [{
        "id": "my-plugin.tree",
        "name": "Data Browser"
      }]
    },
    "treeDataProviders": [{
      "id": "my-plugin.tree",
      "label": "Data Browser"
    }]
  }
}
```

### Editors

```json
{
  "contributes": {
    "editors": [{
      "id": "my-plugin.strategyEditor",
      "displayName": "Strategy Editor",
      "selector": [{ "filenamePattern": "*.strategy.json" }]
    }]
  }
}
```

---

## Entitlements

Service-level feature gating:

```json
{
  "entitlements": {
    "services": [{
      "id": "my-plugin.premium-data",
      "name": "advanced Data Feed",
      "description": "Real-time Level 2 market data",
      "tier": "extended",
      "defaultEnabled": false
    }]
  }
}
```

---

## Complete Example

```json
{
  "id": "com.example.crypto-data",
  "name": "crypto-data",
  "displayName": "Crypto Data Provider",
  "version": "1.2.0",
  "description": "Real-time cryptocurrency OHLCV data from Binance and Coinbase",
  "author": "Example Corp",
  "homepage": "https://github.com/example/crypto-data",
  "license": "MIT",

  "tier": 0,
  "distribution": "marketplace",
  "type": "data-source",
  "category": "data",

  "main": "./ui/crypto-data-nexus/dist/index.js",

  "dependencies": {
    "plugins": []
  },

  "permissions": ["network"],
  "detailedPermissions": {
    "network": {
      "hosts": ["api.binance.com", "api.coinbase.com"],
      "reason": "Fetch real-time cryptocurrency market data"
    }
  },

  "contributes": {
    "configuration": {
      "title": "Crypto Data Settings",
      "properties": {
        "crypto-data.defaultExchange": {
          "type": "string",
          "default": "binance",
          "enum": ["binance", "coinbase"],
          "description": "Default exchange for data queries"
        }
      }
    },
    "i18n": {
      "path": "./locales",
      "namespaces": ["crypto-data"]
    }
  }
}
```

---

## Validation

The plugin verifier checks:

1. **Required fields** - `id`, `name`, `displayName`, `version`, `main` must be present
2. **ID format** - Must match `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$`
3. **Version format** - Must be valid semver
4. **Main path** - Must point to an existing `.js` file after build
5. **Tier rules** - Dependencies must respect tier ordering
6. **Permission validity** - All permissions must be recognized values

Run the template validator to check your manifest:

```bash
cd ui/my-plugin-nexus
pnpm validate
```

---

## References

- [Plugin SDK Reference](PLUGIN_SDK_REFERENCE.md) - Runtime API documentation
- Plugin Directory Structure - File layout standard
- Plugin Lifecycle - Build/Install/Load/Activate stages
- [Plugin Settings Architecture](../design/_PLUGIN_SETTINGS_ARCHITECTURE.md) - Configuration contribution details
- [Plugin i18n](../design/_PLUGIN_I18N_CONTRIBUTION.md) - Internationalization
- [Plugin Signature Verification](../design/_PLUGIN_SIGNATURE_VERIFICATION.md) - Signing and trust
