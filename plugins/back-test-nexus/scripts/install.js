"use strict";
/**
 * Backtest Nexus - onInstall Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 * TICKET_690: Removed Python venv/pip/backtrader setup (C++ only pipeline)
 *
 * Sets up storage directories and initializes database schema:
 * - Create directories for results, logs, cache
 * - Initialize SQLite tables (backtest_runs, backtest_results, trades)
 *
 * Full type definition: apps/desktop/src/shared/types/plugin-lifecycle.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = onInstall;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
async function onInstall(context) {
    const { storagePath, log, progress } = context;
    progress.report(0, 'Creating backtest directories...');
    // Create directories
    const dirs = [
        'results', // Backtest results
        'logs', // Engine logs
        'cache', // Data cache
    ];
    for (const dir of dirs) {
        await fs.mkdir(path.join(storagePath, dir), { recursive: true });
    }
    log.info('Backtest directories created');
    progress.report(30, 'Creating configuration...');
    // Create default configuration
    const defaultConfig = {
        version: 1,
        engineSettings: {
            maxConcurrentBacktests: 2,
        },
        resultSettings: {
            keepLastN: 50,
            autoExport: false,
            exportFormat: 'json',
        },
    };
    const configPath = path.join(storagePath, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    progress.report(50, 'Initializing database...');
    // Initialize results database using Database Protocol
    try {
        const { database } = context;
        // Create schema version table
        await database.execute(`
      CREATE TABLE IF NOT EXISTS _plugin_schema (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
        // Initialize schema version
        await database.execute("INSERT OR IGNORE INTO _plugin_schema (key, value) VALUES ('version', '1')");
        // Create tables in a transaction
        await database.transaction(async (tx) => {
            // Backtest runs
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
          id TEXT PRIMARY KEY,
          name TEXT,
          strategy_id TEXT,
          engine TEXT NOT NULL,
          config TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          status TEXT NOT NULL,
          error TEXT
        )
      `);
            // Backtest results
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS backtest_results (
          run_id TEXT PRIMARY KEY,
          total_return REAL,
          sharpe_ratio REAL,
          max_drawdown REAL,
          win_rate REAL,
          total_trades INTEGER,
          metrics TEXT,
          equity_curve TEXT,
          FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
        )
      `);
            // Trade history
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          symbol TEXT,
          direction TEXT,
          entry_time INTEGER,
          exit_time INTEGER,
          entry_price REAL,
          exit_price REAL,
          size REAL,
          pnl REAL,
          FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
        )
      `);
            // Create indexes
            await tx.execute('CREATE INDEX IF NOT EXISTS idx_runs_strategy ON backtest_runs(strategy_id)');
            await tx.execute('CREATE INDEX IF NOT EXISTS idx_trades_run ON trades(run_id)');
        });
        log.info('Results database initialized');
    }
    catch (error) {
        log.error(`Database initialization failed: ${error}`);
        throw error;
    }
    progress.report(100, 'Installation complete');
    log.info('Backtest Nexus installed successfully');
}
