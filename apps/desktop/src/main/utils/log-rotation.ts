/**
 * Log Rotation with Gzip Compression (TICKET_573)
 *
 * Rotates log files with generation shifting and gzip compression.
 * Called by electron-log's archiveLogFn when a log file reaches maxSize.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { LOG_FILE_MAX_GENERATIONS } from '../../shared/constants/security';
import { appLog } from './logger';

/**
 * Rotate and compress log files.
 *
 * Generation scheme: main.log -> main.1.log.gz -> main.2.log.gz -> ... -> main.N.log.gz
 * Oldest generation beyond maxGenerations is deleted.
 *
 * @param oldLogPath - The current log file path that has reached maxSize
 */
export async function rotateAndCompressLogFiles(oldLogPath: string): Promise<void> {
  const dir = path.dirname(oldLogPath);
  const ext = path.extname(oldLogPath);
  const base = path.basename(oldLogPath, ext);
  const maxGen = LOG_FILE_MAX_GENERATIONS;

  try {
    // Step 1: Delete oldest generation if it exists
    const oldestPath = path.join(dir, `${base}.${maxGen}${ext}.gz`);
    if (fs.existsSync(oldestPath)) {
      fs.unlinkSync(oldestPath);
    }

    // Step 2: Shift existing generations up by 1
    for (let i = maxGen - 1; i >= 1; i--) {
      const src = path.join(dir, `${base}.${i}${ext}.gz`);
      const dst = path.join(dir, `${base}.${i + 1}${ext}.gz`);
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    // Step 3: Compress current log file to generation 1
    const gen1Path = path.join(dir, `${base}.1${ext}.gz`);
    const readStream = fs.createReadStream(oldLogPath);
    const writeStream = fs.createWriteStream(gen1Path);
    const gzip = zlib.createGzip();

    await pipeline(readStream, gzip, writeStream);

    // Step 4: Truncate the original log file
    fs.writeFileSync(oldLogPath, '');

    appLog.info(`Log rotated: ${path.basename(oldLogPath)} -> ${path.basename(gen1Path)}`);
  } catch (error) {
    // Log rotation failure should not crash the application
    const msg = error instanceof Error ? error.message : String(error);
    appLog.error(`Log rotation failed: ${msg}`);
  }
}
