"use strict";
/**
 * Strategy Builder Nexus - onInstall Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 *
 * Initializes strategy storage:
 * - Create strategy directories
 * - Initialize SQLite database for strategy metadata
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
    progress.report(0, 'Creating strategy directories...');
    // Create directories
    const dirs = [
        'strategies', // User strategies
        'templates', // Strategy templates
        'exports', // Exported strategies
        'backups', // Strategy backups
        'generated', // AI-generated code
    ];
    for (const dir of dirs) {
        await fs.mkdir(path.join(storagePath, dir), { recursive: true });
    }
    log.info('Strategy directories created');
    progress.report(30, 'Initializing database...');
    // Initialize SQLite database using Database Protocol
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
            // Strategy definitions
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS strategies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          regime_id TEXT,
          code TEXT,
          parameters TEXT,
          tags TEXT DEFAULT '[]',
          version INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )
      `);
            // Strategy groups (folders)
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS strategy_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          parent_id TEXT,
          icon TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (parent_id) REFERENCES strategy_groups(id)
        )
      `);
            // Strategy-to-group mapping
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS strategy_group_members (
          strategy_id TEXT NOT NULL,
          group_id TEXT NOT NULL,
          added_at INTEGER DEFAULT (unixepoch()),
          PRIMARY KEY (strategy_id, group_id),
          FOREIGN KEY (strategy_id) REFERENCES strategies(id),
          FOREIGN KEY (group_id) REFERENCES strategy_groups(id)
        )
      `);
            // Strategy execution history
            await tx.execute(`
        CREATE TABLE IF NOT EXISTS execution_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          strategy_id TEXT NOT NULL,
          execution_type TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          status TEXT NOT NULL,
          result TEXT,
          FOREIGN KEY (strategy_id) REFERENCES strategies(id)
        )
      `);
            // Create indexes
            await tx.execute('CREATE INDEX IF NOT EXISTS idx_strategies_regime ON strategies(regime_id)');
            await tx.execute('CREATE INDEX IF NOT EXISTS idx_strategies_type ON strategies(type)');
            await tx.execute('CREATE INDEX IF NOT EXISTS idx_groups_parent ON strategy_groups(parent_id)');
            await tx.execute('CREATE INDEX IF NOT EXISTS idx_execution_strategy ON execution_history(strategy_id)');
        });
        log.info('Database initialized successfully');
    }
    catch (error) {
        log.error(`Database initialization failed: ${error}`);
        throw error;
    }
    progress.report(70, 'Creating default templates...');
    // Create default strategy templates
    const templates = [
        {
            id: 'regime-basic',
            name: 'Basic Regime Strategy',
            description: 'A simple regime-based trading strategy template',
            code: `// Basic Regime Strategy Template
class BasicRegimeStrategy {
  constructor(params) {
    this.params = params;
  }

  onBar(bar, regime) {
    // Implement your logic here
    if (regime === 'bullish') {
      return { action: 'buy', size: 1 };
    } else if (regime === 'bearish') {
      return { action: 'sell', size: 1 };
    }
    return { action: 'hold' };
  }
}

module.exports = BasicRegimeStrategy;
`,
        },
        {
            id: 'indicator-based',
            name: 'Indicator-Based Strategy',
            description: 'Strategy template using technical indicators',
            code: `// Indicator-Based Strategy Template
class IndicatorStrategy {
  constructor(params) {
    this.params = params;
    this.smaShort = params.smaShort || 10;
    this.smaLong = params.smaLong || 20;
  }

  onBar(bar, indicators) {
    const { sma } = indicators;

    if (sma[this.smaShort] > sma[this.smaLong]) {
      return { action: 'buy', size: 1 };
    } else if (sma[this.smaShort] < sma[this.smaLong]) {
      return { action: 'sell', size: 1 };
    }
    return { action: 'hold' };
  }
}

module.exports = IndicatorStrategy;
`,
        },
    ];
    const templatesDir = path.join(storagePath, 'templates');
    for (const template of templates) {
        const templatePath = path.join(templatesDir, `${template.id}.json`);
        await fs.writeFile(templatePath, JSON.stringify(template, null, 2));
    }
    log.info('Default templates created');
    progress.report(90, 'Creating configuration...');
    // Create default configuration
    const defaultConfig = {
        version: 1,
        editorSettings: {
            theme: 'dark',
            fontSize: 14,
            tabSize: 2,
            autoSave: true,
            autoSaveDelayMs: 5000,
        },
        aiSettings: {
            enabled: true,
            model: 'default',
            maxTokens: 2048,
        },
    };
    const configPath = path.join(storagePath, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    progress.report(100, 'Installation complete');
    log.info('Strategy Builder Nexus installed successfully');
}
