/**
 * TICKET_1265_2 AC5: discovery-path contract test.
 *
 * The Service API discovery files (api-port / api-token) are WRITTEN by
 * apps/desktop/src/main/services/api/http-server.ts `getDiscoveryDir()`
 * (dev branch: `app.getAppPath()/data` == apps/desktop/data) and READ by the
 * standalone MCP bridge via `resolveDiscoveryDir()` in db.ts.
 *
 * RC1 was a silent mismatch: the reader derived the dev dir from a fixed
 * `__dirname` depth that resolved to a nonexistent directory in the compiled
 * dist layout, so the bridge was structurally always null and every LLM
 * settings tool degraded to the static provider catalog.
 *
 * This test locks the reader's dev data dir to the writer's dev data dir so the
 * mismatch cannot silently regress. It intentionally does NOT mock fs/path so
 * that the real `__dirname`-anchored resolution is exercised.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveDevDataDir } from '../db';

describe('TICKET_1265_2 discovery-path contract', () => {
  // The standalone package lives at apps/desktop/src/mcp/standalone. The writer
  // (getDiscoveryDir dev branch) targets app.getAppPath()/data == apps/desktop/
  // data. Anchoring on the standalone package root, apps/desktop is `../../../..`
  // and the dev data dir is that + 'data'.
  it('reader dev data dir resolves to apps/desktop/data', () => {
    const devDataDir = resolveDevDataDir();
    // basename chain must end .../apps/desktop/data
    expect(path.basename(devDataDir)).toBe('data');
    expect(path.basename(path.dirname(devDataDir))).toBe('desktop');
    // absolute, not a relative fragment
    expect(path.isAbsolute(devDataDir)).toBe(true);
  });

  it('reader dev data dir === writer dev data dir (getDiscoveryDir contract)', () => {
    // Independently recompute the writer's dev data dir from this test file's
    // known location: __dirname is apps/desktop/src/mcp/standalone/src/__tests__.
    // apps/desktop is `../../../../..` from here; its data dir is the writer's
    // dev discovery dir (app.getAppPath() == apps/desktop in dev).
    const desktopDir = path.resolve(__dirname, '..', '..', '..', '..', '..');
    const writerDevDataDir = path.join(desktopDir, 'data');

    expect(resolveDevDataDir()).toBe(writerDevDataDir);
  });
});
