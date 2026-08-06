import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap,
  Target,
  ShieldAlert,
  BarChart4,
  Cpu,
  Network,
  Hexagon,
  Lock,
  Library
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiKeyBanner } from '@/components/ui/ApiKeyBanner';

import { useServicesByCategory, useEntitlementChanges, useMessage } from '@/hooks';
import type { ServiceEntitlementState } from '@/hooks';
import { PLUGIN_IDS } from '@shared/constants';
import { WEBSITE_PRICING_URL } from '@StratCraft/types';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const STRATEGY_PLUGIN_ID = PLUGIN_IDS.STRATEGY;

// Category icon mapping
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  'REGIME MODE': BarChart4,
  'KRONOS MODE': Zap,
  'TRADER MODE': Network,
  'RISK MANAGER': ShieldAlert,
  'AUTOPILOT MODE': Cpu,
  'CHAT MODE': Target,
  'CATALOG MODE': Library,
};

// Category translation key mapping (backend name -> i18n key)
const CATEGORY_KEYS: Record<string, string> = {
  'REGIME MODE': 'regimeMode',
  'KRONOS MODE': 'kronosMode',
  'TRADER MODE': 'traderMode',
  'RISK MANAGER': 'riskManager',
  'AUTOPILOT MODE': 'autopilotMode',
  'CHAT MODE': 'chatMode',
  'CATALOG MODE': 'catalogMode',
};


// -----------------------------------------------------------------------------
// Sub-component: Service Item
// -----------------------------------------------------------------------------

interface ServiceItemProps {
  service: ServiceEntitlementState;
  onItemClick?: (serviceId: string, serviceName: string) => void;
  onLockedClick?: (service: ServiceEntitlementState) => void;
}

