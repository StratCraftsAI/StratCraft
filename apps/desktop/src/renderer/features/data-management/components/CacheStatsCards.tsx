/**
 * CacheStatsCards - Cache statistics summary cards
 *
 * TICKET_340: Data Management Center - Stats display
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Database, BarChart3, Hash, Server } from 'lucide-react';
import type { CacheStats } from '../hooks/useDataCatalog';

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// =============================================================================
// StatCard
// =============================================================================

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, sub }) => (
  <div className="bg-color-terminal-panel/80 backdrop-blur-md border border-white/5 rounded-lg p-4 flex items-center gap-3">
    <div className="w-9 h-9 rounded-md bg-color-terminal-accent-teal/10 flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-color-terminal-accent-teal" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-color-terminal-text-muted">{label}</div>
      <div className="text-lg font-bold text-color-terminal-text-primary leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-color-terminal-text-muted">{sub}</div>}
    </div>
  </div>
);

// =============================================================================
// Component
// =============================================================================

interface CacheStatsCardsProps {
  stats: CacheStats | null;
}

export const CacheStatsCards: React.FC<CacheStatsCardsProps> = ({ stats }) => {
  const { t } = useTranslation('ui');

  if (!stats) {
    return (
      <div className="grid grid-cols-4 gap-3 px-4 py-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-color-terminal-panel/80 backdrop-blur-md border border-white/5 rounded-lg p-4 h-[72px] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3 px-4 py-3">
      <StatCard
        icon={Database}
        label={t('dataManagement.stats.totalSize')}
        value={formatBytes(stats.totalSizeBytes)}
        sub={t('dataManagement.stats.segments', { count: stats.totalSegments })}
      />
      <StatCard
        icon={BarChart3}
        label={t('dataManagement.stats.totalRows')}
        value={formatNumber(stats.totalRows)}
      />
      <StatCard
        icon={Hash}
        label={t('dataManagement.stats.symbols')}
        value={String(stats.symbolCount)}
      />
      <StatCard
        icon={Server}
        label={t('dataManagement.stats.providers')}
        value={String(stats.providerCount)}
      />
    </div>
  );
};
