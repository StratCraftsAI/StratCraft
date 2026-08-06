/**
 * ProviderPortal Component (Level 2)
 * 
 * Focused view for a specific algorithm provider (e.g., Nona, AAA).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Package, CheckCircle2, ShieldAlert, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderPortalProps {
  providerId: string;
  providerName: string;
}

const MODULE_NAME_KEYS: Record<string, string> = {
  Optimizer: 'moduleNames.optimizer',
  RiskEngine: 'moduleNames.riskEngine',
  DataFeed: 'moduleNames.dataFeed',
  Backtester: 'moduleNames.backtester',
};

export const ProviderPortal: React.FC<ProviderPortalProps> = ({ providerId, providerName }) => {
  const { t } = useTranslation('ui');
  // TICKET_786_6 Phase 3: demo placeholder data; replace when wired to real template registry.
  const templates = [
    { name: t('strategy.hub.demo.templates.trendFollowing'), id: 'trend', count: 12, health: 'good' },
    { name: t('strategy.hub.demo.templates.meanReversion'), id: 'mean', count: 8, health: 'good' },
    { name: t('strategy.hub.demo.templates.marketMaking'), id: 'market', count: 5, health: 'warning' },
    { name: t('strategy.hub.demo.templates.statArbitrage'), id: 'stat-arb', count: 15, health: 'good' },
  ];

  return (
    <div className="p-6 h-full flex flex-col gap-6 terminal-theme">
      {/* Provider Header */}
      <div className="flex items-center gap-6 border-b border-color-terminal-border pb-6">
        <div className="w-20 h-20 bg-color-terminal-panel border border-color-terminal-border rounded-lg flex items-center justify-center relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-color-terminal-accent-teal/10 to-transparent"></div>
          <Cpu className="w-10 h-10 text-color-terminal-accent-teal group-hover:scale-110 transition-transform" />
        </div>
        <div>
          <h1 className="text-3xl font-black terminal-mono uppercase tracking-tighter">{providerName}</h1>
          <div className="flex gap-4 mt-2">
            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
              <CheckCircle2 className="w-3 h-3" /> {t('strategy.providerPortal.licenseValid')}
            </span>
            <span className="text-[10px] bg-white/5 text-color-terminal-text-secondary px-2 py-0.5 rounded font-mono">
              v2.4.0-stable
            </span>
          </div>
        </div>
      </div>

      {/* Template Grid */}
      <div>
        <h2 className="text-xs font-bold text-color-terminal-text-secondary uppercase tracking-widest mb-4">{t('strategy.providerPortal.availableStrategies')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className="bg-color-terminal-panel border border-color-terminal-border p-4 rounded-lg hover:border-color-terminal-accent-gold transition-colors cursor-pointer group">
              <div className="flex justify-between items-start">
                <Package className="w-8 h-8 text-color-terminal-text-secondary group-hover:text-color-terminal-accent-gold transition-colors" />
                {tpl.health === 'warning' && <ShieldAlert className="w-4 h-4 text-color-terminal-accent-red animate-pulse" />}
              </div>
              <h3 className="mt-4 font-bold text-color-terminal-text-primary">{tpl.name}</h3>
              <p className="text-color-terminal-text-secondary text-xs mt-1 terminal-mono">{tpl.count} {t('strategy.providerPortal.activeGenerators')}</p>
              <div className="mt-4 flex items-center gap-2">
                <div className="flex-1 h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-color-terminal-accent-gold w-3/4"></div>
                </div>
                <span className="text-[10px] font-bold text-color-terminal-accent-gold">75% {t('strategy.providerPortal.deployment')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Provider Details */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-color-terminal-panel/50 border border-color-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-bold text-color-terminal-text-secondary uppercase tracking-widest mb-4">{t('strategy.providerPortal.executionLogs')}</h3>
          <div className="space-y-2 terminal-mono text-[11px]">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex gap-4 border-l-2 border-color-terminal-accent-teal/30 pl-3 py-1">
                <span className="text-color-terminal-text-secondary">[2026-01-06 06:45:22]</span>
                <span className="text-color-terminal-accent-teal">{t('strategy.providerPortal.info')}</span>
                <span>{t('strategy.providerPortal.initializedMessage', { provider: providerName })}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-color-terminal-panel/50 border border-color-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-bold text-color-terminal-text-secondary uppercase tracking-widest mb-4">{t('strategy.providerPortal.moduleStatus')}</h3>
          <div className="space-y-4">
            {['Optimizer', 'RiskEngine', 'DataFeed', 'Backtester'].map(mod => (
              <div key={mod} className="flex items-center justify-between">
                <span className="text-sm">{t(MODULE_NAME_KEYS[mod] ?? mod)}</span>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-8 bg-color-terminal-accent-teal rounded-full shadow-[0_0_8px_rgba(100,255,218,0.5)]"></div>
                  <span className="text-[10px] terminal-mono">{t('strategy.providerPortal.ready')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
