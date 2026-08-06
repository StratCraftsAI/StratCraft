/**
 * PluginPortManager Unit Tests
 *
 * TICKET_632_2 / TICKET_1037: Tests for renderer-side plugin port management.
 * The real MessagePort lives in preload; the renderer uses the pluginPort bridge.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electronAPI.pluginPort bridge (mirrors preload's pluginPort namespace)
// ---------------------------------------------------------------------------

const readyPlugins = new Set<string>();
const readyWaiters = new Map<string, Array<() => void>>();
const messageListeners = new Map<string, Set<(data: unknown) => void>>();

const mockPluginPort = {
  listen: vi.fn(),
  isReady: vi.fn((pluginId: string) => readyPlugins.has(pluginId)),
  waitForReady: vi.fn((pluginId: string) => {
    if (readyPlugins.has(pluginId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const pending = readyWaiters.get(pluginId) ?? [];
      pending.push(resolve);
      readyWaiters.set(pluginId, pending);
    });
  }),
  send: vi.fn(),
  onMessage: vi.fn((pluginId: string, cb: (data: unknown) => void) => {
    let cbs = messageListeners.get(pluginId);
    if (!cbs) {
      cbs = new Set();
      messageListeners.set(pluginId, cbs);
    }
    cbs.add(cb);
    return () => { cbs!.delete(cb); };
  }),
  close: vi.fn(),
};

function simulatePortReady(pluginId: string): void {
  readyPlugins.add(pluginId);
  const waiters = readyWaiters.get(pluginId);
  if (waiters) {
    for (const w of waiters) w();
    readyWaiters.delete(pluginId);
  }
}

(globalThis as unknown as Record<string, unknown>).window = {
  electronAPI: { pluginPort: mockPluginPort },
};

// ---------------------------------------------------------------------------
// Import after mock
// ---------------------------------------------------------------------------

async function freshImport() {
  vi.resetModules();
  return import('../plugin-port-manager');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginPortManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readyPlugins.clear();
    readyWaiters.clear();
    messageListeners.clear();
  });

  describe('listen', () => {
    it('should call pluginPort.listen with pluginId', async () => {
      const { pluginPortManager } = await freshImport();
      pluginPortManager.listen('test-plugin');
      expect(mockPluginPort.listen).toHaveBeenCalledWith('test-plugin');
    });

    it('should not double-listen for same pluginId', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      pluginPortManager.listen('test-plugin');
      pluginPortManager.listen('test-plugin');
      expect(mockPluginPort.listen).toHaveBeenCalledTimes(1);
    });
  });

  describe('isReady', () => {
    it('should return false when port not ready', async () => {
      const { pluginPortManager } = await freshImport();
      expect(pluginPortManager.isReady('test-plugin')).toBe(false);
    });

    it('should return true when port is ready', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      expect(pluginPortManager.isReady('test-plugin')).toBe(true);
    });
  });

  describe('waitForReady', () => {
    it('should resolve immediately if port already ready', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      await pluginPortManager.waitForReady('test-plugin');
      expect(mockPluginPort.waitForReady).toHaveBeenCalledWith('test-plugin');
    });

    it('should resolve when port becomes ready', async () => {
      const { pluginPortManager } = await freshImport();
      const promise = pluginPortManager.waitForReady('test-plugin');
      simulatePortReady('test-plugin');
      await promise;
    });
  });

  describe('getProxy', () => {
    it('should return null when port not ready', async () => {
      const { pluginPortManager } = await freshImport();
      expect(pluginPortManager.getProxy('test-plugin')).toBeNull();
    });

    it('should return proxy with send and onMessage when ready', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      const proxy = pluginPortManager.getProxy('test-plugin');
      expect(proxy).not.toBeNull();
      expect(proxy!.send).toBeInstanceOf(Function);
      expect(proxy!.onMessage).toBeInstanceOf(Function);
    });

    it('proxy.send should delegate to pluginPort.send', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      const proxy = pluginPortManager.getProxy('test-plugin')!;
      proxy.send({ test: true });
      expect(mockPluginPort.send).toHaveBeenCalledWith('test-plugin', { test: true });
    });

    it('proxy.onMessage should delegate to pluginPort.onMessage', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      const proxy = pluginPortManager.getProxy('test-plugin')!;
      const cb = vi.fn();
      proxy.onMessage(cb);
      expect(mockPluginPort.onMessage).toHaveBeenCalledWith('test-plugin', cb);
    });
  });

  describe('cleanup', () => {
    it('should call pluginPort.close', async () => {
      simulatePortReady('test-plugin');
      const { pluginPortManager } = await freshImport();
      pluginPortManager.listen('test-plugin');
      await pluginPortManager.waitForReady('test-plugin');
      pluginPortManager.cleanup('test-plugin');
      expect(mockPluginPort.close).toHaveBeenCalledWith('test-plugin');
    });
  });

  describe('cleanupAll', () => {
    it('should close all tracked plugins', async () => {
      simulatePortReady('plugin-1');
      simulatePortReady('plugin-2');
      const { pluginPortManager } = await freshImport();
      pluginPortManager.listen('plugin-1');
      pluginPortManager.listen('plugin-2');
      await pluginPortManager.waitForReady('plugin-1');
      await pluginPortManager.waitForReady('plugin-2');

      pluginPortManager.cleanupAll();

      expect(mockPluginPort.close).toHaveBeenCalledWith('plugin-1');
      expect(mockPluginPort.close).toHaveBeenCalledWith('plugin-2');
    });
  });
});
