/**
 * IndicatorTemplateSelectorDialog Component
 *
 * Modal dialog for selecting indicator templates.
 * Loads public templates from JSON configuration.
 *
 * @see TICKET_212 - Kronos AI Entry Load Template Feature
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, LayoutTemplate, Loader2, TrendingUp, Zap, Activity, BarChart3 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { RawIndicatorBlock } from './RawIndicatorSelector';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface IndicatorTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  indicators: RawIndicatorBlock[];
}

export interface IndicatorTemplateSelectorDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when a template is selected */
  onSelect: (template: IndicatorTemplate) => void;
  /** Dialog title */
  title?: string;
  /** Empty state message */
  emptyMessage?: string;
}

// -----------------------------------------------------------------------------
// Category Icons
// -----------------------------------------------------------------------------

const categoryIcons: Record<string, React.ReactNode> = {
  standard: <LayoutTemplate className="w-5 h-5" />,
  momentum: <Zap className="w-5 h-5" />,
  trend: <TrendingUp className="w-5 h-5" />,
  volatility: <Activity className="w-5 h-5" />,
  volume: <BarChart3 className="w-5 h-5" />,
};

const categoryColors: Record<string, string> = {
  standard: 'text-color-terminal-accent-primary',
  momentum: 'text-yellow-400',
  trend: 'text-green-400',
  volatility: 'text-orange-400',
  volume: 'text-blue-400',
};

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const overlayStyles = cn(
  'fixed inset-0 z-50',
  'bg-black/60 backdrop-blur-sm',
  'flex items-center justify-center',
  'p-4'
);

const dialogStyles = cn(
  'w-full max-w-lg',
  'bg-color-terminal-surface',
  'border border-color-terminal-border',
  'rounded-lg shadow-2xl',
  'overflow-hidden'
);

const headerStyles = cn(
  'flex items-center justify-between',
  'px-4 py-3',
  'border-b border-color-terminal-border',
  'bg-color-terminal-bg/50'
);

const titleStyles = cn(
  'text-sm font-semibold tracking-wide',
  'text-color-terminal-text'
);

const closeButtonStyles = cn(
  'p-1.5 rounded',
  'text-color-terminal-text-secondary',
  'hover:text-color-terminal-text',
  'hover:bg-color-terminal-border/50',
  'transition-colors'
);

const searchContainerStyles = cn(
  'px-4 py-3',
  'border-b border-color-terminal-border'
);

const searchInputStyles = cn(
  'w-full px-3 py-2',
  'bg-color-terminal-bg',
  'border border-color-terminal-border',
  'rounded-md',
  'text-sm text-color-terminal-text',
  'placeholder:text-color-terminal-text-secondary',
  'focus:outline-none focus:border-color-terminal-accent-primary',
  'transition-colors'
);

const listContainerStyles = cn(
  'max-h-[400px] overflow-y-auto',
  'p-2'
);

const itemStyles = cn(
  'flex items-start gap-3',
  'px-3 py-3',
  'rounded-md',
  'cursor-pointer',
  'transition-colors',
  'hover:bg-color-terminal-border/30'
);

const itemSelectedStyles = cn(
  'bg-color-terminal-accent-primary/10',
  'border border-color-terminal-accent-primary/30'
);

const itemNameStyles = cn(
  'text-sm font-medium',
  'text-color-terminal-text'
);

const itemDescStyles = cn(
  'text-xs mt-0.5',
  'text-color-terminal-text-secondary',
  'line-clamp-2'
);

const itemBadgeStyles = cn(
  'text-[10px] px-1.5 py-0.5',
  'rounded',
  'bg-color-terminal-border/50',
  'text-color-terminal-text-secondary',
  'uppercase tracking-wider'
);

const emptyStyles = cn(
  'flex flex-col items-center justify-center',
  'py-12 px-4',
  'text-color-terminal-text-secondary'
);

const loadingStyles = cn(
  'flex items-center justify-center',
  'py-12'
);

const footerStyles = cn(
  'flex items-center justify-end gap-3',
  'px-4 py-3',
  'border-t border-color-terminal-border',
  'bg-color-terminal-bg/50'
);

const buttonBaseStyles = cn(
  'px-4 py-2',
  'text-sm font-medium',
  'rounded-md',
  'transition-colors',
  'disabled:opacity-50 disabled:cursor-not-allowed'
);

const cancelButtonStyles = cn(
  buttonBaseStyles,
  'text-color-terminal-text-secondary',
  'hover:text-color-terminal-text',
  'hover:bg-color-terminal-border/50'
);

