/**
 * BacktestPluginHub Component (page21)
 *
 * Plugin hub interface showing available cockpit modes.
 * TICKET_745: 2x2 card grid layout, viewport-centered.
 *
 * @see TICKET_209 - Backtest Plugin Hub Navigation
 * @see TICKET_077_1 - Page Hierarchy
 * @see TICKET_745 - Unified Plugin Hub Card Grid Layout
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Inline SVG Icons (no external dependency)
// -----------------------------------------------------------------------------

const BarChart3Icon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

const TrendingUpIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);

const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// TICKET_499: AI Libero cockpit icon (brain-circuit style for AI agent)
const BrainCircuitIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
    <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
    <path d="M6 18a4 4 0 0 1-1.967-.516" />
    <path d="M19.967 17.484A4 4 0 0 1 18 18" />
  </svg>
);

const CatalogIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    <path d="M8 7h6" />
    <path d="M8 11h8" />
  </svg>
);

// TICKET_508: AI Studio cockpit icon (message-circle-code style for chat-based strategy)
const MessageCircleCodeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    <path d="m10 10-2 2 2 2" />
    <path d="m14 10 2 2-2 2" />
  </svg>
);

const LockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

// TICKET_704: Three-tier cockpit gating (free/basic/pro)
type CockpitTier = 'free' | 'basic' | 'pro';

interface CockpitConfig {
  id: string;
  nameKey: string;
  descKey: string;
  icon: React.ElementType;
  tier: CockpitTier;
}

// TICKET_211: Runtime item with computed locked state
interface CockpitItem extends CockpitConfig {
  locked: boolean;
}

// TICKET_704: Tier numeric levels for comparison (mirrors ENTITLEMENT_TIER_LEVELS)
const COCKPIT_TIER_LEVELS: Record<CockpitTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
};

export interface BacktestPluginHubProps {
  /** Callback when a cockpit is selected */
  onSelectCockpit: (cockpitId: string) => void;
  /** Callback when a locked cockpit is clicked */
  onLockedClick?: (cockpit: CockpitItem) => void;
  /** TICKET_704: User entitlement tier for tier-level cockpit gating */
  userTier?: CockpitTier;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * TICKET_211: Cockpit configurations without hardcoded locked state.
 * locked is computed dynamically based on userHasPro prop.
 */
const COCKPIT_CONFIGS: CockpitConfig[] = [
  {
    id: 'indicators',
    nameKey: 'cockpitSelector.indicatorsCockpit',
    descKey: 'cockpitSelector.indicatorsCockpitDesc',
    icon: BarChart3Icon,
    tier: 'free',
  },
  {
    id: 'trader',
    nameKey: 'cockpitSelector.traderCockpit',
    descKey: 'cockpitSelector.traderCockpitDesc',
    icon: TrendingUpIcon,
    tier: 'basic',
  },
  {
    id: 'catalog',
    nameKey: 'cockpitSelector.catalogCockpit',
    descKey: 'cockpitSelector.catalogCockpitDesc',
    icon: CatalogIcon,
    tier: 'free',
  },
  // TICKET_578: Disabled - requires dedicated GPU server
  // {
  //   id: 'kronos',
  //   nameKey: 'cockpitSelector.kronosCockpit',
  //   descKey: 'cockpitSelector.kronosCockpitDesc',
  //   icon: ClockIcon,
  //   tier: 'pro',
  // },
  {
    id: 'aiLibero',
    nameKey: 'cockpitSelector.aiLiberoCockpit',
    descKey: 'cockpitSelector.aiLiberoCockpitDesc',
    icon: BrainCircuitIcon,
    tier: 'basic',
  },
  {
    id: 'aiStudio',
    nameKey: 'cockpitSelector.aiStudioCockpit',
    descKey: 'cockpitSelector.aiStudioCockpitDesc',
    icon: MessageCircleCodeIcon,
    tier: 'pro',
  },
];

// TICKET_583: TIER_COLORS removed -- hub pages show lock icon only, no tier badges

// -----------------------------------------------------------------------------
// Sub-component: CockpitCard (TICKET_745: 2x2 card grid)
// -----------------------------------------------------------------------------

