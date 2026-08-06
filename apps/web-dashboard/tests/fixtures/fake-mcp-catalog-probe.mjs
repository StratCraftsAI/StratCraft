#!/usr/bin/env node
if (process.env.FAKE_MCP_CATALOG_RESULT === 'mismatch') {
  process.stderr.write('[ERROR] MCP catalog proof failed: fixture_tool missing\n');
  process.exit(1);
}
process.stdout.write('[webdash] Live MCP catalog contains all 1 build-declared tools.\n');
