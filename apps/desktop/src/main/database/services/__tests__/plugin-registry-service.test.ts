/**
 * PluginRegistryService Unit Tests
 *
 * TICKET_424_2F: Tests for plugin registration (UPSERT), permission retrieval,
 * and handling of missing/empty fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { PluginRegistryService } from '../plugin-registry-service';
import type { DatabaseManager } from '../../db-manager';

function createMockDb() {
  const stmtMock = {
    run: vi.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
  };
  const db = {
    prepare: vi.fn().mockReturnValue(stmtMock),
    transaction: vi.fn((fn: () => any) => fn),
  } as unknown as DatabaseManager;
  return { db, stmtMock };
}

describe('PluginRegistryService', () => {
  let db: DatabaseManager;
  let stmtMock: ReturnType<typeof createMockDb>['stmtMock'];
  let service: PluginRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, stmtMock } = createMockDb());
    service = new PluginRegistryService(db);
  });

  // =========================================================================
  // registerPlugin
  // =========================================================================

  describe('registerPlugin', () => {
    it('should UPSERT with JSON.stringify for hub fields', async () => {
      await service.registerPlugin({
        id: 'my-plugin',
        version: '1.0.0',
        displayName: 'My Plugin',
        hub: {
          contributes: ['nona_algorithm'],
          consumes: ['nona_factor'],
        },
      });

      const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO plugin_registry');
      expect(sql).toContain('ON CONFLICT(plugin_id) DO UPDATE');
      const params = stmtMock.run.mock.calls[0][0];
      expect(params.plugin_id).toBe('my-plugin');
      expect(params.hub_contributes).toBe('["nona_algorithm"]');
      expect(params.hub_consumes).toBe('["nona_factor"]');
      expect(params.display_name).toBe('My Plugin');
      expect(params.status).toBe('active');
    });

    it('should handle missing hub and displayName fields', async () => {
      await service.registerPlugin({
        id: 'bare-plugin',
        version: '0.1.0',
      });

      const params = stmtMock.run.mock.calls[0][0];
      expect(params.display_name).toBe('bare-plugin'); // fallback to id
      expect(params.hub_contributes).toBe('[]');
      expect(params.hub_consumes).toBe('[]');
    });

    it('should propagate DB errors', async () => {
      stmtMock.run.mockImplementation(() => { throw new Error('upsert fail'); });
      await expect(service.registerPlugin({ id: 'x', version: '1.0' })).rejects.toThrow('upsert fail');
    });
  });

  // =========================================================================
  // getPermissions
  // =========================================================================

  describe('getPermissions', () => {
    it('should return parsed JSON permissions', async () => {
      stmtMock.get.mockReturnValue({
        hub_contributes: '["nona_algorithm"]',
        hub_consumes: '["nona_factor"]',
      });

      const result = await service.getPermissions('my-plugin');

      expect(result).toEqual({
        contributes: ['nona_algorithm'],
        consumes: ['nona_factor'],
      });
    });

    it('should return null when plugin not found', async () => {
      stmtMock.get.mockReturnValue(undefined);
      const result = await service.getPermissions('missing');
      expect(result).toBeNull();
    });

    it('should handle empty JSON arrays', async () => {
      stmtMock.get.mockReturnValue({
        hub_contributes: '[]',
        hub_consumes: '[]',
      });

      const result = await service.getPermissions('empty-plugin');

      expect(result).toEqual({
        contributes: [],
        consumes: [],
      });
    });
  });
});
