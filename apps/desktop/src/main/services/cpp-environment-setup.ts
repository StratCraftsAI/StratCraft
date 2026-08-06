/**
 * C++ Environment Setup Service
 *
 * NONABT_TICKET_010_3 Phase 4A: Lazy setup - extract bundled toolchain archive,
 * verify critical files, run smoke test.
 *
 * Triggered on first C++ strategy execution (not app startup).
 * If setup fails, non-C++ features remain fully usable.
 */

import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import { getCompilerResolver } from './compiler-resolver';
import {
  CPP_SMOKE_TEST_TIMEOUT_MS,
  TOOLCHAIN_EXTRACT_TIMEOUT_MS,
  CLI_PROBE_TIMEOUT_MS,
} from '../../shared/constants/timing';

const log = createLogger('CppSetup');

// =============================================================================
// Types
// =============================================================================

export interface SetupResult {
  success: boolean;
  error?: string;
  skipped: boolean;  // True if already set up
  smokeTestPassed?: boolean;
}

interface ToolchainManifest {
  version: string;
  platform: string;
  extractedAt: string;
  fileCount: number;
}

// =============================================================================
// Constants
// =============================================================================

const MARKER_FILE = '.extracted';
const MANIFEST_FILE = 'toolchain-manifest.json';

// Minimal C++23 smoke test source
const SMOKE_TEST_SOURCE = `#include <cstdlib>
int main() { return EXIT_SUCCESS; }
`;

// Critical files that must exist after extraction (platform-adjusted at runtime)
const CRITICAL_FILES_UNIX = [
  'bin/clang++',
  'bin/lld',
];

const CRITICAL_FILES_WINDOWS = [
  'bin/clang++.exe',
  'bin/lld.exe',
];

const CRITICAL_DIRS = [
  'lib',
];

// =============================================================================
// Service
// =============================================================================

export class CppEnvironmentSetupService {
  /**
   * Idempotent: extract if needed, verify, smoke test.
   * Returns immediately if already set up.
   */
  async ensureReady(): Promise<SetupResult> {
    const resolver = getCompilerResolver();
    const status = resolver.resolve();

    // Already available (bundled extracted or system compiler)
    if (status.available) {
      log.info('Toolchain already available, running smoke test');
      const smokeTestPassed = await this.runSmokeTest(status.info!.compiler);
      return { success: true, skipped: true, smokeTestPassed };
    }

    // Not setup-required means no archive to extract
    if (!status.setupRequired) {
      return {
        success: false,
        skipped: false,
        error: status.error || 'No toolchain archive available for extraction',
      };
    }

    // Extract bundled archive
    log.info('Extracting bundled toolchain...');
    try {
      const platformId = resolver.getPlatformId();
      await this.extractToolchain(platformId);

      // Re-resolve after extraction
      resolver.invalidateCache();
      const newStatus = resolver.resolve();

      if (!newStatus.available) {
        return {
          success: false,
          skipped: false,
          error: 'Toolchain extraction completed but verification failed',
        };
      }

      // macOS: check Xcode CommandLineTools
      if (process.platform === 'darwin') {
        this.checkMacOsSdk();
      }

      // Smoke test
      const smokeTestPassed = await this.runSmokeTest(newStatus.info!.compiler);

      return { success: true, skipped: false, smokeTestPassed };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Toolchain setup failed: ${errorMsg}`);
      return { success: false, skipped: false, error: errorMsg };
    }
  }

  /**
   * Check if toolchain marker file exists.
   */
  isExtracted(): boolean {
    const resolver = getCompilerResolver();
    const platformId = resolver.getPlatformId();
    const extractDir = this.getExtractDir(platformId);
    return existsSync(join(extractDir, MARKER_FILE));
  }

  /**
   * Compile a minimal C++23 program to verify toolchain works.
   */
  async runSmokeTest(compilerPath?: string): Promise<boolean> {
    const compiler = compilerPath || this.getDefaultCompiler();
    if (!compiler || !existsSync(compiler)) {
      log.warn('Smoke test skipped: compiler not found');
      return false;
    }

    const tmpDir = join(app.getPath('temp'), 'stratcraft-smoke');
    mkdirSync(tmpDir, { recursive: true });

    const srcPath = join(tmpDir, 'smoke.cpp');
    const outPath = join(tmpDir, `stratcraft_smoke${process.platform === 'win32' ? '.exe' : ''}`);

    writeFileSync(srcPath, SMOKE_TEST_SOURCE, 'utf-8');

    try {
      execSync(`"${compiler}" -std=c++23 -o "${outPath}" "${srcPath}"`, {
        encoding: 'utf-8',
        timeout: CPP_SMOKE_TEST_TIMEOUT_MS,
      });

      const passed = existsSync(outPath);
      if (passed) {
        log.info('Smoke test passed');
        // Cleanup
        try { unlinkSync(outPath); } catch { /* ignore */ }
        try { unlinkSync(srcPath); } catch { /* ignore */ }
      } else {
        log.warn('Smoke test: compilation produced no output');
      }
      return passed;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Smoke test failed: ${errorMsg}`);
      return false;
    }
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private getExtractDir(platformId: string): string {
    return join(app.getPath('userData'), 'toolchain', platformId);
  }

