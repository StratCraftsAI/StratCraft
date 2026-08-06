/**
 * Universe Management MCP tool handlers.
 *
 * TICKET_1235_6: 9 typed tools covering universe CRUD, symbol membership,
 * and nona-universe bridge persistence.
 *
 * Unlike data-management (which bridges to the Electron Service API over HTTP),
 * these handlers operate directly on the better-sqlite3 database via
 * UniverseService / NonaUniverseService -- the same services the IPC handlers
 * use. This avoids adding universe-specific API routes: universes are local
 * SQLite rows with no async I/O, so the direct path is simpler and faster.
 *
 * Service creation is factored into a replaceable factory (`createServices`)
 * so the MCP standalone test suite can inject mocks without cross-package
 * vi.mock paths.
 */
import type Database from 'better-sqlite3';
import type { McpToolResult } from './tool-result';
import { discoverServiceApi } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';
import { electronNotRunning } from './electron-guard';

// ---------------------------------------------------------------------------
// Service interfaces (subset of the real services that handlers consume)
// ---------------------------------------------------------------------------

export interface UniverseSvc {
  list(provider: string): unknown[];
  get(id: number): { symbolCount: number; [k: string]: unknown } | null;
  create(params: { name: string; provider: string; symbols?: string[] }): { id: number };
  update(params: { id: number; name?: string; targetSize?: number | null }): void;
  delete(id: number): void;
  addSymbols(params: { universeId: number; symbols: string[] }): void;
  removeSymbols(params: { universeId: number; symbols: string[] }): void;
}

export interface NonaUniverseSvc {
  get(id: string): unknown | null;
  persist(input: { id: string; name?: string; sleeves: ReadonlyArray<{ providerId: string; symbols: ReadonlyArray<string> }> }): unknown;
}

export interface Services {
  universe: UniverseSvc;
  nonaUniverse: NonaUniverseSvc;
}

// ---------------------------------------------------------------------------
// Default service factory (real implementations)
// ---------------------------------------------------------------------------

let _createServices: (db: Database.Database) => Services;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { UniverseService } = require('../../../../main/database/services/universe-service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NonaUniverseService } = require('../../../../main/database/services/nona-universe-service');
  _createServices = (db: Database.Database) => ({
    universe: new UniverseService(db as any),
    nonaUniverse: new NonaUniverseService(db as any),
  });
} catch {
  _createServices = () => {
    throw new Error('Universe services not available (standalone mode without Electron main)');
  };
}

export let createServices = _createServices;

export function setServiceFactory(factory: (db: Database.Database) => Services): void {
  createServices = factory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): McpToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// =============================================================================
// F1: Read Tools (T0) -- list_universes, get_universe
// =============================================================================

