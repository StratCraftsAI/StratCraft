/**
 * Archive Utilities
 *
 * Shared zip/archive operations for plugin system.
 * Used by both PluginMarketService and InstallationManager.
 */

import { createLogger } from './logger';

const archiveLog = createLogger('ARCHIVE');

/**
 * Extract a zip file to destination path
 * Falls back to system unzip command if adm-zip is unavailable
 */
export async function extractZip(zipPath: string, destPath: string): Promise<void> {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destPath, true);
    archiveLog.debug('Extracted to:', destPath);
  } catch (error) {
    // Fallback: use unzip command if adm-zip is not available
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    await execAsync(`unzip -o "${zipPath}" -d "${destPath}"`);
    archiveLog.debug('Extracted using unzip command');
  }
}

/**
 * Read file from zip without extracting
 */
export function readFileFromZip(zipPath: string, filePath: string): Buffer | null {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (entry.entryName === filePath || entry.entryName.endsWith('/' + filePath)) {
        return entry.getData();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List files in a zip archive
 */
export function listZipContents(zipPath: string): string[] {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    return zip.getEntries().map((entry: { entryName: string }) => entry.entryName);
  } catch {
    return [];
  }
}
