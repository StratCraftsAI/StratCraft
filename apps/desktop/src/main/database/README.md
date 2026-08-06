# Desktop Database Infrastructure

**Plugin Database Architecture** - Framework provides API, Plugins provide Logic

See: [_PLUGIN_DATABASE_INFRASTRUCTURE.md](../../../../../docs/design/_PLUGIN_DATABASE_INFRASTRUCTURE.md)

---

## Architecture

```
Framework Layer (Infrastructure)
+-- db-manager.ts               [OK] SQLite connection management
+-- migrations/
|   +-- migration-manager.ts    [OK] Version control
+-- services/
    +-- database-service.ts     [OK] Plugin API (isolation)

Plugin Layer (Business Logic)
+-- algorithm-editor/
|   +-- database/
|   |   +-- schema/algorithms.sql
|   |   +-- repositories/algorithms-repository.ts
|   +-- data/plugin.db
+-- factor-library/
    +-- database/
    |   +-- schema/factors.sql
    |   +-- repositories/factors-repository.ts
    +-- data/plugin.db
```

---

## Framework Components

### DatabaseManager

**Purpose**: SQLite connection management (no business logic)

**Location**: `db-manager.ts`

**Usage**:
```typescript
import { DatabaseManager } from './db-manager';

const db = new DatabaseManager({ filename: '/path/to/db.sqlite' });
await db.initialize(); // Load schema.sql
```

**Features**:
- [OK] better-sqlite3 wrapper
- [OK] WAL mode for concurrency
- [OK] Foreign key enforcement
- [OK] Transaction support
- [OK] Prepared statements

---

### MigrationManager

**Purpose**: Version-controlled schema migrations

**Location**: `migrations/migration-manager.ts`

**Usage**:
```typescript
import { MigrationManager } from './migrations/migration-manager';

const migrationManager = new MigrationManager(db);
await migrationManager.migrate(); // Run pending migrations
```

**Migration File Format**:
```sql
-- UP MIGRATION
CREATE TABLE foo (...);

-- DOWN MIGRATION
DROP TABLE foo;
```

---

### DatabaseService

**Purpose**: Provide isolated database access to plugins

**Location**: `services/database-service.ts`

**API**:
```typescript
// Initialize service (called by main process)
await initializeDatabaseService();

// Get plugin's isolated database
const db = await getPluginDatabase('com.stratcraft.algorithm-editor');

// Each plugin gets its own .db file
// userData/plugins/com.stratcraft.algorithm-editor/plugin.db
```

**Data Isolation**:
- Each plugin has its own `.db` file
- Plugin ID validation (reverse domain notation)
- Path traversal protection
- Automatic directory creation

---

## Plugin Database Usage

### Example: Algorithm Editor Plugin

**Directory Structure**:
```
plugins/algorithm-editor/
+-- database/
|   +-- schema/
|   |   +-- 001_initial.sql      # Plugin schema
|   +-- repositories/
|       +-- algorithms-repository.ts
+-- src/
    +-- index.ts                  # Plugin entry point
```

**Plugin Initialization**:
```typescript
// plugins/algorithm-editor/src/index.ts
import { getPluginDatabase } from '@StratCraft/desktop/services/database-service';
import { AlgorithmsRepository } from '../database/repositories/algorithms-repository';

export async function activate(context: PluginContext) {
  // Get plugin's isolated database
  const db = await getPluginDatabase('com.stratcraft.algorithm-editor');

  // Run plugin's migrations
  await db.initialize(); // Loads database/schema/001_initial.sql

  // Use repository
  const repo = new AlgorithmsRepository(db);
  const algos = await repo.findByUserId('user123');
}
```

---

## Database Locations

| Environment | Path |
|-------------|------|
| Development | `apps/desktop/data/plugins/{pluginId}/plugin.db` |
| Production (macOS) | `~/Library/Application Support/StratCraft/plugins/{pluginId}/plugin.db` |
| Production (Windows) | `%APPDATA%/StratCraft/plugins/{pluginId}/plugin.db` |
| Production (Linux) | `~/.config/StratCraft/plugins/{pluginId}/plugin.db` |

