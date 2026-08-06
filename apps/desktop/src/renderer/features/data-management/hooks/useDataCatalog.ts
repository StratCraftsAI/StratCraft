/**
 * useDataCatalog - Segment list state and filters
 *
 * TICKET_340: Data Management Center - Catalog state hook
 */

import { useState, useCallback, useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface CacheStats {
  totalSegments: number;
  totalRows: number;
  totalSizeBytes: number;
  symbolCount: number;
  providerCount: number;
  byProvider: Array<{
    provider: string;
    segments: number;
    rows: number;
    symbols: number;
  }>;
  allIntervals: string[];
}

export interface DataSegmentInfo {
  id: number;
  symbol: string;
  interval: string;
  provider: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  filePath: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentFilters {
  provider: string;
  symbol: string;
  interval: string;
}

// =============================================================================
// Hook
// =============================================================================

export function useDataCatalog() {
  const [segments, setSegments] = useState<DataSegmentInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [filters, setFilters] = useState<SegmentFilters>({
    provider: '',
    symbol: '',
    interval: '',
  });
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const result = await window.electronAPI.data.getCacheStats();
      setStats(result);
    } catch (error) {
      console.error('[E:DATA:LOAD_STATS_FAILED] Failed to load stats:', error);
    }
  }, []);

  const loadSegments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.data.listSegments({
        provider: filters.provider || undefined,
        symbol: filters.symbol || undefined,
        interval: filters.interval || undefined,
        limit: 10000,
        offset: 0,
      });
      setSegments(result.segments);
      setTotal(result.total);
    } catch (error) {
      console.error('[E:DATA:LOAD_SEGMENTS_FAILED] Failed to load segments:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const refresh = useCallback(async () => {
    await Promise.all([loadStats(), loadSegments()]);
  }, [loadStats, loadSegments]);

  const deleteSegments = useCallback(async (ids: number[]) => {
    try {
      await window.electronAPI.data.deleteSegments(ids);
      await refresh();
    } catch (error) {
      console.error('[E:DATA:DELETE_SEGMENTS_FAILED] Failed to delete segments:', error);
    }
  }, [refresh]);

  // Load on mount and when filters change
  useEffect(() => {
    loadStats();
    loadSegments();
  }, [loadStats, loadSegments]);

  return {
    segments,
    total,
    stats,
    filters,
    setFilters,
    loading,
    refresh,
    deleteSegments,
  };
}
