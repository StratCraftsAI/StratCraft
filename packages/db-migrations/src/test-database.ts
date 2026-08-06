import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const NODE_ABI_BINDING = resolve(
  __dirname,
  '../../../apps/desktop/src/mcp/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
);

/** Open SQLite with the Node ABI binding installed for standalone MCP tests. */
export function openTestDatabase(
  filename: string,
  options: Database.Options = {},
): Database.Database {
  return new Database(filename, { ...options, nativeBinding: NODE_ABI_BINDING });
}
