/**
 * Main Process Logger (TICKET_573: Production Log & Diagnostics)
 *
 * Uses electron-log for file-based logging with automatic rotation.
 * Log files are stored in platform-specific locations:
 * - Linux: ~/.config/StratCraft/logs/
 * - macOS: ~/Library/Logs/StratCraft/
 * - Windows: %USERPROFILE%\AppData\Roaming\StratCraft\logs\
 *
 * Production enhancements:
 * - JSON structured logging for file transport (production)
 * - Separate error.log for error-only entries
 * - Gzip-compressed log rotation with configurable generations
 * - Environment-aware log levels
 */

import log from 'electron-log/main';
import { app } from 'electron';
import path from 'path';
import { LOG_FILE_MAX_SIZE } from '../../shared/constants/security';
import { rotateAndCompressLogFiles } from './log-rotation';

// =============================================================================
// Configuration
// =============================================================================

// Set log file path
// Development: project/logs/  Production: userData/logs/
log.transports.file.resolvePathFn = () => {
  const logDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(app.getAppPath(), 'logs');
  return path.join(logDir, 'main.log');
};

// =============================================================================
// Phase 1D: JSON Structured Logging (production file transport)
// =============================================================================

interface StructuredLogEntry {
  ts: string;
  level: string;
  category: string;
  msg: string;
  stack?: string;
}

/**
 * Format log message as single-line JSON for machine parsing.
 * Extracts [CATEGORY] prefix from log text if present.
 */
function formatStructuredLog(message: { date: Date; level: string; data: unknown[] }): string {
  const ts = message.date.toISOString();
  const level = message.level;

  // Build text from data array
  const parts = message.data.map(d => {
    if (d instanceof Error) return d.stack || d.message;
    if (typeof d === 'string') return d;
    try { return JSON.stringify(d); } catch { return String(d); }
  });

  const fullText = parts.join(' ');

  // Extract [CATEGORY] prefix if present
  const categoryMatch = fullText.match(/^\[([A-Z_]+)\]\s*/);
  const category = categoryMatch ? categoryMatch[1] : 'GENERAL';
  const msg = categoryMatch ? fullText.slice(categoryMatch[0].length) : fullText;

  const entry: StructuredLogEntry = { ts, level, category, msg };

  // Include stack trace for errors
  for (const d of message.data) {
    if (d instanceof Error && d.stack) {
      entry.stack = d.stack;
      break;
    }
  }

  return JSON.stringify(entry);
}

// File format: JSON in production, text in development
if (app.isPackaged) {
  log.transports.file.format = formatStructuredLog as unknown as string;
} else {
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
}

// Console format: always human-readable text
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

// =============================================================================
// Phase 1A: Environment-Aware Log Levels
// =============================================================================

log.transports.file.level = app.isPackaged ? 'info' : 'debug';
log.transports.console.level = app.isPackaged ? 'warn' : 'debug';

// =============================================================================
// Phase 1B: Log Rotation with Gzip Compression
// =============================================================================

log.transports.file.maxSize = LOG_FILE_MAX_SIZE;
log.transports.file.archiveLogFn = (oldLogFile: { path: string }) => {
  rotateAndCompressLogFiles(oldLogFile.path).catch(() => {
    // Rotation errors are logged inside rotateAndCompressLogFiles
  });
};

// =============================================================================
// Phase 1C: Separate Error Log Transport
// =============================================================================
// electron-log v5: log.create() creates an independent Logger instance with
// its own transports. We configure its file transport for error.log and
// disable its console transport to avoid duplicate console output.

const errorLogger = log.create({ logId: 'error' });
errorLogger.transports.file.level = 'error';
errorLogger.transports.file.maxSize = LOG_FILE_MAX_SIZE;
errorLogger.transports.file.resolvePathFn = () => {
  const logDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(app.getAppPath(), 'logs');
  return path.join(logDir, 'error.log');
};
if (app.isPackaged) {
  errorLogger.transports.file.format = formatStructuredLog as unknown as string;
} else {
  errorLogger.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
}
errorLogger.transports.console.level = false;

// Forward error-level messages from the main logger to errorLogger.
// This hook runs for every transport call on the main logger; we only
// forward once (when processing the 'file' transport) to avoid duplicates.
log.hooks.push((message, _transport, transportName) => {
  if (message.level === 'error' && transportName === 'file') {
    errorLogger.error(...message.data);
  }
  return message;
});

// =============================================================================
// Initialize
// =============================================================================

log.initialize();

// =============================================================================
// Export logger with category support
// =============================================================================

/**
 * Create a scoped logger with a prefix
 */
export function createLogger(category: string) {
  const prefix = `[${category}]`;
  return {
    debug: (message: string, ...args: unknown[]) => log.debug(prefix, message, ...args),
    info: (message: string, ...args: unknown[]) => log.info(prefix, message, ...args),
    warn: (message: string, ...args: unknown[]) => log.warn(prefix, message, ...args),
    error: (message: string, ...args: unknown[]) => log.error(prefix, message, ...args),
  };
}

// Pre-defined loggers for common categories
export const appLog = createLogger('APP');
export const windowLog = createLogger('WINDOW');
export const ipcLog = createLogger('IPC');
export const grpcLog = createLogger('GRPC');
export const healthLog = createLogger('HEALTH');
export const pythonLog = createLogger('PYTHON');
export const cppLog = createLogger('CPP');
export const pluginLog = createLogger('PLUGIN');
export const marketLog = createLogger('MARKET'); // TICKET_051: Plugin Marketplace
export const dbLog = createLogger('DB'); // TICKET_110: Database

// Default export for direct use
export default log;

// =============================================================================
// Utility: Get log file path
// =============================================================================

export function getLogDirectory(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(app.getAppPath(), 'logs');
}

export function getLogFilePath(): string {
  return path.join(getLogDirectory(), 'main.log');
}
