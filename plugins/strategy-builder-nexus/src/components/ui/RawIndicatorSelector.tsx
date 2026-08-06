/**
 * RawIndicatorSelector Component (component20)
 *
 * Card-based raw indicator selector for adding technical indicators.
 * Simplified version of IndicatorSelector (component3) without template/rule logic.
 * Used for raw indicator input in LLM-powered strategy generation.
 *
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_211 - Page 34 - Kronos AI Entry
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PortalDropdown } from './PortalDropdown';
import {
  getIndicatorPrimaryLabel,
  getIndicatorSecondaryLabel,
} from './IndicatorSelector';
import type { IndicatorDefinition, IndicatorParam } from './IndicatorSelector';
import { findDuplicateBlockIds } from '../../services/indicator-duplicate-contract';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

// TICKET_396: OHLCV field options for indicator data source
const OHLCV_FIELD_OPTIONS = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'volume', label: 'Volume' },
] as const;

export interface RawIndicatorBlock {
  id: string;
  indicatorSlug: string | null;
  field: string;
  paramValues: Record<string, number | string>;
}

export interface RawIndicatorSelectorProps {
  /** Component title */
  title?: string;
  /** Available indicators (from JSON) */
  indicators: IndicatorDefinition[];
  /** Current indicator blocks state */
  blocks: RawIndicatorBlock[];
  /** Callback when blocks change */
  onChange: (blocks: RawIndicatorBlock[]) => void;
  /** Add button label */
  addButtonLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_TITLE = 'INDICATOR CONFIGURATION';
const DEFAULT_ADD_LABEL = '+ Add Indicator';

