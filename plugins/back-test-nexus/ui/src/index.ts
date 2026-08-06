/**
 * Backtest Plugin - StratCraft Strategy Backtesting Engine
 *
 * TICKET_097_4: Bridge Integration
 * - SessionApi for backtest session management
 * - Bridge.registerBacktestEngine() for Core registry
 * - DataChannel for tick data during backtest
 *
 * Provides strategy backtesting with performance analytics.
 */

import type {
  PluginModule,
  PluginContext,
  PluginApi,
  DataSourcePlugin,
  OHLCVSeries,
  Disposable,
} from '@shared/types';
import type {
  BacktestConfig,
  BacktestRequest,
  BacktestResult,
  Strategy,
  BacktestEvent,
} from './types';
import { INTERVAL_1d } from '@StratCraft/types';
import { DEFAULT_INITIAL_CAPITAL, DEFAULT_COMMISSION_RATE } from '@shared/constants/trading';
import i18n from 'i18next';
import { BacktestEngine, DEFAULT_CONFIG } from './engine/engine';
import { builtInStrategies } from './engine/executor';

// TICKET_097_5: Bridge Integration via contributions API
type SessionConfig = {
  dataFeedId: string;
  strategyId: string;
  engineId: string;
  startTime: number;
  endTime: number;
  initialCapital: number;
  symbols: string[];
};
type BridgeBacktestResult = {
  success: boolean;
  totalReturn: number;
  errorMessage?: string;
};
type ProgressCallback = (percent: number, message: string) => void;

interface ContributionsApi {
  registerBacktestEngine?: (reg: { id: string; pluginId: string; adapter: string }) => boolean;
  unregisterBacktestEngine?: (id: string) => boolean;
  getDataFeeds?: () => Array<{ id: string; adapter: string }>;
  getStrategies?: () => Array<{ id: string; pluginId: string }>;
  getEngines?: () => Array<{ id: string; adapter: string }>;
}

// =============================================================================
// Backtest Plugin API
// =============================================================================

export interface BacktestPlugin extends PluginApi {
  // Engine access
  getEngine(): BacktestEngine;

  // Strategy management
  registerStrategy(strategy: Strategy): void;
  getStrategy(id: string): Strategy | undefined;
  getStrategies(): Strategy[];

  // Backtest execution
  run(request: BacktestRequest): Promise<BacktestResult>;
  stop(): void;
  isRunning(): boolean;

  // Configuration
  getConfig(): BacktestConfig;
  setConfig(config: Partial<BacktestConfig>): void;

  // Events
  onProgress(handler: (event: BacktestEvent) => void): () => void;

  // Results
  getLastResult(): BacktestResult | null;
  getResults(): BacktestResult[];
  clearResults(): void;
  exportResults(resultId: string, format: 'json' | 'csv'): Promise<string>;
}

// =============================================================================
// Plugin State
// =============================================================================

const disposables: Disposable[] = [];
let treeProvider: any = null;

// =============================================================================
// Backtest Plugin Implementation
// =============================================================================

class BacktestPluginImpl implements BacktestPlugin {
  private context: PluginContext;
  private engine: BacktestEngine;
  private dataPlugin: DataSourcePlugin | null = null;
  private results: BacktestResult[] = [];
  private lastResult: BacktestResult | null = null;

  // TICKET_097_5: Bridge Integration via contributions API
  private contributions: ContributionsApi | null = null;

