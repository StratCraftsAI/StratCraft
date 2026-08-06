"use strict";
/**
 * Strategy Builder Nexus - onUninstall Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 *
 * Cleans up strategy storage.
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
exports.default = onUninstall;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
async function onUninstall(context) {
    const { storagePath, keepUserData, log } = context;
    // Always clean generated code (can be regenerated)
    const generatedDir = path.join(storagePath, 'generated');
    try {
        await fs.rm(generatedDir, { recursive: true, force: true });
        log.info('Generated code cleaned');
    }
    catch (error) {
        log.warn(`Failed to clean generated code: ${error}`);
    }
    // Always clean templates (bundled with plugin)
    const templatesDir = path.join(storagePath, 'templates');
    try {
        await fs.rm(templatesDir, { recursive: true, force: true });
        log.info('Templates cleaned');
    }
    catch (error) {
        log.warn(`Failed to clean templates: ${error}`);
    }
    if (!keepUserData) {
        // Remove database
        const dbPath = path.join(storagePath, 'strategies.db');
        try {
            await fs.rm(dbPath, { force: true });
            await fs.rm(`${dbPath}-wal`, { force: true });
            await fs.rm(`${dbPath}-shm`, { force: true });
            log.info('Database removed');
        }
        catch (error) {
            log.warn(`Failed to remove database: ${error}`);
        }
        // Remove strategies
        const strategiesDir = path.join(storagePath, 'strategies');
        try {
            await fs.rm(strategiesDir, { recursive: true, force: true });
            log.info('Strategies removed');
        }
        catch (error) {
            log.warn(`Failed to remove strategies: ${error}`);
        }
        // Remove exports
        const exportsDir = path.join(storagePath, 'exports');
        try {
            await fs.rm(exportsDir, { recursive: true, force: true });
            log.info('Exports removed');
        }
        catch (error) {
            log.warn(`Failed to remove exports: ${error}`);
        }
        // Remove backups
        const backupsDir = path.join(storagePath, 'backups');
        try {
            await fs.rm(backupsDir, { recursive: true, force: true });
            log.info('Backups removed');
        }
        catch (error) {
            log.warn(`Failed to remove backups: ${error}`);
        }
        // Remove config
        const configPath = path.join(storagePath, 'config.json');
        try {
            await fs.rm(configPath, { force: true });
            log.info('Configuration removed');
        }
        catch (error) {
            log.warn(`Failed to remove config: ${error}`);
        }
        log.info('All user data removed');
    }
    else {
        log.info('User strategies preserved at: ' + storagePath);
    }
    log.info('Strategy Builder Nexus uninstall complete');
}