// Generate unique ID
const generateId = (): string => `ind_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

// -----------------------------------------------------------------------------
// Section Title Component
// -----------------------------------------------------------------------------

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-xs font-bold uppercase tracking-wider text-color-terminal-accent-teal mb-3">
    {children}
  </h3>
);

// -----------------------------------------------------------------------------
// RawIndicatorBlockItem Component
// -----------------------------------------------------------------------------

interface RawIndicatorBlockItemProps {
  block: RawIndicatorBlock;
  indicators: IndicatorDefinition[];
  onUpdate: (block: RawIndicatorBlock) => void;
  onDelete: (id: string) => void;
  /** TICKET_1227: block collides with a sibling (same indicator + config) */
  isDuplicate: boolean;
}

const RawIndicatorBlockItem: React.FC<RawIndicatorBlockItemProps> = ({
  block,
  indicators,
  onUpdate,
  onDelete,
  isDuplicate,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [isIndicatorOpen, setIsIndicatorOpen] = useState(false);
  const indicatorTriggerRef = useRef<HTMLButtonElement>(null);

  // Filter to only show usable indicators
  const availableIndicators = useMemo(() => {
    return indicators;
  }, [indicators]);

  // Get selected indicator definition
  const selectedIndicator = useMemo(() => {
    return indicators.find(ind => ind.slug === block.indicatorSlug);
  }, [indicators, block.indicatorSlug]);

  // Handle indicator selection
  const handleSelectIndicator = useCallback((slug: string) => {
    const indicator = indicators.find(ind => ind.slug === slug);
    if (indicator) {
      const defaultParams: Record<string, number | string> = {};
      indicator.params.forEach(param => {
        defaultParams[param.name] = param.default;
      });

      onUpdate({
        ...block,
        indicatorSlug: slug,
        paramValues: defaultParams,
      });
    }
    setIsIndicatorOpen(false);
  }, [indicators, block, onUpdate]);

  // TICKET_396: Handle OHLCV field change
  const handleFieldChange = useCallback((value: string) => {
    onUpdate({
      ...block,
      field: value,
    });
  }, [block, onUpdate]);

  // Handle parameter change
  const handleParamChange = useCallback((paramName: string, value: number | string) => {
    onUpdate({
      ...block,
      paramValues: {
        ...block.paramValues,
        [paramName]: value,
      },
    });
  }, [block, onUpdate]);

  return (
    <div className="border border-color-terminal-border rounded-lg bg-color-terminal-surface/30">
      {/* Card Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-color-terminal-surface/50 border-b border-color-terminal-border">
        <span className="text-sm font-bold text-color-terminal-text">
          {selectedIndicator ? getIndicatorPrimaryLabel(selectedIndicator) : t('ui.rawIndicatorSelector.newIndicator')}
        </span>
        <button
          onClick={() => onDelete(block.id)}
          className="p-1 text-color-terminal-text-muted hover:text-red-500 transition-colors"
          title={t('ui.rawIndicatorSelector.deleteTitle')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {isDuplicate && (
        <p className="px-4 py-2 text-[11px] text-red-400 border-b border-color-terminal-border">
          {t('ui.indicatorSelector.duplicateIndicator')}
        </p>
      )}

      <div className="p-4 space-y-6">
        {/* Indicator Type Dropdown */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
            {t('ui.rawIndicatorSelector.indicatorType')}
          </label>
          <button
            ref={indicatorTriggerRef}
            onClick={() => setIsIndicatorOpen(!isIndicatorOpen)}
            className={cn(
              'w-full flex items-center justify-between',
              'px-4 py-3 text-xs terminal-mono',
              'bg-color-terminal-surface border rounded',
              'text-left',
              'focus:outline-none',
              isIndicatorOpen
                ? 'border-color-terminal-accent-gold'
                : 'border-color-terminal-border',
              selectedIndicator ? 'text-color-terminal-text' : 'text-color-terminal-text-muted'
            )}
          >
            <span className="flex min-w-0 flex-col text-left">
              {selectedIndicator ? (
                <>
                  <span className="truncate text-color-terminal-text">
                    {getIndicatorPrimaryLabel(selectedIndicator)}
                  </span>
                  <span className="truncate text-[10px] text-color-terminal-text-muted">
                    {getIndicatorSecondaryLabel(selectedIndicator)}
                  </span>
                </>
              ) : (
                <span>{t('ui.indicatorConfig.selectIndicator')}</span>
              )}
            </span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', isIndicatorOpen && 'rotate-180')} />
          </button>

          <PortalDropdown
            isOpen={isIndicatorOpen}
            triggerRef={indicatorTriggerRef}
            onClose={() => setIsIndicatorOpen(false)}
          >
            {availableIndicators.map((indicator) => (
              <button
                key={indicator.slug}
                onClick={() => handleSelectIndicator(indicator.slug)}
                className={cn(
                  'w-full px-4 py-2 text-xs text-left terminal-mono',
                  'hover:bg-color-terminal-accent-gold/10',
                  'transition-colors',
                  block.indicatorSlug === indicator.slug
                    ? 'text-color-terminal-accent-gold bg-color-terminal-accent-gold/5'
                    : 'text-color-terminal-text'
                )}
              >
                <span className="block truncate text-color-terminal-text">
                  {getIndicatorPrimaryLabel(indicator)}
                </span>
                <span className="block truncate text-[10px] text-color-terminal-text-muted">
                  {getIndicatorSecondaryLabel(indicator)}
                </span>
              </button>
            ))}
          </PortalDropdown>
        </div>

        {/* TICKET_396: OHLCV Field Selector */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
            {t('ui.rawIndicatorSelector.dataField')}
          </label>
          <select
            value={block.field}
            onChange={(e) => handleFieldChange(e.target.value)}
            className={cn(
              'w-full px-3 py-2 text-xs terminal-mono',
              'border rounded',
              'bg-color-terminal-bg',
              'border-color-terminal-border',
              'text-color-terminal-text',
              'focus:outline-none focus:border-color-terminal-accent-teal'
            )}
          >
            {OHLCV_FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(`ui.ohlcvFields.${opt.value}`, { defaultValue: opt.label })}
              </option>
            ))}
          </select>
        </div>

        {/* PARAMETERS Section */}
        {selectedIndicator && selectedIndicator.params.length > 0 && (
          <div className="space-y-3">
            <SectionTitle>{t('ui.rawIndicatorSelector.parameters')}</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {selectedIndicator.params.map((param) => (
                <div key={param.name} className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
                    {param.label}
                  </label>
                  {param.type === 'select' && param.options ? (
                    <select
                      value={block.paramValues[param.name] ?? param.default}
                      onChange={(e) => handleParamChange(param.name, e.target.value)}
                      className={cn(
                        'w-full px-3 py-2 text-xs terminal-mono',
                        'border rounded',
                        'bg-color-terminal-bg',
                        'border-color-terminal-border',
                        'text-color-terminal-text',
                        'focus:outline-none focus:border-color-terminal-accent-teal'
                      )}
                    >
                      {param.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={param.type === 'number' ? 'number' : 'text'}
                      value={block.paramValues[param.name] ?? param.default}
                      onChange={(e) => {
                        const value = param.type === 'number'
                          ? parseFloat(e.target.value) || 0
                          : e.target.value;
                        handleParamChange(param.name, value);
                      }}
                      className={cn(
                        'w-full px-3 py-2 text-xs terminal-mono',
                        'border rounded',
                        'bg-color-terminal-bg',
                        'border-color-terminal-border',
                        'text-color-terminal-text',
                        'focus:outline-none focus:border-color-terminal-accent-teal'
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// RawIndicatorSelector Component
// -----------------------------------------------------------------------------

export const RawIndicatorSelector: React.FC<RawIndicatorSelectorProps> = ({
  title,
  indicators,
  blocks,
  onChange,
  addButtonLabel,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const componentTitle = title || t('ui.rawIndicatorSelector.title');
  const addLabel = addButtonLabel || t('ui.rawIndicatorSelector.addButton');

  // TICKET_1227: duplicates are born at update time (blocks start blank),
  // so detection runs over the whole list on every change.
  const duplicateIds = useMemo(
    () => findDuplicateBlockIds(blocks, indicators),
    [blocks, indicators]
  );

  // Add new indicator block
  const handleAddBlock = useCallback(() => {
    const newBlock: RawIndicatorBlock = {
      id: generateId(),
      indicatorSlug: null,
      field: 'close',
      paramValues: {},
    };
    onChange([...blocks, newBlock]);
  }, [blocks, onChange]);

  // Update a block
  const handleUpdateBlock = useCallback((updatedBlock: RawIndicatorBlock) => {
    onChange(blocks.map(b => b.id === updatedBlock.id ? updatedBlock : b));
  }, [blocks, onChange]);

  // Delete a block
  const handleDeleteBlock = useCallback((id: string) => {
    onChange(blocks.filter(b => b.id !== id));
  }, [blocks, onChange]);

  return (
    <div className={cn('raw-indicator-selector', className)}>
      {/* Title */}
      <h2 className="text-sm font-bold terminal-mono uppercase tracking-widest text-color-terminal-accent-gold mb-4">
        {componentTitle}
      </h2>

      {/* Indicator Blocks */}
      <div className="space-y-4">
        {blocks.map((block) => (
          <RawIndicatorBlockItem
            key={block.id}
            block={block}
            indicators={indicators}
            onUpdate={handleUpdateBlock}
            onDelete={handleDeleteBlock}
            isDuplicate={duplicateIds.has(block.id)}
          />
        ))}

        {/* Add Indicator Button */}
        <button
          onClick={handleAddBlock}
          className={cn(
            'w-full py-4',
            'border-2 border-dashed border-color-terminal-border rounded-lg',
            'text-color-terminal-text-muted',
            'hover:border-color-terminal-accent-teal hover:text-color-terminal-accent-teal',
            'transition-colors duration-200',
            'flex items-center justify-center gap-2'
          )}
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm font-medium">{addLabel}</span>
        </button>
      </div>
    </div>
  );
};

export default RawIndicatorSelector;
