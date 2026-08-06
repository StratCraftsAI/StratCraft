/**
 * DistributionService - Runtime Distribution Detection
 *
 * TICKET_631 Phase 4.1 / TICKET_635: Distribution Detection Flag System
 *
 * Detects whether the app is running as public release or full (development) release
 * by reading the "distribution" field from apps/desktop/package.json.
 *
 * Public: package.json contains "distribution": "public" (injected by publish-community.sh)
 * Full: no "distribution" field present, defaults to 'full'
 */

import { app } from 'electron';
import {
  getDistributionInfo,
  type DistributionType,
} from '@StratCraft/app-state-core';
import { appLog } from '../utils/logger';

// =============================================================================
// DistributionService Class
// =============================================================================

class DistributionService {
  private static instance: DistributionService | null = null;

  private readonly distribution: DistributionType;

  private constructor() {
    this.distribution = this.detectDistribution();
    appLog.info(`Distribution detected: ${this.distribution}`);
  }

  static getInstance(): DistributionService {
    if (!DistributionService.instance) {
      DistributionService.instance = new DistributionService();
    }
    return DistributionService.instance;
  }

  /**
   * Reset singleton instance (for testing only)
   */
  static resetInstance(): void {
    DistributionService.instance = null;
  }

  getDistribution(): DistributionType {
    return this.distribution;
  }

  isPublicRelease(): boolean {
    return this.distribution === 'public';
  }

  private detectDistribution(): DistributionType {
    const packageJsonPath = `${app.getAppPath()}/package.json`;
    return getDistributionInfo(
      packageJsonPath,
      (message) => appLog.warn(message),
    ).distribution;
  }
}

// =============================================================================
// Module-level convenience exports
// =============================================================================

export function getDistributionService(): DistributionService {
  return DistributionService.getInstance();
}

export function getDistribution(): DistributionType {
  return DistributionService.getInstance().getDistribution();
}

export function isPublicRelease(): boolean {
  return DistributionService.getInstance().isPublicRelease();
}

// Export for testing
export { DistributionService };