  constructor(context: PluginContext, config?: Partial<BacktestConfig>) {
    this.context = context;
    this.engine = new BacktestEngine(config);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async activate(): Promise<void> {
    this.context.log.info('Backtest plugin (UI) activating...');

    // =========================================================================
    // TICKET_097_5: Access Bridge via contributions API
    // =========================================================================
    try {
      const nexus = (globalThis as { nexus?: { contributions?: ContributionsApi } }).nexus;
      this.contributions = nexus?.contributions || null;

      if (this.contributions?.registerBacktestEngine) {
        // Register backtest engines to Core registry
        this.contributions.registerBacktestEngine({
          id: 'nexus.builtin',
          pluginId: 'com.stratcraft.back-test-nexus',
          adapter: 'typescript',
        });

        this.context.log.info('Bridge contributions API available, backtest engines registered');
      } else {
        this.context.log.warn('Bridge contributions API not available (local engine mode)');
      }
    } catch (err) {
      this.context.log.warn(`Bridge access failed (fallback mode): ${err}`);
    }

    // Access windowApi from global (injected by host)
    const windowApi = (globalThis as { nexus?: { window: unknown } }).nexus?.window;

    if (windowApi) {
      const api = windowApi as {
        registerTreeDataProvider: (viewId: string, provider: unknown) => Disposable;
        registerViewProvider: (viewId: string, provider: unknown) => Disposable;
        openView: (viewId: string, options?: unknown) => Promise<void>;
      };

      // Register Tree Data Provider
      const { BacktestTreeDataProvider } = await import('./providers/BacktestTreeDataProvider');
      treeProvider = new BacktestTreeDataProvider();
      disposables.push(api.registerTreeDataProvider('backtest.tree', treeProvider));
      this.context.log.info('BacktestTreeDataProvider registered');

      // Command: backtest.openWorkflow
      // TICKET_300_1: setBreadcrumb removed - breadcrumbs derived from VIEW_REGISTRY by Host
      this.context.commands.register('backtest.openWorkflow', () => {
        api.openView('backtest.workflow');
      });
    } else {
      this.context.log.warn('windowApi not available - running in headless/fallback mode');
    }

    // Register commands
    this.registerCommands();

    // Setup event forwarding
    this.engine.onEvent((event) => {
      if (event.type === 'progress') {
        this.context.log.debug(`Backtest progress: ${JSON.stringify(event.data)}`);
      } else if (event.type === 'completed') {
        this.context.log.info('Backtest completed');
      } else if (event.type === 'error') {
        this.context.log.error(`Backtest error: ${JSON.stringify(event.data)}`);
      }
    });

    this.context.log.info('Backtest plugin activated');
  }

  async deactivate(): Promise<void> {
    this.context.log.info('Backtest plugin deactivating...');

    // =========================================================================
    // TICKET_097_5: Cleanup via contributions API
    // =========================================================================
    if (this.contributions?.unregisterBacktestEngine) {
      this.contributions.unregisterBacktestEngine('nexus.builtin');
    }
    this.contributions = null;

    // Dispose all registered providers
    for (const disposable of disposables) {
      disposable.dispose();
    }
    disposables.length = 0;

    // Stop any running backtest
    if (this.engine.isRunning()) {
      this.engine.stop();
    }

    this.context.log.info('Backtest plugin deactivated');
  }

  // ===========================================================================
  // Engine Access
  // ===========================================================================

  getEngine(): BacktestEngine {
    return this.engine;
  }

  // ===========================================================================
  // Strategy Management
  // ===========================================================================

  registerStrategy(strategy: Strategy): void {
    this.engine.registerStrategy(strategy);
    this.context.log.info(`Strategy registered: ${strategy.id}`);
  }

  getStrategy(id: string): Strategy | undefined {
    return this.engine.getStrategy(id);
  }

  getStrategies(): Strategy[] {
    return this.engine.getStrategies();
  }

  // ===========================================================================
  // Backtest Execution
  // ===========================================================================

  async run(request: BacktestRequest): Promise<BacktestResult> {
    this.context.log.info(`Starting backtest: ${request.strategyId} on ${request.symbol}`);

    // Fetch data
    const data = await this.fetchData(request);
    if (!data) {
      throw new Error(i18n.t('errors.fetchMarketDataFailed', { ns: 'backtest' }));
    }

    // Run backtest
    const result = await this.engine.run(request, data);

    // Store result
    this.lastResult = result;
    this.results.push(result);

    // Notify
    if (result.status === 'completed') {
      this.context.ui.showNotification(
        i18n.t('notification.backtestCompletedReturn', { ns: 'backtest', returnPercent: result.metrics.totalReturnPercent.toFixed(2) }),
        result.metrics.totalReturnPercent >= 0 ? 'success' : 'warning'
      );
    } else if (result.status === 'error') {
      this.context.ui.showNotification(i18n.t('notification.backtestFailed', { ns: 'backtest', error: result.error }), 'error');
    }

    return result;
  }

  // ===========================================================================
  // TICKET_097_5: Bridge-based queries via contributions API
  // ===========================================================================

  /**
   * Get available data feeds from contributions API
   */
  getAvailableDataFeeds() {
    return this.contributions?.getDataFeeds?.() || [];
  }

  /**
   * Get available strategies from contributions API
   */
  getAvailableStrategies() {
    return this.contributions?.getStrategies?.() || [];
  }

  /**
   * Get available backtest engines from contributions API
   */
  getAvailableEngines() {
    return this.contributions?.getEngines?.() || [];
  }

  /**
   * Check if contributions API is available
   */
  hasContributionsApi(): boolean {
    return this.contributions !== null;
  }

  stop(): void {
    this.engine.stop();
    this.context.log.info('Backtest stopped');
  }

  isRunning(): boolean {
    return this.engine.isRunning();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  getConfig(): BacktestConfig {
    return this.engine.getConfig();
  }

  setConfig(config: Partial<BacktestConfig>): void {
    this.engine.setConfig(config);
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  onProgress(handler: (event: BacktestEvent) => void): () => void {
    return this.engine.onEvent(handler);
  }

  // ===========================================================================
  // Results
  // ===========================================================================

  getLastResult(): BacktestResult | null {
    return this.lastResult;
  }

  getResults(): BacktestResult[] {
    return [...this.results];
  }

  clearResults(): void {
    this.results = [];
    this.lastResult = null;
  }

  async exportResults(resultId: string, format: 'json' | 'csv'): Promise<string> {
    // Find result by index or use last
    const result = resultId === 'last'
      ? this.lastResult
      : this.results[parseInt(resultId, 10)];

    if (!result) {
      throw new Error(i18n.t('errors.resultNotFound', { ns: 'backtest' }));
    }

    if (format === 'json') {
      return JSON.stringify(result, null, 2);
    }

    // CSV format - export trades
    const headers = ['Date', 'Symbol', 'Side', 'Quantity', 'Price', 'Commission', 'P&L', 'P&L %'];
    const rows = result.trades.map(t => [
      new Date(t.timestamp).toISOString(),
      t.symbol,
      t.side,
      t.quantity.toString(),
      t.price.toFixed(4),
      t.commission.toFixed(4),
      (t.pnl || 0).toFixed(2),
      (t.pnlPercent || 0).toFixed(2),
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async fetchData(request: BacktestRequest): Promise<OHLCVSeries | null> {
    // TICKET_136: Use IPC to ensure data is available
    const api = (globalThis as any).window?.electronAPI;

    if (api?.data?.ensure) {
      try {
        this.context.log.info(`Fetching data via IPC: ${request.symbol}`);

        const ensureResult = await api.data.ensure({
          symbol: request.symbol,
          startDate: request.startDate,
          endDate: request.endDate,
          interval: request.interval,
        });

        if (!ensureResult.success) {
          this.context.log.error(`Data ensure failed: ${ensureResult.error}`);
          throw new Error(ensureResult.error || i18n.t('errors.fetchDataFailed', { ns: 'backtest' }));
        }

        this.context.log.info(`Data ready: ${ensureResult.coverage?.totalBars || 0} bars`);

        // For V3 architecture: return data path for Executor
        // The actual data loading will be done by the Executor process
        // For now, return a placeholder that indicates data is ready
        return {
          symbol: request.symbol,
          interval: request.interval,
          data: [],
          start: new Date(request.startDate).getTime(),
          end: new Date(request.endDate).getTime(),
          source: ensureResult.source || 'ipc',
          // V3: dataPath would be used by Executor
          dataPath: ensureResult.dataPath,
        } as OHLCVSeries;
      } catch (error) {
        this.context.log.error(`Data fetch failed: ${error}`);
        throw error;
      }
    }

    // Fallback to data plugin if available
    if (this.dataPlugin) {
      const response = await this.dataPlugin.fetchHistoricalData({
        symbol: request.symbol,
        interval: request.interval,
        start: request.startDate,
        end: request.endDate,
      });
      return response.success ? response.data ?? null : null;
    }

    // No data source available
    this.context.log.error('No data source available (IPC or plugin)');
    throw new Error(i18n.t('notification.noDataSource', { ns: 'backtest' }));
  }

  private generateMockData(request: BacktestRequest): OHLCVSeries {
    const startDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);
    const bars: OHLCVSeries['data'] = [];

    let price = 100;
    const msPerDay = 24 * 60 * 60 * 1000;

    for (let date = startDate.getTime(); date <= endDate.getTime(); date += msPerDay) {
      // Skip weekends
      const dayOfWeek = new Date(date).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      // Random walk
      const change = (Math.random() - 0.5) * 0.04; // +/- 2%
      const open = price;
      price = price * (1 + change);
      const close = price;
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);
      const volume = Math.floor(1000000 + Math.random() * 1000000);

      bars.push({
        timestamp: date,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return {
      symbol: request.symbol,
      interval: request.interval,
      data: bars,
      start: bars[0]?.timestamp || 0,
      end: bars[bars.length - 1]?.timestamp || 0,
      source: 'mock',
    };
  }

  private registerCommands(): void {
    this.context.commands.register('backtest.run', async (
      strategyId: any,
      symbol: any,
      startDate: any,
      endDate: any
    ) => {
      return this.run({
        strategyId,
        symbol,
        interval: INTERVAL_1d,
        startDate,
        endDate,
      });
    });

    this.context.commands.register('backtest.stop', () => {
      this.stop();
    });

    this.context.commands.register('backtest.clear', () => {
      this.clearResults();
      this.context.ui.showNotification(i18n.t('notification.resultsCleared', { ns: 'backtest' }), 'info');
    });

    this.context.commands.register('backtest.export', async (format: any = 'json') => {
      if (!this.lastResult) {
        throw new Error(i18n.t('notification.noResultsToExport', { ns: 'backtest' }));
      }
      return this.exportResults('last', format);
    });

    this.context.commands.register('backtest.optimize', async (
      strategyId: any,
      symbol: any,
      startDate: any,
      endDate: any,
      paramRanges: any
    ) => {
      const request: BacktestRequest = {
        strategyId,
        symbol,
        interval: INTERVAL_1d,
        startDate,
        endDate,
      };

      const data = await this.fetchData(request);
      if (!data) {
        throw new Error(i18n.t('errors.fetchDataFailed', { ns: 'backtest' }));
      }

      return this.engine.optimize(request, data, paramRanges);
    });
  }

  /**
   * Set data plugin reference (called by plugin manager)
   */
  setDataPlugin(dataPlugin: DataSourcePlugin): void {
    this.dataPlugin = dataPlugin;
  }
}

// =============================================================================
// Plugin Module Export
// =============================================================================

const plugin: PluginModule = {
  async activate(context: PluginContext): Promise<PluginApi> {
    // Get config from context or use defaults
    const config: Partial<BacktestConfig> = {
      initialCapital: DEFAULT_INITIAL_CAPITAL,
      commission: DEFAULT_COMMISSION_RATE,
      slippage: 0.0001,
    };

    const backtestPlugin = new BacktestPluginImpl(context, config);
    await backtestPlugin.activate();

    return backtestPlugin;
  },

  async deactivate(): Promise<void> {
    // Cleanup handled by BacktestPluginImpl.deactivate()
  },
};

export default plugin;

// Re-export types and components
export * from './types';
export { BacktestEngine, DEFAULT_CONFIG } from './engine/engine';
export { PortfolioManager } from './engine/portfolio';
export { StrategyExecutor, builtInStrategies, getStrategy } from './engine/executor';
export { MetricsCalculator } from './engine/metrics';
