/**
 * PluginSettingsPage - Backtest plugin settings page
 *
 * TICKET_308: Backtest PluginSettingsPage
 * Mirrors strategy-builder-nexus PluginSettingsPage pattern.
 * Currently secrets-only (no ConfigTab) since backtest manifest has no configuration properties.
 *
 * @see TICKET_093 - Plugin Settings Decoupling
 * @see TICKET_081 - Plugin Settings Architecture
 * @see TICKET_308 - Backtest PageHeader + Plugin Settings Page
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { SecretsTab } from './SecretsTab';

// =============================================================================
// Types
// =============================================================================

type SettingsTab = 'secrets';

export interface PluginSettingsPageProps {
  pluginId: string;
  pluginName: string;
  onBack?: () => void;
  defaultTab?: SettingsTab;
}

// =============================================================================
// Inline SVG Icons
// =============================================================================

const ArrowLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const KeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

// =============================================================================
// MiniNameplate Component (matches host MiniNameplate metallic style)
// @see apps/desktop/src/renderer/components/common/nameplate-styles.ts
// =============================================================================

const NAMEPLATE_STYLES = {
  plate: {
    background: `repeating-linear-gradient(115deg,#dcdcdc 0%,#c0c0c0 5%,#e8e8e8 10%,#c0c0c0 15%,#dcdcdc 20%),linear-gradient(180deg,#b0b0b0 0%,#ffffff 40%,#d0d0d0 100%)`,
    backgroundBlendMode: 'hard-light' as const,
    border: '1px solid #a0a0a0',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.9),inset 0 -1px 0 rgba(0,0,0,0.2)',
  },
  noise: {
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
  },
  shimmer: {
    background: 'linear-gradient(105deg,transparent 40%,rgba(255,255,255,0.8) 45%,rgba(255,255,255,0.9) 50%,rgba(255,255,255,0.8) 55%,transparent 60%)',
    mixBlendMode: 'soft-light' as const,
  },
  text: {
    background: 'linear-gradient(180deg,#333333 0%,#1a1a1a 100%)',
    WebkitBackgroundClip: 'text' as const,
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text' as const,
    textShadow: '0px 1px 0px rgba(255,255,255,0.5)',
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
  },
};

const MiniNameplate: React.FC<{ text: string }> = ({ text }) => (
  <div
    className="relative flex items-center justify-center px-4 py-0.5 rounded select-none"
    style={NAMEPLATE_STYLES.plate}
  >
    <div
      className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay rounded"
      style={NAMEPLATE_STYLES.noise}
    />
    <div
      className="absolute inset-0 opacity-40 pointer-events-none rounded"
      style={NAMEPLATE_STYLES.shimmer}
    />
    <span
      className="relative z-10 text-[12px] font-black tracking-[0.2em] uppercase"
      style={NAMEPLATE_STYLES.text}
    >
      {text}
    </span>
  </div>
);

// =============================================================================
// Header Bar Component
// =============================================================================

interface SettingsHeaderBarProps {
  pluginName: string;
  onBack?: () => void;
}

const SettingsHeaderBar: React.FC<SettingsHeaderBarProps> = ({ pluginName, onBack }) => {
  const { t } = useTranslation('backtest');
  const nameplateText = pluginName.toUpperCase();

  return (
    <div className="h-8 border-b border-color-terminal-border bg-color-terminal-panel flex items-center justify-between px-4 shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
      {/* Left: Back button */}
      <div className="flex items-center gap-3">
        {onBack && (
          <>
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-color-terminal-text-muted hover:text-color-terminal-accent-teal transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              <span className="text-[12px] font-bold">{t('settings.back')}</span>
            </button>
            <div className="h-4 w-px bg-white/20" />
          </>
        )}
        <span className="text-[12px] font-bold uppercase tracking-widest text-color-terminal-text-muted">
          {t('settings.title')}
        </span>
      </div>

      {/* Center: Nameplate */}
      <div className="flex-1 flex items-center justify-center">
        <MiniNameplate text={nameplateText} />
      </div>

      {/* Right: Tab indicator (secrets only) */}
      <div className="inline-flex border border-dashed border-white/20 rounded">
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal rounded">
          <KeyIcon className="w-3 h-3" />
          <span className="text-[12px] font-bold uppercase tracking-widest">{t('settings.secrets')}</span>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export function PluginSettingsPage({
  pluginId,
  pluginName,
  onBack,
}: PluginSettingsPageProps): JSX.Element {
  return (
    <div className="h-full flex flex-col bg-StratCraftsAI terminal-theme">
      {/* Header Bar */}
      <SettingsHeaderBar
        pluginName={pluginName}
        onBack={onBack}
      />

      {/* Tab Content - Secrets only for now */}
      <div className="flex-1 overflow-hidden">
        <SecretsTab pluginId={pluginId} />
      </div>
    </div>
  );
}

export default PluginSettingsPage;
