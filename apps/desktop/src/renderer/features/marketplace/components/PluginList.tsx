/**
 * PluginList - Grid display of plugins
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import React from 'react';
import { Loader2, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PluginCard } from './PluginCard';
import { semverGt } from '@shared/utils/semver';
import type { RegistryPlugin, RegistryStats, InstalledPlugin, PluginPricing } from '@shared/types/marketplace';
import type { PluginActionState } from '../stores/useMarketplaceStore';

interface PluginListProps {
  plugins: RegistryPlugin[];
  stats: RegistryStats;
  installedPlugins: Map<string, InstalledPlugin>;
  isLoading: boolean;
  onSelect: (pluginId: string) => void;
  onInstall: (pluginId: string, version?: string) => void;
  /** TICKET_453: Uninstall handler */
  onUninstall: (pluginId: string) => void;
  /** TICKET_447_1: Action state resolver */
  getActionState?: (pluginId: string) => PluginActionState;
  /** TICKET_447_1: Purchase/license handler */
  onPurchaseOrLicense?: (pluginId: string) => void;
  /** TICKET_551: Pricing cache for price badge display */
  pricingCache?: Map<string, PluginPricing>;
  /** TICKET_892_4: Plugin ownership from server-authoritative cache */
  ownedPlugins?: Map<string, boolean>;
}

export function PluginList({
  plugins,
  stats,
  installedPlugins,
  isLoading,
  onSelect,
  onInstall,
  onUninstall,
  getActionState,
  onPurchaseOrLicense,
  pricingCache,
  ownedPlugins,
}: PluginListProps) {
  const { t } = useTranslation('marketplace');

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
        <Package className="mb-4 h-12 w-12" />
        <p className="text-sm">{t('noPlugins.title')}</p>
        <p className="text-xs">{t('noPlugins.hint')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {plugins.map((plugin) => {
        const installed = installedPlugins.get(plugin.id);
        const hasUpdate =
          installed && semverGt(plugin.version, installed.version);

        const actionState = getActionState?.(plugin.id);

        return (
          <PluginCard
            key={plugin.id}
            plugin={plugin}
            stats={stats[plugin.id]}
            installed={installed}
            hasUpdate={hasUpdate}
            pricing={pricingCache?.get(plugin.id) ?? plugin.pricing as PluginPricing | undefined}
            actionState={actionState}
            onClick={() => onSelect(plugin.id)}
            onInstall={() => onInstall(plugin.id)}
            onUninstall={() => onUninstall(plugin.id)}
            onPurchase={onPurchaseOrLicense ? () => onPurchaseOrLicense(plugin.id) : undefined}
            owned={ownedPlugins?.get(plugin.id) ?? false}
          />
        );
      })}
    </div>
  );
}

export default PluginList;
