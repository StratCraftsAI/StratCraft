/**
 * usePluginInstall Type & Contract Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests type shapes for plugin install flow types.
 */

import { describe, it, expect } from 'vitest';
import type {
  InstallPhase,
  InstallProgress,
  InstallState,
  UsePluginInstallResult,
} from '../usePluginInstall';

// =============================================================================
// Type Shape Validation
// =============================================================================

describe('usePluginInstall types', () => {
  describe('InstallPhase', () => {
    it('should accept all valid phases', () => {
      const phases: InstallPhase[] = [
        'idle', 'previewing', 'consent', 'installing', 'complete', 'error',
      ];
      expect(phases).toHaveLength(6);
    });
  });

  describe('InstallProgress', () => {
    it('should have required fields', () => {
      const progress: InstallProgress = {
        pluginId: 'com.test.plugin',
        phase: 'downloading',
        progress: 50,
        message: 'Downloading plugin...',
      };
      expect(progress.pluginId).toBe('com.test.plugin');
      expect(progress.progress).toBe(50);
    });
  });

  describe('InstallState', () => {
    it('should accept idle state', () => {
      const state: InstallState = {
        phase: 'idle',
        preview: null,
        packagePath: null,
        progress: null,
        error: null,
      };
      expect(state.phase).toBe('idle');
    });

    it('should accept error state', () => {
      const state: InstallState = {
        phase: 'error',
        preview: null,
        packagePath: '/tmp/plugin.tar.gz',
        progress: null,
        error: 'Installation failed: signature mismatch',
      };
      expect(state.phase).toBe('error');
      expect(state.error).toBeTruthy();
    });

    it('should accept installing state with progress', () => {
      const state: InstallState = {
        phase: 'installing',
        preview: null,
        packagePath: '/tmp/plugin.tar.gz',
        progress: {
          pluginId: 'com.test',
          phase: 'extracting',
          progress: 75,
          message: 'Extracting files...',
        },
        error: null,
      };
      expect(state.progress?.progress).toBe(75);
    });
  });

  describe('UsePluginInstallResult', () => {
    it('should define expected hook return shape', () => {
      const result: UsePluginInstallResult = {
        state: {
          phase: 'idle',
          preview: null,
          packagePath: null,
          progress: null,
          error: null,
        },
        startInstall: async () => {},
        confirmInstall: async () => {},
        cancelInstall: () => {},
        reset: () => {},
      };
      expect(typeof result.startInstall).toBe('function');
      expect(typeof result.confirmInstall).toBe('function');
      expect(typeof result.cancelInstall).toBe('function');
      expect(typeof result.reset).toBe('function');
    });
  });
});
