/**
 * AlgorithmSelectorDialog Component
 *
 * Modal dialog for selecting saved algorithms/templates.
 * Used by Load Template functionality in Builder pages.
 *
 * @see TICKET_212 - Kronos AI Entry Load Template Feature
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, FileCode, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AlgorithmListItem } from '../../services/algorithm-storage-service';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AlgorithmSelectorDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when an algorithm is selected */
  onSelect: (algorithm: AlgorithmListItem) => void;
  /** Function to fetch algorithms */
  fetchAlgorithms: () => Promise<{ success: boolean; data: AlgorithmListItem[] }>;
  /** Dialog title */
  title?: string;
  /** Empty state message */
  emptyMessage?: string;
}

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

const itemIconStyles = cn(
  'flex-shrink-0 mt-0.5',
  'text-color-terminal-accent-primary'
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
// AlgorithmSelectorDialog Component
// -----------------------------------------------------------------------------

export const AlgorithmSelectorDialog: React.FC<AlgorithmSelectorDialogProps> = ({
  isOpen,
  onClose,
  onSelect,
  fetchAlgorithms,
  title,
  emptyMessage,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [algorithms, setAlgorithms] = useState<AlgorithmListItem[]>([]);
  const [filteredAlgorithms, setFilteredAlgorithms] = useState<AlgorithmListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use translation keys if title/emptyMessage not provided
  const dialogTitle = title || t('ui.algorithmDialog.title');
  const emptyMsg = emptyMessage || t('ui.algorithmDialog.emptyMessage');
  const searchPlaceholder = t('ui.algorithmDialog.searchPlaceholder');
  const cancelLabel = t('common.cancel');
  const loadLabel = t('ui.algorithmDialog.load');
  const closeLabel = t('common.close');

  // Fetch algorithms when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);
      setSelectedId(null);
      setSearchQuery('');

      fetchAlgorithms()
        .then(result => {
          if (result.success) {
            setAlgorithms(result.data);
            setFilteredAlgorithms(result.data);
          } else {
            setError(t('ui.algorithmDialog.loadFailed'));
            setAlgorithms([]);
            setFilteredAlgorithms([]);
          }
        })
        .catch(err => {
          setError(err.message || t('ui.algorithmDialog.loadFailed'));
          setAlgorithms([]);
          setFilteredAlgorithms([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, fetchAlgorithms, t]);

  // Filter algorithms based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredAlgorithms(algorithms);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredAlgorithms(
        algorithms.filter(
          algo =>
            algo.strategyName.toLowerCase().includes(query) ||
            (algo.description && algo.description.toLowerCase().includes(query))
        )
      );
    }
  }, [searchQuery, algorithms]);

  const handleSelect = useCallback(() => {
    const selected = algorithms.find(a => a.id === selectedId);
    if (selected) {
      onSelect(selected);
      onClose();
    }
  }, [selectedId, algorithms, onSelect, onClose]);

  const handleItemClick = useCallback((id: number) => {
    setSelectedId(id);
  }, []);

  const handleItemDoubleClick = useCallback((algorithm: AlgorithmListItem) => {
    onSelect(algorithm);
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
            aria-label={closeLabel}
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
          ) : filteredAlgorithms.length === 0 ? (
            <div className={emptyStyles}>
              <FileCode className="w-10 h-10 mb-3 opacity-50" />
              <p>{emptyMsg}</p>
            </div>
          ) : (
            filteredAlgorithms.map(algo => (
              <div
                key={algo.id}
                className={cn(
                  itemStyles,
                  selectedId === algo.id && itemSelectedStyles
                )}
                onClick={() => handleItemClick(algo.id)}
                onDoubleClick={() => handleItemDoubleClick(algo)}
              >
                <FileCode className={cn(itemIconStyles, 'w-5 h-5')} />
                <div className="flex-1 min-w-0">
                  <div className={itemNameStyles}>{algo.strategyName}</div>
                  {algo.description && (
                    <div className={itemDescStyles}>{algo.description}</div>
                  )}
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

export default AlgorithmSelectorDialog;