const selectButtonStyles = cn(
  buttonBaseStyles,
  'bg-color-terminal-accent-primary',
  'text-color-terminal-bg',
  'hover:opacity-90'
);

// -----------------------------------------------------------------------------
// Load Templates
// -----------------------------------------------------------------------------

async function loadPublicTemplates(): Promise<IndicatorTemplate[]> {
  try {
    // Dynamic import of JSON file
    const templates = await import('../../../assets/templates/public-indicator-templates.json');
    return templates.default as IndicatorTemplate[];
  } catch (error) {
    console.error('[E:STRATEGY:INDICATOR_TEMPLATES_LOAD_FAILED] [IndicatorTemplateSelector] Failed to load templates:', error);
    return [];
  }
}

// -----------------------------------------------------------------------------
// IndicatorTemplateSelectorDialog Component
// -----------------------------------------------------------------------------

export const IndicatorTemplateSelectorDialog: React.FC<IndicatorTemplateSelectorDialogProps> = ({
  isOpen,
  onClose,
  onSelect,
  title,
  emptyMessage,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [templates, setTemplates] = useState<IndicatorTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<IndicatorTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use translation keys if title/emptyMessage not provided
  const dialogTitle = title || t('ui.indicatorTemplateDialog.title');
  const emptyMsg = emptyMessage || t('ui.indicatorTemplateDialog.emptyMessage');
  const searchPlaceholder = t('ui.indicatorTemplateDialog.searchPlaceholder');
  const cancelLabel = t('common.cancel');
  const loadLabel = t('ui.indicatorTemplateDialog.load');
  const indicatorsCountLabel = (count: number) => t('ui.indicatorTemplateDialog.indicatorsCount', { count });

  // Load templates when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);
      setSelectedId(null);
      setSearchQuery('');

      loadPublicTemplates()
        .then(data => {
          setTemplates(data);
          setFilteredTemplates(data);
        })
        .catch(err => {
          setError(err.message || t('errors.failedToLoadTemplates'));
          setTemplates([]);
          setFilteredTemplates([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen]);

  // Filter templates based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTemplates(templates);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredTemplates(
        templates.filter(
          t =>
            t.name.toLowerCase().includes(query) ||
            t.description.toLowerCase().includes(query) ||
            t.category.toLowerCase().includes(query)
        )
      );
    }
  }, [searchQuery, templates]);

  const handleSelect = useCallback(() => {
    const selected = templates.find(t => t.id === selectedId);
    if (selected) {
      onSelect(selected);
      onClose();
    }
  }, [selectedId, templates, onSelect, onClose]);

  const handleItemClick = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleItemDoubleClick = useCallback((template: IndicatorTemplate) => {
    onSelect(template);
    onClose();
  }, [onSelect, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={overlayStyles} onClick={onClose}>
      <div className={dialogStyles} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={headerStyles}>
          <h2 className={titleStyles}>{dialogTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className={closeButtonStyles}
            aria-label={cancelLabel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className={searchContainerStyles}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-color-terminal-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className={cn(searchInputStyles, 'pl-9')}
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className={listContainerStyles}>
          {loading ? (
            <div className={loadingStyles}>
              <Loader2 className="w-6 h-6 animate-spin text-color-terminal-accent-primary" />
            </div>
          ) : error ? (
            <div className={emptyStyles}>
              <p className="text-red-400">{error}</p>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className={emptyStyles}>
              <LayoutTemplate className="w-10 h-10 mb-3 opacity-50" />
              <p>{emptyMsg}</p>
            </div>
          ) : (
            filteredTemplates.map(template => (
              <div
                key={template.id}
                className={cn(
                  itemStyles,
                  selectedId === template.id && itemSelectedStyles
                )}
                onClick={() => handleItemClick(template.id)}
                onDoubleClick={() => handleItemDoubleClick(template)}
              >
                <div className={cn('flex-shrink-0 mt-0.5', categoryColors[template.category] || 'text-color-terminal-accent-primary')}>
                  {categoryIcons[template.category] || <LayoutTemplate className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={itemNameStyles}>{template.name}</span>
                    <span className={itemBadgeStyles}>{indicatorsCountLabel(template.indicators.length)}</span>
                  </div>
                  <div className={itemDescStyles}>{template.description}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className={footerStyles}>
          <button
            type="button"
            onClick={onClose}
            className={cancelButtonStyles}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleSelect}
            disabled={selectedId === null}
            className={selectButtonStyles}
          >
            {loadLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IndicatorTemplateSelectorDialog;
