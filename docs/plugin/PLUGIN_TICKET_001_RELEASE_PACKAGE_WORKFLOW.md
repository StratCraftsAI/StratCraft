# PLUGIN_Plugin Release Package Workflow

## Status: COMPLETED

## Problem

Marketplace plugin installation fails with `Download failed: 404` because the release package does not exist.

```
[MARKET] Downloading from: https://github.com/StratCraftsAI/StratCraft/releases/download/v1.0.0/quant-lab-nexus-1.0.0.zip
[MARKET] Download failed: 404
```

## Root Cause

1. Registry entry references a release package that has not been created
2. **Initial attempt**: Uploaded zip to `StratCraft` (PRIVATE) repo - users cannot access (404)
3. **Correct approach**: Upload zip to `StratCraft-plugins` (PUBLIC) repo

## Repository Architecture

| Repository | Visibility | Purpose |
|------------|------------|---------|
| `StratCraft` | PRIVATE | Main application code |
| `StratCraft-plugin-registry` | PUBLIC | Plugin metadata (name, description, version) |
| `StratCraft-plugins` | PUBLIC | Plugin zip packages (downloadable) |

## Solution

1. Package plugin as zip
2. Upload to `StratCraft-plugins` Release (PUBLIC)
3. Update registry downloadUrl to point to public repo

## Tasks

- [x] Create plugin packaging directory structure
- [x] Package `quant-lab-plugin` as zip with correct structure
- [x] Calculate SHA256 hash of zip file
- [x] ~~Upload to StratCraft (PRIVATE)~~ - Failed (404 for users)
- [x] Upload to `StratCraft-plugins` (PUBLIC)
- [x] Update registry downloadUrl
- [x] Verify Marketplace install flow

## Execution Log

### Attempt 1 (Failed)

**Date**: 2026-02-06

| Step | Result |
|------|--------|
| Package | `dist/plugins/quant-lab-nexus-1.0.0.zip` |
| SHA256 | `cbc89b153755d887ddc4b0a156121606ccd1b52147f90b1bcfb64a48318beed2` |
| Release | https://github.com/StratCraftsAI/StratCraft/releases/tag/quant-lab-nexus-v1.0.0 |
| Result | **404** - Private repo, users cannot download |

### Attempt 2 (Success)

**Date**: 2026-02-06

| Step | Result |
|------|--------|
| Release | https://github.com/StratCraftsAI/StratCraft-plugins/releases/tag/quant-lab-nexus-v1.0.0 |
| Registry | https://github.com/StratCraftsAI/StratCraft-plugin-registry/commit/263e3eca3c0ce2e89a02333d1372271f07274e30 |
| Download URL | `https://github.com/StratCraftsAI/StratCraft-plugins/releases/download/quant-lab-nexus-v1.0.0/quant-lab-nexus-1.0.0.zip` |
| HTTP Status | **302** (Redirect to CDN - Success) |

## Plugin Package Structure

```
quant-lab-nexus-1.0.0.zip
+-- manifest.json
+-- ui/
|   +-- quant-lab-nexus/
|       +-- dist/
|           +-- ...
+-- scripts/
|   +-- install.js
|   +-- upgrade.js
|   +-- uninstall.js
+-- packages/
    +-- nona-algorithm/   (Python signal sources)
    +-- alpha-factory/    (C++ sources)
```

## Notes

### Locales Not Required

The `locales/` directory is not included in the package. Quant Lab plugin does not currently require i18n localization files.

### Tag Naming Convention

Release tag uses format `{plugin-name}-v{version}` (e.g., `quant-lab-nexus-v1.0.0`).

### Plugin Zip Explained

Plugin zip is a compressed package containing all plugin files. Users download this zip from Marketplace, which is then extracted to local plugins directory.

## Related

- Quant Lab Plugin Distribution Strategy
- Plugin Registry GitHub Repository Setup
- Plugin Marketplace Implementation

## Date

2026-02-06
