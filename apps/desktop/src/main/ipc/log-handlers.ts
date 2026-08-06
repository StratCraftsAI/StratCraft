/**
 * Log IPC Handlers
 *
 * Receives log messages from renderer process and writes to file
 */

import { ipcMain } from 'electron';
import log from '../utils/logger';

export function registerLogHandlers(): void {
  // Handle log messages from renderer
  ipcMain.on('log', (_event, level: string, category: string, message: string, ...args: unknown[]) => {
    const prefix = `[Renderer][${category}]`;
    const formattedMessage = args.length > 0
      ? `${message} ${JSON.stringify(args)}`
      : message;

    switch (level) {
      case 'debug':
        log.debug(prefix, formattedMessage);
        break;
      case 'info':
        log.info(prefix, formattedMessage);
        break;
      case 'warn':
        log.warn(prefix, formattedMessage);
        break;
      case 'error':
        log.error(prefix, formattedMessage);
        break;
      default:
        log.info(prefix, formattedMessage);
    }
  });

  log.info('[IPC] Log handlers registered');
}