/** TICKET_583 Phase 3: Simplified service item -- click to navigate, no toggle */
const ServiceItem: React.FC<ServiceItemProps> = ({
  service,
  onItemClick,
  onLockedClick,
}) => {
  const handleItemClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (service.locked) {
      onLockedClick?.(service);
    } else {
      onItemClick?.(service.id, service.name);
    }
  };

  return (
    <div
      onClick={handleItemClick}
      className={cn(
        'flex items-center justify-between py-5 px-3 rounded border transition-all',
        'border-white/5 bg-white/5',
        service.locked
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:border-color-terminal-accent-gold/30 hover:bg-white/10 cursor-pointer'
      )}
    >
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-color-terminal-accent-gold shadow-glow-amber" />
        <span className="text-[11px] font-bold terminal-mono uppercase text-color-terminal-text-secondary">
          {service.name}
        </span>
      </div>
      {/* TICKET_583: Lock icon only when locked; no badge or toggle when unlocked */}
      {service.locked && (
        <Lock className="w-3.5 h-3.5 text-color-terminal-text-secondary opacity-60" />
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Sub-component: Topic Card
// -----------------------------------------------------------------------------

interface TopicCardProps {
  category: string;
  services: ServiceEntitlementState[];
  onServiceClick?: (serviceId: string, serviceName: string) => void;
  onLockedClick?: (service: ServiceEntitlementState) => void;
}

/** TICKET_745: Card grid layout -- each category is a card with services inside */
const TopicCard: React.FC<TopicCardProps> = ({
  category,
  services,
  onServiceClick,
  onLockedClick,
}) => {
  const { t } = useTranslation('ui');
  const Icon = CATEGORY_ICONS[category] || Hexagon;
  const categoryKey = CATEGORY_KEYS[category] || 'regimeMode';
  const categoryName = t(`strategy.categories.${categoryKey}`);
  const description = t(`strategy.descriptions.${categoryKey}`);

  return (
    <div className="group relative flex flex-col gap-4 p-6 rounded-lg border border-color-terminal-border hover:border-color-terminal-accent-gold/40 bg-color-terminal-panel/30 hover:bg-color-terminal-accent-gold/5 backdrop-blur-md transition-all duration-500">
      {/* Icon + Title */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-color-terminal-accent-gold/20 blur-xl rounded-full scale-0 group-hover:scale-100 transition-transform duration-700" />
          <div className="relative p-3 rounded-xl border border-color-terminal-accent-gold/30 bg-black/40 text-color-terminal-accent-gold shadow-glow-amber transition-all duration-300">
            <Icon className="w-8 h-8" />
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black terminal-mono uppercase tracking-[0.2em] text-white group-hover:text-color-terminal-accent-gold transition-colors">
            {categoryName}
          </h2>
          <p className="text-[10px] text-color-terminal-text-muted mt-1 leading-tight">
            {description}
          </p>
        </div>
      </div>

      {/* Service Items */}
      <div className="flex flex-col gap-2">
        {services.map((service) => (
          <ServiceItem
            key={service.id}
            service={service}
            onItemClick={onServiceClick}
            onLockedClick={onLockedClick}
          />
        ))}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

interface StrategyHubProps {
  onNavigate?: (level: 'hub' | 'provider' | 'group' | 'generator' | 'audit', featureName?: string, featureLabel?: string) => void;
  /** TICKET_190: Callback to open plugin settings page with optional tab */
  onSettingsClick?: (tab?: 'config' | 'llm') => void;
}

export const StrategyHub: React.FC<StrategyHubProps> = ({ onNavigate, onSettingsClick }) => {
  const { t } = useTranslation('ui');
  const { data: servicesByCategory, isLoading } = useServicesByCategory(STRATEGY_PLUGIN_ID);
  const { showModal } = useMessage();

  // Subscribe to entitlement changes
  useEntitlementChanges();

  // Convert grouped services to sorted categories
  const categories = useMemo(() => {
    if (!servicesByCategory) return [];

    // Define preferred order
    const categoryOrder = [
      'REGIME MODE',
      // 'KRONOS MODE', // TICKET_578: Disabled - requires dedicated GPU server
      'TRADER MODE',
      'AUTOPILOT MODE',
      'CHAT MODE',
      'RISK MANAGER',
      'CATALOG MODE',
    ];

    return Object.entries(servicesByCategory)
      .filter(([category]) => categoryOrder.includes(category))
      .sort(([a], [b]) => {
        const aIndex = categoryOrder.indexOf(a);
        const bIndex = categoryOrder.indexOf(b);
        return aIndex - bIndex;
      })
      .map(([category, services]) => ({ category, services }));
  }, [servicesByCategory]);

  // Handle category click navigation
  const handleCategoryClick = (category: string) => {
    if (category === 'REGIME MODE' && onNavigate) {
      onNavigate('generator');
    }
  };

  // Handle service item click navigation
  const handleServiceClick = (serviceId: string, serviceName?: string) => {
    if (onNavigate) {
      // Pass the service ID for editor resolution, display name for breadcrumb
      onNavigate('generator', serviceId, serviceName);
    }
  };

  // Handle locked service click
  const handleLockedClick = async (service: ServiceEntitlementState) => {
    const confirmed = await showModal({
      title: service.name,
      content: t('locked.requiresTier', { tier: service.tier.toUpperCase() }),
      type: 'warning',
      showCancel: true,
      okText: t('auth.loginToUnlock'),
      cancelText: t('common.cancel'),
    });
    if (confirmed) {
      window.dispatchEvent(new Event('nexus:auth-required'));
    }
  };

  // TICKET_190: API Key Banner handlers
  const handleConfigureApiKey = useCallback(() => {
    // Navigate to plugin settings page - LLM tab
    if (onSettingsClick) {
      onSettingsClick('llm');
    }
  }, [onSettingsClick]);

  const handleUpgradeFromBanner = useCallback(() => {
    window.electronAPI?.marketplace?.openPurchaseUrl(WEBSITE_PRICING_URL);
  }, []);

  return (
    <div className="h-full flex flex-col terminal-theme bg-StratCraftsAI relative overflow-hidden">
      {/* Dynamic Background elements */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-color-terminal-accent-gold/5 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 blur-[100px] pointer-events-none rounded-full" />

      {/* TICKET_745: Viewport-centered content */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto px-6 py-10 z-10 custom-scrollbar">
        <div className="max-w-[800px] w-full space-y-8">
          {/* TICKET_190: API Key Configuration Banner (Layer 1) */}
          <ApiKeyBanner
            onConfigure={handleConfigureApiKey}
            onUpgrade={handleUpgradeFromBanner}
            className="mb-4"
          />

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-color-terminal-text-secondary terminal-mono text-sm animate-pulse">
                {t('strategy.hub.loadingTopology')}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && categories.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Hexagon className="w-12 h-12 text-color-terminal-text-muted mb-4" />
              <p className="text-color-terminal-text-secondary terminal-mono text-sm">
                {t('strategy.hub.noPlugins')}
              </p>
              <p className="text-color-terminal-text-muted text-xs mt-2">
                {t('strategy.hub.installPlugins')}
              </p>
            </div>
          )}

          {/* TICKET_745: 2-column card grid */}
          {!isLoading && categories.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {categories.map(({ category, services }) => (
                <div key={category} onClick={() => handleCategoryClick(category)} className="cursor-pointer">
                  <TopicCard
                    category={category}
                    services={services}
                    onServiceClick={handleServiceClick}
                    onLockedClick={handleLockedClick}
                  />
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(245, 158, 11, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(245, 158, 11, 0.4);
        }
        .glow-text {
          text-shadow: 0 0 10px rgba(230, 241, 255, 0.3);
        }
      `}</style>
    </div>
  );
};
