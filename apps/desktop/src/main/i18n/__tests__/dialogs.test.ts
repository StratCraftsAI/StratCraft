/**
 * Unit tests for dialog localization helper
 * TICKET_786_6 Phase 5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { loadDialogStrings, clearDialogCache } from '../dialogs';
import { app } from 'electron';

vi.mock('electron', () => ({
  app: {
    getAppPath: ((initialValue) => vi.fn(() => initialValue))('/app')
  }
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

describe('loadDialogStrings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDialogCache();
  });

  it('should load bundle for known locale', () => {
    const mockBundle = { pluginInstall: { title: 'Test Title' } };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockBundle));

    const result = loadDialogStrings('en_US');
    expect(result).toEqual(mockBundle);
    expect(fs.readFileSync).toHaveBeenCalled();
  });

  it('should fall back to en_US when locale file is missing', () => {
    const enBundle = { pluginInstall: { title: 'En Title' } };
    
    // First call for zh_CN (missing)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => path.includes('en_US'));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(enBundle));

    const result = loadDialogStrings('zh_CN');
    expect(result).toEqual(enBundle);
  });

  it('should fall back to en_US when locale file is unparseable', () => {
    const enBundle = { pluginInstall: { title: 'En Title' } };
    
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.includes('zh_CN')) return 'invalid json';
      return JSON.stringify(enBundle);
    });

    const result = loadDialogStrings('zh_CN');
    expect(result).toEqual(enBundle);
  });

  it('should use cache on second call for the same locale', () => {
    const mockBundle = { pluginInstall: { title: 'Cached Title' } };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockBundle));

    // First call
    loadDialogStrings('ja_JP');
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);

    // Second call
    const result = loadDialogStrings('ja_JP');
    expect(result).toEqual(mockBundle);
    expect(fs.readFileSync).toHaveBeenCalledTimes(1); // Still 1 due to cache
  });
});
