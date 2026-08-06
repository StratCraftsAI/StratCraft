/**
 * PluginFilters - Search and filter controls
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import React from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMarketplaceStore } from '../stores/useMarketplaceStore';
import type { PluginCategory, PluginSortBy } from '@shared/types/marketplace';

const CATEGORY_KEYS: PluginCategory[] = ['all', 'visualization', 'indicators', 'trading', 'data', 'ai', 'tools'];
const SORT_KEYS: { value: PluginSortBy; key: string }[] = [
  { value: 'downloads', key: 'mostDownloads' },
  { value: 'stars', key: 'mostStars' },
  { value: 'updated', key: 'recentlyUpdated' },
  { value: 'name', key: 'name' },
];

export function PluginFilters() {
  const { t } = useTranslation('marketplace');
  const {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    sortBy,
    setSortBy,
  } = useMarketplaceStore();

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('search.placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Category Dropdown */}
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value as PluginCategory)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {CATEGORY_KEYS.map((cat) => (
            <option key={cat} value={cat}>
              {t(`categories.${cat}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Sort Dropdown */}
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value as PluginSortBy)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {SORT_KEYS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(`sort.${opt.key}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default PluginFilters;
