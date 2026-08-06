/**
 * StrategyCard Component
 *
 * Deletable card showing an added strategy expression.
 * Used in Zone C of Strategy Studio pages.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_063 - StratCraftsAI UI Spec
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StrategyCardProps {
  /** Unique identifier for the card */
  id: string;
  /** The strategy expression to display */
  expression: string;
  /** Callback when delete button is clicked */
  onDelete: (id: string) => void;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// StrategyCard Component
// -----------------------------------------------------------------------------

export const StrategyCard: React.FC<StrategyCardProps> = ({
  id,
  expression,
  onDelete,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const handleDelete = () => {
    onDelete(id);
  };

  return (
    <div
      className={cn(
        'strategy-card',
        'border border-color-terminal-border rounded',
        'bg-color-terminal-surface/50',
        'transition-all hover:border-color-terminal-accent-gold/30',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-color-terminal-border/50">
        <div className="flex items-center gap-2">
          <FileText className="w-3 h-3 text-color-terminal-accent-teal" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
            {t('ui.strategyCard.headerLabel')}
          </span>
        </div>
        <button
          onClick={handleDelete}
          className={cn(
            'p-1 rounded',
            'text-color-terminal-text-muted hover:text-red-400',
            'hover:bg-red-500/10 transition-all'
          )}
          title={t('ui.strategyCard.deleteTitle')}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Expression */}
      <div className="px-3 py-2">
        <code className="text-xs terminal-mono text-color-terminal-text">
          {expression}
        </code>
      </div>
    </div>
  );
};

export default StrategyCard;