export function handleListUniverses(
  db: Database.Database,
  params: { provider: string },
): McpToolResult {
  const provider = params.provider?.trim();
  if (!provider) return err('provider is required');
  try {
    const { universe } = createServices(db);
    return ok(universe.list(provider));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function handleGetUniverse(
  db: Database.Database,
  params: { id: number },
): McpToolResult {
  if (!Number.isInteger(params.id) || params.id <= 0) {
    return err('id must be a positive integer');
  }
  try {
    const { universe } = createServices(db);
    const detail = universe.get(params.id);
    if (!detail) return err(`Universe id=${params.id} not found`);
    return ok(detail);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// =============================================================================
// F2: Write Tools (T1) -- create, update, add/remove symbols
// =============================================================================

export function handleCreateUniverse(
  db: Database.Database,
  params: { name: string; provider: string; symbols?: string[] },
): McpToolResult {
  const name = params.name?.trim();
  const provider = params.provider?.trim();
  if (!name || !provider) return err('name and provider are required');
  try {
    const symbols = Array.isArray(params.symbols)
      ? params.symbols
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim())
      : undefined;
    const { universe } = createServices(db);
    return ok(universe.create({ name, provider, symbols }));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function handleUpdateUniverse(
  db: Database.Database,
  params: { id: number; name?: string; target_size?: number | null },
): McpToolResult {
  if (!Number.isInteger(params.id) || params.id <= 0) {
    return err('id must be a positive integer');
  }
  const name = params.name !== undefined ? params.name?.trim() : undefined;
  if (name !== undefined && !name) return err('name must not be empty');

  let targetSize: number | null | undefined;
  if (params.target_size !== undefined) {
    if (params.target_size === null) {
      targetSize = null;
    } else if (Number.isInteger(params.target_size) && params.target_size >= 1) {
      targetSize = params.target_size;
    } else {
      return err('target_size must be null or a positive integer');
    }
  }
  try {
    const { universe } = createServices(db);
    if (typeof targetSize === 'number') {
      const existing = universe.get(params.id);
      if (existing && targetSize > existing.symbolCount) {
        return err(`target_size (${targetSize}) exceeds candidate pool (${existing.symbolCount})`);
      }
    }
    universe.update({ id: params.id, name, targetSize });
    return ok({ updated: true });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function handleAddUniverseSymbols(
  db: Database.Database,
  params: { universe_id: number; symbols: string[] },
): McpToolResult {
  if (!Number.isInteger(params.universe_id) || params.universe_id <= 0) {
    return err('universe_id must be a positive integer');
  }
  if (!Array.isArray(params.symbols)) return err('symbols[] is required');
  const symbols = params.symbols
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
  if (symbols.length === 0) return err('symbols[] must contain at least one non-empty string');
  try {
    const { universe } = createServices(db);
    universe.addSymbols({ universeId: params.universe_id, symbols });
    return ok({ added: symbols.length });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function handleRemoveUniverseSymbols(
  db: Database.Database,
  params: { universe_id: number; symbols: string[] },
): McpToolResult {
  if (!Number.isInteger(params.universe_id) || params.universe_id <= 0) {
    return err('universe_id must be a positive integer');
  }
  if (!Array.isArray(params.symbols)) return err('symbols[] is required');
  const symbols = params.symbols
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
  if (symbols.length === 0) return err('symbols[] must contain at least one non-empty string');
  try {
    const { universe } = createServices(db);
    universe.removeSymbols({ universeId: params.universe_id, symbols });
    return ok({ removed: symbols.length });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// =============================================================================
// F3: Delete (T2, confirm + sweep guard)
// =============================================================================

export async function handleDeleteUniverse(
  db: Database.Database,
  params: { id: number; confirm: boolean },
): Promise<McpToolResult> {
  if (!Number.isInteger(params.id) || params.id <= 0) {
    return err('id must be a positive integer');
  }
  if (!params.confirm) {
    return err('delete_universe requires confirm=true. This is a destructive operation.');
  }
  // The sweep-running guard is Class-R: only the live desktop sweep engine knows
  // whether a sweep is in flight against this universe. When Electron is absent
  // that guard CANNOT be evaluated, so a destructive delete must NOT silently
  // proceed unguarded (TICKET_858: no silent failure; the former Electron-absent
  // path skipped the check and deleted anyway -- a degraded, unsafe answer that
  // is deleted here). The delete requires the desktop app to be running so the
  // guard can run.
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('delete_universe');
  try {
    const statusResp = await apiClient.getSweepStatus(config);
    if (statusResp.success && statusResp.data) {
      const state = statusResp.data as { status?: string; sessionId?: string };
      if (state.status === 'running') {
        return err(
          `Cannot delete universe while a sweep is running (session ${state.sessionId ?? 'unknown'}). ` +
          `Stop the sweep first with stop_sweep.`,
        );
      }
    }
    const { universe } = createServices(db);
    universe.delete(params.id);
    return ok({ deleted: true });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// =============================================================================
// F4: Nona-universe bridge
// =============================================================================

export function handleGetNonaUniverse(
  db: Database.Database,
  params: { id: string },
): McpToolResult {
  const id = params.id?.trim();
  if (!id) return err('id must be a non-empty string');
  try {
    const { nonaUniverse } = createServices(db);
    const row = nonaUniverse.get(id);
    if (!row) return err(`Nona universe id='${id}' not found`);
    return ok(row);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function handlePersistNonaUniverse(
  db: Database.Database,
  params: { id: string; name?: string; sleeves: ReadonlyArray<{ providerId: string; symbols: ReadonlyArray<string> }> },
): McpToolResult {
  const id = params.id?.trim();
  if (!id) return err('id must be a non-empty string');
  if (!Array.isArray(params.sleeves) || params.sleeves.length === 0) {
    return err('sleeves[] must contain at least one sleeve');
  }
  try {
    const { nonaUniverse } = createServices(db);
    const row = nonaUniverse.persist({ id, name: params.name, sleeves: params.sleeves });
    return ok(row);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
