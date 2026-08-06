import { describe, it, expect } from 'vitest';
import { HeadlessBootstrap } from '../../bootstrap';
import * as path from 'path';
import * as os from 'os';

describe('HeadlessBootstrap path resolution', () => {
  it('resolveAppPath returns apps/desktop directory', () => {
    const appPath = HeadlessBootstrap.resolveAppPath();
    expect(appPath).toContain('apps');
    expect(appPath).toContain('desktop');
  });

  it('resolves the resources directory from the same headless application root', () => {
    expect(HeadlessBootstrap.resolveResourcesPath()).toBe(
      path.join(HeadlessBootstrap.resolveAppPath(), 'resources'),
    );
  });

  it('initializes process.resourcesPath before headless service imports', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    try {
      expect(HeadlessBootstrap.initializeProcessResourcesPath()).toBe(
        HeadlessBootstrap.resolveResourcesPath(),
      );
      expect(process.resourcesPath).toBe(HeadlessBootstrap.resolveResourcesPath());
    } finally {
      if (originalDescriptor === undefined) {
        delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      } else {
        Object.defineProperty(process, 'resourcesPath', originalDescriptor);
      }
    }
  });

  it('resolveUserData returns platform-specific path', () => {
    const userData = HeadlessBootstrap.resolveUserData();
    expect(userData).toContain('@StratCraft');
    expect(userData).toContain('desktop');
    if (os.platform() === 'linux') {
      expect(userData).toContain('.config');
    }
  });

  it('resolveDbPath returns a .db path', () => {
    const dbPath = HeadlessBootstrap.resolveDbPath();
    expect(dbPath).toMatch(/\.db$/);
    expect(dbPath).toContain('StratCraft');
  });

  it('leaves the binding unset when no dedicated system-Node binary exists', () => {
    expect(HeadlessBootstrap.resolveSystemNativeBinding(() => false)).toBeUndefined();
  });

  it('resolveAppPath respects STRATCRAFT_APP_PATH env', () => {
    const orig = process.env.STRATCRAFT_APP_PATH;
    try {
      process.env.STRATCRAFT_APP_PATH = '/custom/path';
      expect(HeadlessBootstrap.resolveAppPath()).toBe('/custom/path');
      expect(HeadlessBootstrap.resolveResourcesPath()).toBe('/custom/path/resources');
    } finally {
      if (orig === undefined) delete process.env.STRATCRAFT_APP_PATH;
      else process.env.STRATCRAFT_APP_PATH = orig;
    }
  });

  it('resolveUserData respects STRATCRAFT_USER_DATA env', () => {
    const orig = process.env.STRATCRAFT_USER_DATA;
    try {
      process.env.STRATCRAFT_USER_DATA = '/custom/userdata';
      expect(HeadlessBootstrap.resolveUserData()).toBe('/custom/userdata');
    } finally {
      if (orig === undefined) delete process.env.STRATCRAFT_USER_DATA;
      else process.env.STRATCRAFT_USER_DATA = orig;
    }
  });

  it('resolveDbPath respects STRATCRAFT_DB_PATH env', () => {
    const orig = process.env.STRATCRAFT_DB_PATH;
    try {
      process.env.STRATCRAFT_DB_PATH = '/custom/db.db';
      expect(HeadlessBootstrap.resolveDbPath()).toBe('/custom/db.db');
    } finally {
      if (orig === undefined) delete process.env.STRATCRAFT_DB_PATH;
      else process.env.STRATCRAFT_DB_PATH = orig;
    }
  });
});
