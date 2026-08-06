/**
 * useDistribution - React hooks for distribution detection
 *
 * TICKET_631 Phase 4.1 / TICKET_635: Distribution Detection Flag System
 *
 * Provides React hooks to detect public release vs full (development) release.
 * Uses React Query with staleTime: Infinity since distribution never changes at runtime.
 */

import { useQuery } from '@tanstack/react-query';
import type { DistributionType } from '@shared/constants/distribution';
import { DEFAULT_DISTRIBUTION } from '@shared/constants/distribution';

// =============================================================================
// API
// =============================================================================

async function fetchDistribution(): Promise<DistributionType> {
  if (typeof window === 'undefined' || !window.electronAPI?.distribution) {
    return DEFAULT_DISTRIBUTION;
  }
  return window.electronAPI.distribution.getDistribution() as Promise<DistributionType>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Returns the current distribution type ('public' | 'full').
 * Defaults to 'full' if not in Electron environment.
 */
export function useDistribution(): DistributionType {
  const { data } = useQuery({
    queryKey: ['distribution'],
    queryFn: fetchDistribution,
    staleTime: Infinity,
  });
  return data ?? DEFAULT_DISTRIBUTION;
}

/**
 * Returns true if running as public release.
 */
export function useIsPublicRelease(): boolean {
  return useDistribution() === 'public';
}