---

## Plugin Examples

### Algorithm Editor

**Schema** (`database/schema/001_initial.sql`):
- Table: `algorithms`
- Based on WordPress `nona_algorithms`

**Repository** (`database/repositories/algorithms-repository.ts`):
- Full CRUD operations
- Type-safe interface
- JSON serialization

### Factor Library

**Schema** (`database/schema/001_initial.sql`):
- Table: `factors`
- Table: `factor_optimization_history`
- Based on WordPress `nona_factors`

**Repository** (`database/repositories/factors-repository.ts`):
- Performance metric queries
- Symbol validation tracking
- AI mining task linkage

---

## Migration from Framework (Previous Wrong Approach)

**Before** (Monolithic [FAIL]):
```
apps/desktop/src/main/database/
+-- schema.sql                    [FAIL] Business tables in framework
+-- repositories/
    +-- algorithms-repository.ts  [FAIL] Business logic in framework
    +-- factors-repository.ts     [FAIL] Business logic in framework
```

**After** (Plugin Architecture [OK]):
```
apps/desktop/src/main/database/
+-- schema.sql                    [OK] Infrastructure only
+-- db-manager.ts                 [OK] SQLite wrapper
+-- services/
    +-- database-service.ts       [OK] Plugin API

plugins/algorithm-editor/
+-- database/                     [OK] Business logic in plugin
    +-- schema/algorithms.sql
    +-- repositories/algorithms-repository.ts
```

---

## Security

### Plugin ID Validation

```typescript
// Valid plugin IDs (reverse domain notation)
'com.stratcraft.algorithm-editor'  [OK]
'com.stratcraft.factor-library'    [OK]
'com.example.my-plugin'            [OK]

// Invalid plugin IDs
'my-plugin'                        [FAIL] Not reverse domain
'com.StratCraft'                   [FAIL] Too short
'../../../etc/passwd'              [FAIL] Path traversal attempt
```

### Path Traversal Protection

```typescript
// DatabaseService validates all paths
const resolvedPath = path.resolve(dbPath);
if (!resolvedPath.startsWith(getPluginDataDir())) {
  throw new Error('Invalid database path: path traversal detected');
}
```

---

## Testing

### Unit Tests

```typescript
// __tests__/db-manager.test.ts
describe('DatabaseManager', () => {
  it('should create database file', () => { ... });
  it('should initialize schema', () => { ... });
  it('should execute transactions', () => { ... });
});
```

### Integration Tests

```typescript
// Test plugin database isolation
const algoDb = await getPluginDatabase('com.stratcraft.algorithm-editor');
const factorDb = await getPluginDatabase('com.stratcraft.factor-library');

// Verify databases are separate files
expect(algoDb.getPath()).not.toBe(factorDb.getPath());
```

---

## Status

| Component | Status | Notes |
|-----------|--------|-------|
| DatabaseManager | [OK] Implemented | SQLite wrapper |
| MigrationManager | [OK] Implemented | Version control |
| DatabaseService | [OK] Implemented | Plugin API |
| Framework schema.sql | [OK] Cleaned | Infrastructure only |
| algorithm-editor schema | [OK] Created | Plugin database |
| algorithm-editor repository | [OK] Moved | From framework backup |
| factor-library schema | [OK] Created | Plugin database |
| factor-library repository | [OK] Moved | From framework backup |
| Bridge API | ? Pending | Future enhancement |
| Integration tests | ? Pending | Validation needed |

---

## Related Documents

- [_PLUGIN_DATABASE_INFRASTRUCTURE.md](../../../../../docs/design/_PLUGIN_DATABASE_INFRASTRUCTURE.md) - Complete architecture
- [_ARCHITECTURE_CORRECTION_SUMMARY.md](../../../../../docs/design/_ARCHITECTURE_CORRECTION_SUMMARY.md) - Refactoring summary
- [_VSCODE_PLUGIN_ARCHITECTURE.md](../../../../../docs/design/_VSCODE_PLUGIN_ARCHITECTURE.md) - Plugin system foundation

---

**Last Updated**: 2026-01-13 (Plugin architecture implementation complete)