  private getArchivePath(platformId: string): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'toolchain', `${platformId}.tar.gz`);
    }
    return join(app.getAppPath(), '..', '..', 'resources', 'toolchain', `${platformId}.tar.gz`);
  }

  private async extractToolchain(platformId: string): Promise<void> {
    const archivePath = this.getArchivePath(platformId);
    if (!existsSync(archivePath)) {
      throw new Error(`Toolchain archive not found: ${archivePath}`);
    }

    const extractDir = this.getExtractDir(platformId);
    mkdirSync(extractDir, { recursive: true });

    // Extract using tar (available on all supported platforms)
    log.info(`Extracting ${archivePath} to ${extractDir}`);
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
      encoding: 'utf-8',
      timeout: TOOLCHAIN_EXTRACT_TIMEOUT_MS,
    });

    // Verify critical files
    this.verifyCriticalFiles(extractDir);

    // Write manifest
    const fileCount = this.countFiles(extractDir);
    const manifest: ToolchainManifest = {
      version: '1.0.0',
      platform: platformId,
      extractedAt: new Date().toISOString(),
      fileCount,
    };
    writeFileSync(join(extractDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');

    // Write marker file
    writeFileSync(join(extractDir, MARKER_FILE), manifest.version, 'utf-8');

    log.info(`Toolchain extracted: ${fileCount} files`);
  }

  private verifyCriticalFiles(extractDir: string): void {
    const criticalFiles = process.platform === 'win32'
      ? CRITICAL_FILES_WINDOWS
      : CRITICAL_FILES_UNIX;

    for (const file of criticalFiles) {
      const filePath = join(extractDir, file);
      if (!existsSync(filePath)) {
        throw new Error(`Critical file missing after extraction: ${file}`);
      }
    }

    for (const dir of CRITICAL_DIRS) {
      const dirPath = join(extractDir, dir);
      if (!existsSync(dirPath)) {
        throw new Error(`Critical directory missing after extraction: ${dir}`);
      }
    }
  }

  private countFiles(dir: string): number {
    let count = 0;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          count++;
        } else if (entry.isDirectory() && entry.name !== '.' && entry.name !== '..') {
          count += this.countFiles(join(dir, entry.name));
        }
      }
    } catch { /* ignore */ }
    return count;
  }

  private checkMacOsSdk(): void {
    try {
      const sdkPath = execSync('xcrun --show-sdk-path', {
        encoding: 'utf-8',
        timeout: CLI_PROBE_TIMEOUT_MS,
      }).trim();
      log.info(`macOS SDK found: ${sdkPath}`);
    } catch {
      log.warn('macOS Xcode CommandLineTools not detected. C++ compilation may fail. Install with: xcode-select --install');
    }
  }

  private getDefaultCompiler(): string | null {
    try {
      const resolver = getCompilerResolver();
      const status = resolver.resolve();
      return status.info?.compiler || null;
    } catch {
      return null;
    }
  }
}
