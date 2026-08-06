import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'path';

export interface AppContext {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
  privateBackendRequests: string[];
  privateBackendTripwire: Server;
}

export interface WorkerInstallationOptions {
  trustStorePath: string;
  installationRoot: string;
}

async function startPrivateBackendTripwire(): Promise<{
  server: Server;
  baseUrl: string;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method || 'GET'} ${request.url || '/'}`);
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"error":"private backend contact is forbidden in local E2E"}');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to resolve private backend tripwire address');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

/**
 * Launch the Electron app for E2E testing.
 * Requires a prior `pnpm build` so dist/main/index.js exists.
 */
export async function launchApp(): Promise<AppContext> {
  const desktopAppPath = path.resolve(__dirname, '..');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stratcraft-e2e-'));
  const tripwire = await startPrivateBackendTripwire();

  try {
    const app = await electron.launch({
      args: [
        desktopAppPath,
        `--user-data-dir=${userDataDir}`,
        ...(process.platform === 'linux'
          ? ['--no-sandbox', '--password-store=basic']
          : []),
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP || 'GNOME',
        DESKTOP_API_URL: tripwire.baseUrl,
        STRATCRAFT_DB_PATH: path.join(userDataDir, 'data', 'StratCraft.db'),
        STRATCRAFT_EXECUTOR: path.resolve(
          __dirname,
          '../../../packages/executor/build/StratCraft-executor',
        ),
      },
    });

    const window = await app.firstWindow({ timeout: 90_000 });
    await window.waitForLoadState('domcontentloaded');
    const privacyDecline = window.getByRole('button', { name: 'No Thanks' });
    if (await privacyDecline.isVisible({ timeout: 2000 }).catch(() => false)) {
      await privacyDecline.click();
    }

    return {
      app,
      window,
      userDataDir,
      privateBackendRequests: tripwire.requests,
      privateBackendTripwire: tripwire.server,
    };
  } catch (error) {
    tripwire.server.close();
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Launch the Electron app with a pre-installed signed commercial worker.
 * The lifecycle singleton uses STRATCRAFT_WORKER_INSTALL_ROOT and
 * STRATCRAFT_WORKER_TRUST_STORE env vars so the production code discovers
 * the ephemeral E2E worker package.
 */
export async function launchAppWithWorkerInstallation(
  options: WorkerInstallationOptions,
): Promise<AppContext> {
  const desktopAppPath = path.resolve(__dirname, '..');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'stratcraft-e2e-'));
  const tripwire = await startPrivateBackendTripwire();

  try {
    const app = await electron.launch({
      args: [
        desktopAppPath,
        `--user-data-dir=${userDataDir}`,
        ...(process.platform === 'linux'
          ? ['--no-sandbox', '--password-store=basic']
          : []),
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP || 'GNOME',
        DESKTOP_API_URL: tripwire.baseUrl,
        STRATCRAFT_DB_PATH: path.join(userDataDir, 'data', 'StratCraft.db'),
        STRATCRAFT_EXECUTOR: path.resolve(
          __dirname,
          '../../../packages/executor/build/StratCraft-executor',
        ),
        STRATCRAFT_WORKER_INSTALL_ROOT: options.installationRoot,
        STRATCRAFT_WORKER_TRUST_STORE: options.trustStorePath,
      },
    });

    const window = await app.firstWindow({ timeout: 90_000 });
    await window.waitForLoadState('domcontentloaded');
    const privacyDecline = window.getByRole('button', { name: 'No Thanks' });
    if (await privacyDecline.isVisible({ timeout: 2000 }).catch(() => false)) {
      await privacyDecline.click();
    }

    return {
      app,
      window,
      userDataDir,
      privateBackendRequests: tripwire.requests,
      privateBackendTripwire: tripwire.server,
    };
  } catch (error) {
    tripwire.server.close();
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Close the Electron app and clean up resources.
 */
export async function closeApp(ctx: AppContext): Promise<void> {
  try {
    await ctx.app.close();
  } catch {
    if (ctx.app.process().exitCode === null) {
      ctx.app.process().kill('SIGKILL');
    }
  }
  ctx.privateBackendTripwire.closeAllConnections();
  await new Promise<void>((resolveClose) =>
    ctx.privateBackendTripwire.close(() => resolveClose()));
  rmSync(ctx.userDataDir, { recursive: true, force: true });
}
