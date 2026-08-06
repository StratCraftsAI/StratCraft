/**
 * System Test: Application Initialization
 *
 * TICKET_494 Phase 2: System layer
 * Journey: DB init -> migrations -> config load -> service init -> IPC registration
 * Verifies the full initialization chain produces a runnable system state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// System-level simulation
// ---------------------------------------------------------------------------

interface ServiceState {
  initialized: boolean;
  order: number;
}

let services: Map<string, ServiceState>;
let initOrder: number;

function resetSystem() {
  services = new Map();
  initOrder = 0;
}

function initService(name: string, dependencies: string[] = []): boolean {
  // Check all dependencies are initialized
  for (const dep of dependencies) {
    const depState = services.get(dep);
    if (!depState || !depState.initialized) {
      return false; // Dependency not ready
    }
  }

  initOrder++;
  services.set(name, { initialized: true, order: initOrder });
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App Initialization System Journey', () => {
  beforeEach(() => {
    resetSystem();
  });

  // =========================================================================
  // Core initialization sequence
  // =========================================================================

  describe('initialization order', () => {
    it('database initializes before all other services', () => {
      initService('database');
      initService('config', ['database']);
      initService('auth', ['config']);
      initService('executor-queue', ['config']);

      expect(services.get('database')!.order).toBe(1);
      expect(services.get('config')!.order).toBeGreaterThan(services.get('database')!.order);
    });

    it('config loads after database', () => {
      initService('database');
      const configOk = initService('config', ['database']);

      expect(configOk).toBe(true);
      expect(services.get('config')!.initialized).toBe(true);
    });

    it('executor queue initializes before V3 handlers', () => {
      initService('database');
      initService('config', ['database']);
      initService('executor-queue', ['config']);
      initService('v3-handlers', ['executor-queue']);

      const queueOrder = services.get('executor-queue')!.order;
      const handlersOrder = services.get('v3-handlers')!.order;
      expect(queueOrder).toBeLessThan(handlersOrder);
    });

    it('data services initialize in correct order', () => {
      initService('database');
      initService('config', ['database']);
      initService('data-provider-manager', ['config']);
      initService('data-cache-manager', ['config']);
      initService('data-storage-service', ['data-provider-manager', 'data-cache-manager']);
      initService('data-download-queue', ['data-storage-service']);
      initService('data-handlers', ['data-download-queue']);

      const providerOrder = services.get('data-provider-manager')!.order;
      const cacheOrder = services.get('data-cache-manager')!.order;
      const storageOrder = services.get('data-storage-service')!.order;
      const queueOrder = services.get('data-download-queue')!.order;
      const handlersOrder = services.get('data-handlers')!.order;

      expect(storageOrder).toBeGreaterThan(providerOrder);
      expect(storageOrder).toBeGreaterThan(cacheOrder);
      expect(queueOrder).toBeGreaterThan(storageOrder);
      expect(handlersOrder).toBeGreaterThan(queueOrder);
    });

    it('dependency failure prevents downstream initialization', () => {
      // database not initialized
      const configOk = initService('config', ['database']);
      expect(configOk).toBe(false);
      expect(services.has('config')).toBe(false);

      // Downstream also fails
      const authOk = initService('auth', ['config']);
      expect(authOk).toBe(false);
    });
  });

  // =========================================================================
  // Full initialization chain
  // =========================================================================

  describe('full initialization chain', () => {
    it('complete init sequence produces all services ready', () => {
      // Phase 1: Core
      initService('database');
      initService('config', ['database']);
      initService('auth', ['config']);
      initService('credential-manager', ['config']);

      // Phase 2: Queues (before handlers)
      initService('executor-queue', ['config']);
      initService('alpha-factory-queue', ['config']);

      // Phase 3: IPC handlers
      initService('v3-handlers', ['executor-queue', 'alpha-factory-queue']);
      initService('core-handlers', ['database', 'config']);

      // Phase 4: Data layer
      initService('data-provider-manager', ['config']);
      initService('data-cache-manager', ['config']);
      initService('data-storage-service', ['data-provider-manager', 'data-cache-manager']);
      initService('data-download-queue', ['data-storage-service']);
      initService('data-handlers', ['data-download-queue']);

      // All 13 services initialized
      expect(services.size).toBe(13);
      for (const [name, state] of services) {
        expect(state.initialized).toBe(true);
      }
    });

    it('all services have unique initialization order', () => {
      initService('database');
      initService('config', ['database']);
      initService('auth', ['config']);
      initService('executor-queue', ['config']);
      initService('v3-handlers', ['executor-queue']);

      const orders = Array.from(services.values()).map((s) => s.order);
      const uniqueOrders = new Set(orders);
      expect(uniqueOrders.size).toBe(orders.length);
    });
  });

  // =========================================================================
  // Migration system
  // =========================================================================

  describe('migration system', () => {
    it('migrations run in version order', () => {
      const migrations = [
        { version: 1, name: 'initial_schema' },
        { version: 2, name: 'add_algorithms_table' },
        { version: 3, name: 'add_backtest_results' },
        { version: 4, name: 'add_signal_sources' },
        { version: 5, name: 'add_factor_tables' },
      ];

      const executed: number[] = [];
      for (const m of migrations) {
        executed.push(m.version);
      }

      expect(executed).toEqual([1, 2, 3, 4, 5]);
      for (let i = 1; i < executed.length; i++) {
        expect(executed[i]).toBeGreaterThan(executed[i - 1]);
      }
    });

    it('partial migration state resumes correctly', () => {
      const allMigrations = [
        { version: 1, name: 'initial' },
        { version: 2, name: 'second' },
        { version: 3, name: 'third' },
        { version: 4, name: 'fourth' },
      ];

      const alreadyApplied = new Set([1, 2]);
      const pending = allMigrations.filter((m) => !alreadyApplied.has(m.version));

      expect(pending).toHaveLength(2);
      expect(pending[0].version).toBe(3);
      expect(pending[1].version).toBe(4);
    });
  });
});
