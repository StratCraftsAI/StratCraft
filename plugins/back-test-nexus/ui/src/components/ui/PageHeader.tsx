/**
 * PageHeader Component - Zone A
 *
 * Page header with title, optional subtitle, and settings gear icon.
 * Follows TICKET_077 Zone A layout specification.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library (Zone A)
 * @see TICKET_308 - Backtest Pages PageHeader Component
 */

import React from 'react';
import { cn } from '../../lib/utils';

// Inline Settings gear icon (lucide Settings)
const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export interface PageHeaderProps {
  /** Page title displayed in gold uppercase */
  title: string;
  /** Optional subtitle displayed below title in muted text */
  subtitle?: string;
  /** Settings gear icon click handler. Gear icon only rendered when provided. */
  onSettingsClick?: () => void;
  /** Additional CSS classes */
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  onSettingsClick,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex-shrink-0 px-6 flex items-center justify-between border-b border-color-terminal-border bg-color-terminal-surface',
        subtitle ? 'py-2' : 'h-12',
        className
      )}
    >
      <div>
        <h1 className="text-sm font-bold terminal-mono uppercase tracking-wider text-color-terminal-accent-gold">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[10px] text-color-terminal-text-muted mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {onSettingsClick && (
        <button
          onClick={onSettingsClick}
          className="p-2 text-color-terminal-text-muted hover:text-color-terminal-text hover:bg-white/5 rounded transition-all"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
