/**
 * DataHubClient Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests singleton, entity API, state API, events API, and files API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock window.electronAPI
const mockInvokeEntity = vi.fn();
const mockSetState = vi.fn();
const mockGetState = vi.fn();
const mockGetAllState = vi.fn();
const mockOnStateChanged = vi.fn();
const mockEmit = vi.fn();
const mockReplay = vi.fn();
const mockOnEvent = vi.fn();
const mockFindFiles = vi.fn();
const mockResolveFile = vi.fn();
const mockRemoveFile = vi.fn();
const mockTransaction = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    hub: {
      invokeEntity: mockInvokeEntity,
      setState: mockSetState,
      getState: mockGetState,
      getAllState: mockGetAllState,
      onStateChanged: mockOnStateChanged,
      emit: mockEmit,
      replay: mockReplay,
      onEvent: mockOnEvent,
      findFiles: mockFindFiles,
      resolveFile: mockResolveFile,
      removeFile: mockRemoveFile,
      transaction: mockTransaction,
    },
  },
});

import { DataHubClient, hubClient } from '../hub-client';

// =============================================================================
// Tests
// =============================================================================

describe('DataHubClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Singleton
  // =========================================================================

  describe('singleton', () => {
    it('should return same instance', () => {
      const a = DataHubClient.getInstance();
      const b = DataHubClient.getInstance();
      expect(a).toBe(b);
    });

    it('should export hubClient as default singleton', () => {
      expect(hubClient).toBe(DataHubClient.getInstance());
    });
  });

  // =========================================================================
  // Plugin ID
  // =========================================================================

  describe('setPluginId', () => {
    it('should use system as default pluginId', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: 1 });

      await hubClient.entities('nona_algorithm').save({ strategy_name: 'test' });

      expect(mockInvokeEntity).toHaveBeenCalledWith('save', 'nona_algorithm', { strategy_name: 'test' }, 'system');
    });

    it('should use custom pluginId after setPluginId', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: 1 });

      hubClient.setPluginId('com.test.plugin');
      await hubClient.entities('nona_algorithm').save({ strategy_name: 'test' });

      expect(mockInvokeEntity).toHaveBeenCalledWith('save', 'nona_algorithm', { strategy_name: 'test' }, 'com.test.plugin');

      // Restore default
      hubClient.setPluginId('system');
    });
  });

  // =========================================================================
  // Entity API
  // =========================================================================

  describe('entities', () => {
    it('save should invoke entity save', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: 42 });

      const result = await hubClient.entities('nona_algorithm').save({ strategy_name: 'test' });

      expect(mockInvokeEntity).toHaveBeenCalledWith('save', 'nona_algorithm', { strategy_name: 'test' }, 'system');
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('get should invoke entity get', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: { id: 1, strategy_name: 'test' } });

      const result = await hubClient.entities('nona_algorithm').get(1);

      expect(mockInvokeEntity).toHaveBeenCalledWith('get', 'nona_algorithm', 1, 'system');
      expect(result.success && result.data.strategy_name).toBe('test');
    });

    it('list should invoke entity list', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: [] });

      await hubClient.entities('nona_algorithm').list({ limit: 10 });

      expect(mockInvokeEntity).toHaveBeenCalledWith('list', 'nona_algorithm', { limit: 10 }, 'system');
    });

    it('update should invoke entity update', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true });

      await hubClient.entities('nona_algorithm').update(1, { strategy_name: 'updated' }, 2);

      expect(mockInvokeEntity).toHaveBeenCalledWith(
        'update',
        'nona_algorithm',
        { id: 1, data: { strategy_name: 'updated' }, expectedVersion: 2 },
        'system',
      );
    });
  });

  // =========================================================================
  // State API
  // =========================================================================

  describe('state', () => {
    it('set should call setState', () => {
      hubClient.state.set('active_symbol' as any, 'AAPL');

      expect(mockSetState).toHaveBeenCalledWith('active_symbol', 'AAPL', 'system');
    });

    it('get should call getState', async () => {
      mockGetState.mockResolvedValue('AAPL');

      const val = await hubClient.state.get('active_symbol' as any);

      expect(mockGetState).toHaveBeenCalledWith('active_symbol');
      expect(val).toBe('AAPL');
    });

    it('getAll should call getAllState', async () => {
      mockGetAllState.mockResolvedValue({ active_symbol: 'AAPL' });

      const all = await hubClient.state.getAll();

      expect(mockGetAllState).toHaveBeenCalled();
      expect(all).toEqual({ active_symbol: 'AAPL' });
    });

    it('subscribe should register listener and filter by key', () => {
      let capturedCb: ((event: any) => void) | undefined;
      mockOnStateChanged.mockImplementation((cb: (event: any) => void) => {
        capturedCb = cb;
        return () => {};
      });

      const callback = vi.fn();
      hubClient.state.subscribe('active_symbol' as any, callback);

      // Matching key
      capturedCb!({ key: 'active_symbol', value: 'MSFT' });
      expect(callback).toHaveBeenCalledWith('MSFT');

      // Non-matching key
      callback.mockClear();
      capturedCb!({ key: 'other_key', value: 'ignored' });
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Event Bus API
  // =========================================================================

  describe('events', () => {
    it('emit should call hub emit', () => {
      hubClient.events.emit('file:registered' as any, { fileId: 'f1' });

      expect(mockEmit).toHaveBeenCalledWith('file:registered', { fileId: 'f1' }, 'system');
    });

    it('on should register event listener filtered by type', () => {
      let capturedCb: ((event: any) => void) | undefined;
      mockOnEvent.mockImplementation((cb: (event: any) => void) => {
        capturedCb = cb;
        return () => {};
      });
      mockReplay.mockResolvedValue(null);

      const callback = vi.fn();
      hubClient.events.on('file:registered' as any, callback);

      // Matching event
      capturedCb!({ event: 'file:registered', payload: { fileId: 'f1' } });
      expect(callback).toHaveBeenCalledWith({ fileId: 'f1' });

      // Non-matching event
      callback.mockClear();
      capturedCb!({ event: 'file:removed', payload: {} });
      expect(callback).not.toHaveBeenCalled();
    });

    it('on with replay should replay last event', () => {
      mockOnEvent.mockReturnValue(() => {});
      mockReplay.mockResolvedValue({ fileId: 'last' });

      const callback = vi.fn();
      hubClient.events.on('file:registered' as any, callback, { replay: true });

      expect(mockReplay).toHaveBeenCalledWith('file:registered');
    });
  });

  // =========================================================================
  // Files API
  // =========================================================================

  describe('files', () => {
    it('save should validate type is present', async () => {
      const result = await hubClient.files.save({});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('save should invoke entity save with file:type', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: 'file-id' });

      await hubClient.files.save({ type: 'strategy', name: 'test.py' } as any);

      expect(mockInvokeEntity).toHaveBeenCalledWith(
        'save',
        'file:strategy',
        expect.objectContaining({ type: 'strategy', name: 'test.py' }),
        'system',
      );
    });

    it('get should invoke entity get with file:type', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: { id: 'f1' } });

      await hubClient.files.get('f1', 'strategy');

      expect(mockInvokeEntity).toHaveBeenCalledWith('get', 'file:strategy', 'f1', 'system');
    });

    it('find should call findFiles', async () => {
      mockFindFiles.mockResolvedValue({ success: true, data: [] });

      await hubClient.files.find({ type: 'strategy' });

      expect(mockFindFiles).toHaveBeenCalledWith({ type: 'strategy' }, 'system');
    });

    it('resolve should call resolveFile', async () => {
      mockResolveFile.mockResolvedValue({ success: true, data: { type: 'path', data: '/tmp/test.py' } });

      await hubClient.files.resolve('f1');

      expect(mockResolveFile).toHaveBeenCalledWith('f1', 'system');
    });

    it('remove should call removeFile', async () => {
      mockRemoveFile.mockResolvedValue({ success: true });

      await hubClient.files.remove('f1', true);

      expect(mockRemoveFile).toHaveBeenCalledWith('f1', true, 'system');
    });
  });

  // =========================================================================
  // Transaction
  // =========================================================================

  describe('transaction', () => {
    it('should call hub transaction', async () => {
      mockTransaction.mockResolvedValue({ success: true });

      await hubClient.transaction([{ op: 'save', entity: 'test', data: {} }]);

      expect(mockTransaction).toHaveBeenCalledWith(
        [{ op: 'save', entity: 'test', data: {} }],
        'system',
      );
    });
  });
});
