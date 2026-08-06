/**
 * useImportPackage - BYOD imported-package list management
 *
 * TICKET_918_1: the SQL database import (importPackage / copySeries) was
 * removed as dead code. This hook now only manages the imported-package
 * catalog: list, remove, health-check.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ImportAdjustMode } from '../../../../shared/constants/data-import';

export type { ImportAdjustMode };

export interface ImportedPackageInfo {
  packageName: string;
  adjustMode: ImportAdjustMode;
  sourceDialect: string;
  createdAt: number;
}

export function useImportPackage() {
  const [packages, setPackages] = useState<ImportedPackageInfo[]>([]);

  const loadPackages = useCallback(async () => {
    try {
      const result = await window.electronAPI.data.listImportedPackages();
      setPackages(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error('[E:IMPORT:LOAD_PACKAGES_FAILED] Failed to load imported packages:', err);
    }
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const removePackage = useCallback(async (packageName: string): Promise<boolean> => {
    try {
      await window.electronAPI.data.removeImportedPackage(packageName);
      await loadPackages();
      return true;
    } catch (err) {
      console.error('[E:IMPORT:REMOVE_PACKAGE_FAILED] Failed to remove package:', err);
      return false;
    }
  }, [loadPackages]);

  const checkPackageHealth = useCallback(async (packageName: string) => {
    try {
      return await window.electronAPI.data.checkImportedPackageHealth(packageName) as Array<{
        symbol: string;
        interval: string;
        filePath: string;
        exists: boolean;
      }>;
    } catch (err) {
      console.error('[E:IMPORT:CHECK_HEALTH_FAILED] Failed to check package health:', err);
      return null;
    }
  }, []);

  return {
    packages,
    removePackage,
    checkPackageHealth,
    refreshPackages: loadPackages,
  };
}