interface CockpitCardProps {
  cockpit: CockpitItem;
  onClick: () => void;
  t: (key: string) => string;
}

const CockpitCard: React.FC<CockpitCardProps> = ({ cockpit, onClick, t }) => {
  const Icon = cockpit.icon;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-4 p-8 rounded-lg border transition-all duration-500 backdrop-blur-md',
        cockpit.locked
          ? 'opacity-50 cursor-not-allowed border-white/10 bg-white/5'
          : 'border-color-terminal-border hover:border-color-terminal-accent-teal/40 bg-color-terminal-panel/30 hover:bg-color-terminal-accent-teal/5 cursor-pointer'
      )}
    >
      {/* Lock badge (top-right corner) */}
      {cockpit.locked && (
        <div className="absolute top-3 right-3">
          <LockIcon className="w-4 h-4 text-color-terminal-text-secondary opacity-60" />
        </div>
      )}

      {/* Icon */}
      <div className="relative">
        {!cockpit.locked && (
          <div className="absolute inset-0 bg-color-terminal-accent-teal/20 blur-xl rounded-full scale-0 group-hover:scale-100 transition-transform duration-700" />
        )}
        <div
          className={cn(
            'relative p-4 rounded-xl border transition-all duration-300',
            cockpit.locked
              ? 'border-white/10 bg-white/5 text-color-terminal-text-muted'
              : 'border-color-terminal-accent-teal/30 bg-black/40 text-color-terminal-accent-teal shadow-glow-teal'
          )}
        >
          <Icon className="w-10 h-10" />
        </div>
      </div>

      {/* Title + Description */}
      <div className="text-center min-w-0">
        <h2
          className={cn(
            'text-sm font-black terminal-mono uppercase tracking-[0.2em] transition-colors',
            cockpit.locked
              ? 'text-color-terminal-text-muted'
              : 'text-white group-hover:text-color-terminal-accent-teal'
          )}
        >
          {t(cockpit.nameKey)}
        </h2>
        <p className="text-[11px] text-color-terminal-text-muted mt-2 leading-relaxed">
          {t(cockpit.descKey)}
        </p>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export const BacktestPluginHub: React.FC<BacktestPluginHubProps> = ({
  onSelectCockpit,
  onLockedClick,
  userTier = 'free',
}) => {
  const { t } = useTranslation('backtest');

  // TICKET_704: Compute locked state via tier-level comparison
  // A cockpit is locked when its required tier exceeds the user's tier
  const userLevel = COCKPIT_TIER_LEVELS[userTier] ?? 0;
  const cockpitItems: CockpitItem[] = COCKPIT_CONFIGS.map((config) => ({
    ...config,
    locked: COCKPIT_TIER_LEVELS[config.tier] > userLevel,
  }));

  const handleCardClick = (cockpit: CockpitItem) => {
    if (cockpit.locked) {
      onLockedClick?.(cockpit);
    } else {
      onSelectCockpit(cockpit.id);
    }
  };

  return (
    <div className="h-full flex flex-col terminal-theme bg-StratCraftsAI relative overflow-hidden">
      {/* Background effects (aligned with Builder Hub sizes) */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-color-terminal-accent-teal/5 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 blur-[100px] pointer-events-none rounded-full" />

      {/* TICKET_745: Viewport-centered content */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto px-6 py-10 z-10 custom-scrollbar">
        <div className="max-w-[720px] w-full space-y-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-lg font-black terminal-mono uppercase tracking-[0.2em] text-white mb-2">
              {t('cockpitSelector.title')}
            </h1>
            <p className="text-xs text-color-terminal-text-muted">
              {t('cockpitSelector.subtitle')}
            </p>
          </div>

          {/* TICKET_745: 2x2 Card Grid */}
          <div className="grid grid-cols-2 gap-4">
            {cockpitItems.map((cockpit) => (
              <CockpitCard
                key={cockpit.id}
                cockpit={cockpit}
                onClick={() => handleCardClick(cockpit)}
                t={t}
              />
            ))}
          </div>
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
          background: rgba(20, 184, 166, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(20, 184, 166, 0.4);
        }
      `}</style>
    </div>
  );
};

export default BacktestPluginHub;
