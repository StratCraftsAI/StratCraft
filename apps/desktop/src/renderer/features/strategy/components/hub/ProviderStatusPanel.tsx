/**
 * ProviderStatusPanel - Real-time status of all strategy providers
 * 
 * Displays provider health, active strategies, and key metrics
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/common';

export type ProviderStatusType = 'online' | 'offline' | 'degraded';

export interface ProviderStatus {
  id: string;
  name: string;
  status: ProviderStatusType;
  activeStrategies: number;
  lastSync: string;
  metrics: {
    successRate: number;
    avgLatency: number;
  };
}

interface ProviderStatusPanelProps {
  providers?: ProviderStatus[];
  className?: string;
}

export const ProviderStatusPanel: React.FC<ProviderStatusPanelProps> = ({
  providers,
  className
}) => {
  const { t } = useTranslation('ui');
  // TICKET_786_6 Phase 3: demo placeholder data; replace when wired to real provider registry.
  const defaultProviders: ProviderStatus[] = [
    {
      id: 'nona',
      name: t('strategy.hub.demo.providers.pro'),
      status: 'online',
      activeStrategies: 12,
      lastSync: t('strategy.hub.demo.lastRun.twoMinAgo'),
      metrics: { successRate: 98.4, avgLatency: 45 }
    },
    {
      id: 'quant',
      name: t('strategy.hub.demo.providers.quant'),
      status: 'online',
      activeStrategies: 8,
      lastSync: t('strategy.hub.demo.lastRun.fiveMinAgo'),
      metrics: { successRate: 96.2, avgLatency: 52 }
    },
    {
      id: 'alpha',
      name: t('strategy.hub.demo.providers.alpha'),
      status: 'degraded',
      activeStrategies: 3,
      lastSync: t('strategy.hub.demo.lastRun.fifteenMinAgo'),
      metrics: { successRate: 89.1, avgLatency: 120 }
    }
  ];
  const resolvedProviders = providers ?? defaultProviders;
  return (
    <div className={cn(
      'bg-color-terminal-panel border border-color-terminal-border rounded-lg p-4 shadow-lg',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-color-terminal-text-secondary">
          {t('providerStatus.title')}
        </h3>
        <button className="text-[8px] text-color-terminal-accent-teal hover:underline">
          {t('providerStatus.viewAll')}
        </button>
      </div>

      {/* Provider List */}
      <div className="space-y-2">
        {resolvedProviders.map((provider) => (
          <div 
            key={provider.id}
            className="group relative flex items-center justify-between p-2 
                       bg-color-terminal-bg/50 rounded 
                       hover:bg-color-terminal-bg transition-colors cursor-pointer"
          >
            {/* Left: Name + Status */}
            <div className="flex items-center gap-2">
              <StatusDot status={provider.status} />
              <div>
                <p className="text-xs font-bold text-white">
                  {provider.name}
                </p>
                <p className="text-[8px] text-color-terminal-text-muted">
                  {provider.activeStrategies} {t('providerStatus.active')} * {provider.lastSync}
                </p>
              </div>
            </div>

            {/* Right: Metrics */}
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-color-terminal-text-muted">
                  {t('providerStatus.success')}
                </span>
                <span className={cn(
                  "text-[10px] font-bold",
                  provider.metrics.successRate >= 95 ? "text-green-400" : "text-color-terminal-accent-gold"
                )}>
                  {provider.metrics.successRate}%
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-color-terminal-text-muted">
                  {t('providerStatus.latency')}
                </span>
                <span className={cn(
                  "text-[10px] font-mono",
                  provider.metrics.avgLatency < 100 ? "text-color-terminal-accent-teal" : "text-color-terminal-accent-gold"
                )}>
                  {provider.metrics.avgLatency}ms
                </span>
              </div>
            </div>

            {/* Hover: Quick Actions */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity 
                          absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
              <button 
                className="p-1 bg-color-terminal-panel rounded 
                         hover:bg-color-terminal-accent-teal/20 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Settings for', provider.name);
                }}
              >
                <Settings className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProviderStatusPanel;
