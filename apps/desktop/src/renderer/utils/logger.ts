/**
 * Renderer Process Logger
 *
 * Logs to both browser console and main process (via IPC).
 * Main process writes logs to file for persistence.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Create a scoped logger with a category prefix
 */
export function createLogger(category: string) {
  const prefix = `[${category}]`;

  const log = (level: LogLevel, message: string, ...args: unknown[]) => {
    // Log to browser console
    const consoleMethod = level === 'debug' ? 'log' : level;
    console[consoleMethod](prefix, message, ...args);

    // Send to main process for file logging
    if (window.electronAPI?.log) {
      window.electronAPI.log(level, category, message, ...args);
    }
  };

  return {
    debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => log('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => log('error', message, ...args),
  };
}

// Pre-defined loggers for common categories
export const appLog = createLogger('APP');
export const uiLog = createLogger('UI');
export const storeLog = createLogger('STORE');
export const pluginLog = createLogger('PLUGIN');
export const apiLog = createLogger('API');

// Default logger
const defaultLogger = createLogger('Renderer');
export default defaultLogger;
