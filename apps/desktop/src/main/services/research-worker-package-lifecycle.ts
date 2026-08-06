/**
 * Atomic lifecycle owner for the signed Quant Lab research package.
 *
 * Marketplace supplies an already extracted package directory. This service
 * verifies it in an isolated installation root, runs the signed health command,
 * installs an immutable version, and changes active.json only as the final
 * atomic step.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  researchWorkerPackageManifestSchema,
  type ResearchWorkerPackageManifest,
} from '@StratCraft/types';
import {
  RESEARCH_WORKER_ACTIVE_POINTER_FILE,
  RESEARCH_WORKER_DEFAULT_MANIFEST_FILE,
} from '../constants/research-worker';
import { createLogger } from '../utils/logger';
import {
  ResearchWorkerPackageVerifier,
  type VerifiedResearchWorkerPackage,
} from './research-worker-package';
import {
  getResearchWorkerSupervisor,
  type ResearchWorkerSupervisor,
} from './research-worker-supervisor';
import { getCommercialOperationRuntimeIfInitialized } from './commercial-operation-runtime';
import { resolveResearchWorkerPackagePaths } from './research-worker-install-root';

const log = createLogger('RESEARCH-WORKER-LIFECYCLE');
const VERSION_DIRECTORY = 'versions';
const HEALTH_OUTPUT_LIMIT_BYTES = 65_536;

interface ActivePackagePointer {
  readonly schemaVersion: 1;
  readonly versionDirectory: string;
  readonly manifestRelativePath: string;
}

export interface ResearchWorkerPackageLifecycleOptions {
  readonly installationRoot?: string;
  readonly trustStorePath?: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly supervisor?: Pick<
    ResearchWorkerSupervisor,
    'cancelAll' | 'waitForIdle'
  >;
  readonly runHealthCheck?: (
    verifiedPackage: VerifiedResearchWorkerPackage,
  ) => Promise<void>;
  readonly newId?: () => string;
  readonly commercialRuntime?: {
    readonly refreshActivePackage: () => Promise<boolean>;
    readonly deactivate: () => Promise<boolean>;
  } | null;
}

function activePointer(version: string): ActivePackagePointer {
  return {
    schemaVersion: 1,
    versionDirectory: `${VERSION_DIRECTORY}/${version}`,
    manifestRelativePath: RESEARCH_WORKER_DEFAULT_MANIFEST_FILE,
  };
}

async function readManifest(packageRoot: string): Promise<ResearchWorkerPackageManifest> {
  const manifestPath = path.join(packageRoot, RESEARCH_WORKER_DEFAULT_MANIFEST_FILE);
  const input = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
  return researchWorkerPackageManifestSchema.parse(input);
}

async function runHealthCheck(
  verifiedPackage: VerifiedResearchWorkerPackage,
): Promise<void> {
  const command = verifiedPackage.manifest.lifecycle.healthCheckCommand;
  const executableRelativePath = path.relative(
    verifiedPackage.packageRoot,
    verifiedPackage.executablePath,
  ).split(path.sep).join('/');
  if (command[0] !== executableRelativePath) {
    throw new Error(
      'The signed health command must invoke the verified platform executable.',
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(verifiedPackage.executablePath, command.slice(1), {
      cwd: verifiedPackage.packageRoot,
      env: {
        ...process.env,
        STRATCRAFT_RESEARCH_PACKAGE_MANIFEST_SHA256:
          verifiedPackage.manifestSha256,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const appendBounded = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> =>
      Buffer.concat([current, chunk]).subarray(0, HEALTH_OUTPUT_LIMIT_BYTES);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(
          `Quant Lab worker health check exited ${code}: `
          + `${stderr.toString('utf8').trim() || '(empty stderr)'}`,
        ));
        return;
      }
      let result: unknown;
      try {
        result = JSON.parse(stdout.toString('utf8'));
      } catch {
        reject(new Error('Quant Lab worker health check emitted invalid JSON.'));
        return;
      }
      if (
        typeof result !== 'object'
        || result === null
        || (result as Record<string, unknown>).status !== 'ok'
        || (result as Record<string, unknown>).workerId !== 'stratcraft-research-worker'
      ) {
        reject(new Error('Quant Lab worker health check returned an invalid identity.'));
        return;
      }
      resolve();
    });
  });
}

export class ResearchWorkerPackageLifecycle {
  private readonly installationRoot: string;
  private readonly trustStorePath: string;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly supervisor?: Pick<
    ResearchWorkerSupervisor,
    'cancelAll' | 'waitForIdle'
  >;
  private readonly healthCheck: (
    verifiedPackage: VerifiedResearchWorkerPackage,
  ) => Promise<void>;
  private readonly newId: () => string;
  private readonly commercialRuntime: ResearchWorkerPackageLifecycleOptions['commercialRuntime'];

  constructor(options: ResearchWorkerPackageLifecycleOptions = {}) {
    const resolvedPaths = resolveResearchWorkerPackagePaths({
      installationRoot: options.installationRoot,
      trustStorePath: options.trustStorePath,
      userDataPath: () => app.getPath('userData'),
      resourcesPath: () => process.resourcesPath,
      applicationPath: () => app.getAppPath(),
      isPackaged: app.isPackaged,
    });
    this.installationRoot = resolvedPaths.installationRoot;
    this.trustStorePath = resolvedPaths.trustStorePath;
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    this.supervisor = options.supervisor;
    this.healthCheck = options.runHealthCheck ?? runHealthCheck;
    this.newId = options.newId ?? randomUUID;
    this.commercialRuntime = options.commercialRuntime;
  }

  async installFromDirectory(sourceRoot: string): Promise<void> {
    const sourceStat = await fs.lstat(sourceRoot);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new Error('The extracted Quant Lab research package must be a regular directory.');
    }
    const manifest = await readManifest(sourceRoot);
    const pointer = activePointer(manifest.packageVersion);
    const stagingParent = path.dirname(this.installationRoot);
    await fs.mkdir(stagingParent, { recursive: true });
    const activePath = path.join(
      this.installationRoot,
      RESEARCH_WORKER_ACTIVE_POINTER_FILE,
    );
    const previousPointer = await fs.readFile(activePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const stagingRoot = await fs.mkdtemp(
      path.join(stagingParent, '.research-worker-stage-'),
    );
    const stagedPackageRoot = path.join(stagingRoot, pointer.versionDirectory);

    await fs.mkdir(path.dirname(stagedPackageRoot), { recursive: true });
    try {
      await fs.cp(sourceRoot, stagedPackageRoot, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      await fs.writeFile(
        path.join(stagingRoot, RESEARCH_WORKER_ACTIVE_POINTER_FILE),
        `${JSON.stringify(pointer, null, 2)}\n`,
        { flag: 'wx' },
      );
      const stagingVerifier = new ResearchWorkerPackageVerifier({
        installationRoot: stagingRoot,
        trustStorePath: this.trustStorePath,
        platform: this.platform,
        architecture: this.architecture,
      });
      const verified = await stagingVerifier.verifyActivePackage();
      if (verified === null) {
        throw new Error('The staged Quant Lab worker did not become discoverable.');
      }
      await this.assertUpgradeAllowed(verified.manifest);
      await this.healthCheck(verified);
      await this.activateVerifiedPackage(verified, pointer);
      try {
        const runtime = this.commercialRuntime === undefined
          ? getCommercialOperationRuntimeIfInitialized()
          : this.commercialRuntime;
        if (runtime !== null && !await runtime.refreshActivePackage()) {
          throw new Error(
            'The installed Quant Lab package did not activate its commercial operation module.',
          );
        }
      } catch (error) {
        await this.restoreActivePointer(activePath, previousPointer);
        await fs.rm(
          path.join(this.installationRoot, pointer.versionDirectory),
          { recursive: true, force: true },
        );
        throw error;
      }
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  }

  async uninstall(): Promise<void> {
    const commercialRuntime = this.commercialRuntime === undefined
      ? getCommercialOperationRuntimeIfInitialized()
      : this.commercialRuntime;
    if (commercialRuntime !== null) await commercialRuntime.deactivate();
    const supervisor = this.supervisor ?? getResearchWorkerSupervisor();
    await supervisor.cancelAll('upgrade');
    await supervisor.waitForIdle();

    const activePath = path.join(
      this.installationRoot,
      RESEARCH_WORKER_ACTIVE_POINTER_FILE,
    );
    await fs.rm(activePath, { force: true });
    await fs.rm(path.join(this.installationRoot, VERSION_DIRECTORY), {
      recursive: true,
      force: true,
    });
    try {
      await fs.rmdir(this.installationRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
        && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') {
        throw error;
      }
    }
    log.info('Quant Lab research package uninstalled; worker discovery is absent');
  }

  private async restoreActivePointer(
    activePath: string,
    previousPointer: Buffer | null,
  ): Promise<void> {
    if (previousPointer === null) {
      await fs.rm(activePath, { force: true });
      return;
    }
    const rollbackPath = `${activePath}.rollback-${this.newId()}`;
    try {
      await fs.writeFile(rollbackPath, previousPointer, { flag: 'wx' });
      await fs.rename(rollbackPath, activePath);
    } finally {
      await fs.rm(rollbackPath, { force: true });
    }
  }

  private async assertUpgradeAllowed(
    incoming: ResearchWorkerPackageManifest,
  ): Promise<void> {
    const verifier = new ResearchWorkerPackageVerifier({
      installationRoot: this.installationRoot,
      trustStorePath: this.trustStorePath,
      platform: this.platform,
      architecture: this.architecture,
    });
    const current = await verifier.verifyActivePackage();
    if (
      current !== null
      && current.manifest.packageVersion !== incoming.packageVersion
      && !incoming.upgradesFrom.includes(current.manifest.packageVersion)
    ) {
      throw new Error(
        `Quant Lab ${incoming.packageVersion} does not support upgrade from `
        + `${current.manifest.packageVersion}.`,
      );
    }
  }

  private async activateVerifiedPackage(
    verified: VerifiedResearchWorkerPackage,
    pointer: ActivePackagePointer,
  ): Promise<void> {
    await fs.mkdir(
      path.join(this.installationRoot, VERSION_DIRECTORY),
      { recursive: true },
    );
    const finalPackageRoot = path.join(
      this.installationRoot,
      pointer.versionDirectory,
    );
    const finalPackageTemp = `${finalPackageRoot}.installing-${this.newId()}`;
    const pointerTemp = path.join(
      this.installationRoot,
      `${RESEARCH_WORKER_ACTIVE_POINTER_FILE}.installing-${this.newId()}`,
    );
    try {
      try {
        await fs.access(finalPackageRoot);
        throw new Error(
          `Immutable Quant Lab version ${verified.manifest.packageVersion} already exists.`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await fs.cp(verified.packageRoot, finalPackageTemp, {
          recursive: true,
          dereference: false,
          errorOnExist: true,
          force: false,
        });
        await fs.rename(finalPackageTemp, finalPackageRoot);
      }
      await fs.writeFile(pointerTemp, `${JSON.stringify(pointer, null, 2)}\n`, {
        flag: 'wx',
      });
      await fs.rename(
        pointerTemp,
        path.join(this.installationRoot, RESEARCH_WORKER_ACTIVE_POINTER_FILE),
      );
      log.info(
        'Activated Quant Lab research package %s (%s)',
        verified.manifest.packageVersion,
        verified.manifestSha256,
      );
    } finally {
      await fs.rm(finalPackageTemp, { recursive: true, force: true });
      await fs.rm(pointerTemp, { force: true });
    }
  }
}

let lifecycle: ResearchWorkerPackageLifecycle | null = null;

export function getResearchWorkerPackageLifecycle(): ResearchWorkerPackageLifecycle {
  lifecycle ??= new ResearchWorkerPackageLifecycle();
  return lifecycle;
}
