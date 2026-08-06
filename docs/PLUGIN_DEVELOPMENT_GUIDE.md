# Plugin Development Guide



????**????**????, ????? `onInstall` ??:

```bash
# ??1: ?? start.sh
./start.sh

# ??2: ?? scripts/dev.sh
./scripts/dev.sh

# ??3: ?? turbo (?? start.sh ????)
pnpm run dev
```

- ??  ?? `~/.config/@StratCraft/desktop/plugin-data/`
- [OK] ???? default plugins ? `onInstall` hook
- ? ?? Database Protocol ??????

```
[INFO] ????????(?? onInstall ??)...
[INFO] ??: /home/user/.config/@StratCraft/desktop/plugin-data
[INFO] ??: ?? KEEP_PLUGIN_DATA=1 ./start.sh ?????
```

---



```bash
KEEP_PLUGIN_DATA=1 ./start.sh

# ??2: export ???
export KEEP_PLUGIN_DATA=1
./start.sh

# ??3: ?? scripts/dev.sh
KEEP_PLUGIN_DATA=1 ./scripts/dev.sh
```

- ? ?? `plugin-data` ??
- ??  ?? `onInstall` hook

---


????????**????**?? lifecycle ??????:


1. [OK] Manifest.json ???
2. [OK] Lifecycle hooks ?? (`onInstall`, `onUpgrade`, `onUninstall`)
3. [OK] ???? `.js` ??????
4. [OK] Database Protocol API ?? (`context.database`)



```bash
./scripts/verify-plugin-init.sh
```


```bash
? Verifying plugin initialization scripts...

Checking plugin: back-test-nexus
  [OK]  Script exists: ./scripts/install.js
  [OK]  Database Protocol usage found

Checking plugin: data-source-nexus
  [OK]  Script exists: ./scripts/install.js
  [OK]  Database Protocol usage found

Checking plugin: strategy-builder-nexus
  [OK]  Script exists: ./scripts/install.js
  [OK]  Database Protocol usage found

[OK] All plugin lifecycle scripts verified successfully
```

- [FAIL] ??/?????**????**

---



```bash
# ???? onInstall ????
tail -f apps/desktop/logs/main.log | grep -E "First-time|LifecycleRunner|DB:"
```

- `[ExtHostService] First-time initialization for plugin: <plugin-id>`
- `[LifecycleRunner] Running onInstall for <plugin-id>`
- `[DB:<plugin-id>] Execute: CREATE TABLE ...`
- `[DB:<plugin-id>] Connection opened: <path>`


```bash
ls -la ~/.config/@StratCraft/desktop/plugin-data/*/storage.db

sqlite3 ~/.config/@StratCraft/desktop/plugin-data/com.StratCraft.back-test-nexus/storage.db ".schema"

# ?? schema ??
sqlite3 ~/.config/@StratCraft/desktop/plugin-data/com.StratCraft.back-test-nexus/storage.db \
  "SELECT * FROM _plugin_schema"
```

---



```bash
./start.sh build
```

2. ?? Bridge (????)
3. ?? Python/Cython ??
4. ?? TypeScript ??
5. ?? Electron ??

---


### Q1: ???????????(onUpgrade)?

```bash
KEEP_PLUGIN_DATA=1 ./start.sh

# 2. ????, ?? manifest.json ?? dbSchemaVersion
# 3. ??????: plugins/<plugin>/migrations/002_migration.sql
# 4. ????, ?? onUpgrade ??
KEEP_PLUGIN_DATA=1 ./start.sh
```

### Q2: ???? Database Protocol ????

```bash
# ? install.ts ??? SQL ??(??? Host ??)
await database.execute("ATTACH DATABASE '/etc/passwd' AS evil");
# ??: ???? "[pluginId] ATTACH DATABASE is forbidden"

await database.execute("SELECT * FROM ../other-plugin/storage.db");
# ??: ???? "[pluginId] SQL contains forbidden path traversal"
```


```bash
KEEP_PLUGIN_DATA=1 ./start.sh
```

---


- **Plugin SDK Reference**: [docs/plugin/PLUGIN_SDK_REFERENCE.md](plugin/PLUGIN_SDK_REFERENCE.md)
- **Manifest Reference**: [docs/plugin/PLUGIN_MANIFEST_REFERENCE.md](plugin/PLUGIN_MANIFEST_REFERENCE.md)
- **Credential API Guide**: [docs/plugin/CREDENTIAL_API_GUIDE.md](plugin/CREDENTIAL_API_GUIDE.md)
- **Quick Start**: [docs/plugin/QUICKSTART.md](plugin/QUICKSTART.md)

---

**Last Updated**: 2026-01-13
