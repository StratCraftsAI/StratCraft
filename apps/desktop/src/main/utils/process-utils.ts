/**
 * Process Utility Functions
 *
 * TICKET_132 Phase 3 (Option 1): Shared utilities for process launchers
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Find python3 executable path
 */
export function findPython3Path(): string | null {
  const candidates = [
    `${process.env.HOME}/miniconda3/bin/python3`,
    `${process.env.HOME}/anaconda3/bin/python3`,
    `${process.env.HOME}/.pyenv/shims/python3`,
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // Try to find via which command
  try {
    const result = execSync('which python3', { encoding: 'utf-8' }).trim();
    if (result && existsSync(result)) {
      return result;
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Check if uv (faster Python launcher) is available
 */
export async function checkUvAvailable(): Promise<boolean> {
  const candidates = [
    '/usr/bin/uv',
    '/usr/local/bin/uv',
    `${process.env.HOME}/.cargo/bin/uv`,
    `${process.env.HOME}/.local/bin/uv`,
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return true;
    }
  }

  return false;
}
