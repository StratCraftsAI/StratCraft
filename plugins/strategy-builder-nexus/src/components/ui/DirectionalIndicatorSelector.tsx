/**
 * DirectionalIndicatorSelector Component (component4)
 *
 * Directional indicator selector with Long/Short toggle per block.
 * Similar to IndicatorSelector but requires direction selection before
 * showing indicator configuration. Used for Entry Signal pages.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_078 - Input Theming and Portal Patterns
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { THEME_COLORS } from '@shared/constants/colors';
import { PortalDropdown } from './PortalDropdown';
import {
  getIndicatorPrimaryLabel,
  getIndicatorSecondaryLabel,
} from './IndicatorSelector';
import type { IndicatorDefinition, StrategyTemplate, IndicatorParam } from './IndicatorSelector';
import { findDuplicateBlockIds } from '../../services/indicator-duplicate-contract';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type TradeDirection = 'long' | 'short';

export interface DirectionalIndicatorBlock {
  id: string;
  direction: TradeDirection | null;
  indicatorSlug: string | null;
  paramValues: Record<string, number | string>;
  templateKey: string | null;
  ruleOperator: string;
  ruleThresholdValue: number;
}

export interface DirectionalIndicatorSelectorProps {
  /** Component title */
  title?: string;
  /** Available indicator definitions */
  indicators: IndicatorDefinition[];
  /** Strategy templates library */
  templates: Record<string, StrategyTemplate>;
  /** Current indicator blocks */
  blocks: DirectionalIndicatorBlock[];
  /** Callback when blocks change */
  onChange: (blocks: DirectionalIndicatorBlock[]) => void;
  /** Add button label */
  addButtonLabel?: string;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_TITLE = 'ENTRY SIGNAL CONFIGURATION';
const DEFAULT_ADD_BUTTON_LABEL = '+ Add Entry Signal';

// -----------------------------------------------------------------------------
// Section Title Component
// -----------------------------------------------------------------------------

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-xs font-bold uppercase tracking-wider text-color-terminal-accent-teal mb-3">
    {children}
  </h3>
);

// -----------------------------------------------------------------------------
// DirectionalIndicatorBlockItem Component
// -----------------------------------------------------------------------------

interface DirectionalBlockItemProps {
  block: DirectionalIndicatorBlock;
  indicators: IndicatorDefinition[];
  templates: Record<string, StrategyTemplate>;
  onUpdate: (block: DirectionalIndicatorBlock) => void;
  onDelete: (id: string) => void;
  /** TICKET_1227: block collides with a sibling (same indicator + config) */
  isDuplicate: boolean;
}

const DirectionalBlockItem: React.FC<DirectionalBlockItemProps> = ({
  block,
  indicators,
  templates,
  onUpdate,
  onDelete,
  isDuplicate,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [isIndicatorOpen, setIsIndicatorOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [isOperatorOpen, setIsOperatorOpen] = useState(false);

  const indicatorTriggerRef = useRef<HTMLButtonElement>(null);
  const templateTriggerRef = useRef<HTMLButtonElement>(null);
  const operatorTriggerRef = useRef<HTMLButtonElement>(null);

  // Filter to only show usable indicators
  const availableIndicators = useMemo(() => {
    return indicators;
  }, [indicators]);

  // Get selected indicator definition
  const selectedIndicator = useMemo(() => {
    return indicators.find(ind => ind.slug === block.indicatorSlug);
  }, [indicators, block.indicatorSlug]);

  // Get available templates for selected indicator
  const availableTemplates = useMemo(() => {
    if (!selectedIndicator?.template_keys) return [];
    return selectedIndicator.template_keys
      .filter(key => templates[key])
      .map(key => ({ key, ...templates[key] }));
  }, [selectedIndicator, templates]);

  // Get selected template
  const selectedTemplate = useMemo(() => {
    if (!block.templateKey || !templates[block.templateKey]) return null;
    return templates[block.templateKey];
  }, [block.templateKey, templates]);

  // Handle direction selection
  const handleSelectDirection = useCallback((direction: TradeDirection) => {
    onUpdate({ ...block, direction });
  }, [block, onUpdate]);

  // Handle indicator selection
  const handleSelectIndicator = useCallback((slug: string) => {
    const indicator = indicators.find(ind => ind.slug === slug);
    if (indicator) {
      const defaultParams: Record<string, number | string> = {};
      indicator.params.forEach((param: IndicatorParam) => {
        defaultParams[param.name] = param.default;
      });

      const firstTemplateKey = indicator.template_keys?.[0] || null;
      const firstTemplate = firstTemplateKey ? templates[firstTemplateKey] : null;

      onUpdate({
        ...block,
        indicatorSlug: slug,
        paramValues: defaultParams,
        templateKey: firstTemplateKey,
        ruleOperator: firstTemplate?.default_rule?.operator || '>',
        ruleThresholdValue: firstTemplate?.default_rule?.threshold_value ?? 0,
      });
    }
    setIsIndicatorOpen(false);
  }, [indicators, templates, block, onUpdate]);

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

  // Handle template selection
  const handleSelectTemplate = useCallback((templateKey: string) => {
    const template = templates[templateKey];
    onUpdate({
      ...block,
      templateKey,
      ruleOperator: template?.default_rule?.operator || '>',
      ruleThresholdValue: template?.default_rule?.threshold_value ?? 0,
    });
    setIsTemplateOpen(false);
  }, [templates, block, onUpdate]);

  // Handle operator change
  const handleSelectOperator = useCallback((operator: string) => {
    onUpdate({ ...block, ruleOperator: operator });
    setIsOperatorOpen(false);
  }, [block, onUpdate]);

  // Handle threshold change
  const handleThresholdChange = useCallback((value: number) => {
    onUpdate({ ...block, ruleThresholdValue: value });
  }, [block, onUpdate]);

  return (
    <div className="border border-color-terminal-border rounded-lg bg-color-terminal-surface/30">
      {/* Card Header with Direction Toggle */}
      <div className="flex items-center justify-between px-4 py-3 bg-color-terminal-surface/50 border-b border-color-terminal-border">
        <span className="text-sm font-bold text-color-terminal-text">
          {selectedIndicator
            ? getIndicatorPrimaryLabel(selectedIndicator)
            : t('ui.directionalIndicatorSelector.selectIndicator')}
        </span>

        <div className="flex items-center gap-3">
          {/* Direction Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => handleSelectDirection('long')}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold',
                'border transition-all duration-200',
                block.direction === 'long'
                  ? 'border-green-500 text-green-500 bg-green-500/10'
                  : 'border-color-terminal-border text-color-terminal-text-muted hover:border-green-500/50 hover:text-green-500/70'
              )}
            >
              <TrendingUp className="w-3 h-3" />
              {t('ui.directionalIndicatorSelector.long')}
            </button>
            <button
              onClick={() => handleSelectDirection('short')}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold',
                'border transition-all duration-200',
                block.direction === 'short'
                  ? 'border-red-500 text-red-500 bg-red-500/10'
                  : 'border-color-terminal-border text-color-terminal-text-muted hover:border-red-500/50 hover:text-red-500/70'
              )}
            >
              <TrendingDown className="w-3 h-3" />
              {t('ui.directionalIndicatorSelector.short')}
            </button>
          </div>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(block.id)}
            className="p-1 text-color-terminal-text-muted hover:text-red-500 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isDuplicate && (
        <p className="px-4 py-2 text-[11px] text-red-400 border-b border-color-terminal-border">
          {t('ui.indicatorSelector.duplicateIndicator')}
        </p>
      )}

      {/* Card Content */}
      {block.direction === null ? (
        /* Direction Not Selected - Show Placeholder */
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            <TrendingDown className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-sm text-color-terminal-text-muted">
            {t('ui.directionalIndicatorSelector.selectDirectionFirst')}
          </p>
        </div>
      ) : (
        /* Direction Selected - Show Indicator Configuration */
        <div className="p-4 space-y-6">
          {/* Indicator Type Dropdown */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('ui.directionalIndicatorSelector.indicatorType')}
            </label>
            <button
              ref={indicatorTriggerRef}
              onClick={() => setIsIndicatorOpen(!isIndicatorOpen)}
              aria-expanded={isIndicatorOpen}
              aria-haspopup="listbox"
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
                    <span>{t('ui.directionalIndicatorSelector.selectIndicatorPlaceholder')}</span>
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

          {/* PARAMETERS Section */}
          {selectedIndicator && selectedIndicator.params.length > 0 && (
            <div className="space-y-3">
              <SectionTitle>{t('ui.directionalIndicatorSelector.parameters')}</SectionTitle>
              <div className="space-y-3">
                {selectedIndicator.params.map((param: IndicatorParam) => (
                  <div key={param.name} className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
                      {param.label}
                    </label>
                    {param.type === 'select' && param.options ? (
                      <select
                        value={block.paramValues[param.name] ?? param.default}
                        onChange={(e) => handleParamChange(param.name, e.target.value)}
                        className="w-full px-4 py-3 text-xs terminal-mono border rounded focus:outline-none"
                        style={{
                          backgroundColor: THEME_COLORS.INPUT_BG,
                          borderColor: THEME_COLORS.INPUT_BORDER,
                          color: THEME_COLORS.INPUT_TEXT,
                        }}
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
                        className="w-full px-4 py-3 text-xs terminal-mono border rounded focus:outline-none"
                        style={{
                          backgroundColor: THEME_COLORS.INPUT_BG,
                          borderColor: THEME_COLORS.INPUT_BORDER,
                          color: THEME_COLORS.INPUT_TEXT,
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STRATEGY TEMPLATE Section */}
          {selectedIndicator && availableTemplates.length > 0 && (
            <div className="space-y-3">
              <SectionTitle>{t('ui.directionalIndicatorSelector.strategyTemplate')}</SectionTitle>

              {/* Template Type Dropdown */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
                  {t('ui.directionalIndicatorSelector.templateType')}
                </label>
                <button
                  ref={templateTriggerRef}
                  onClick={() => setIsTemplateOpen(!isTemplateOpen)}
                  aria-expanded={isTemplateOpen}
                  aria-haspopup="listbox"
                  className={cn(
                    'w-full flex items-center justify-between',
                    'px-4 py-3 text-xs terminal-mono',
                    'bg-color-terminal-surface border rounded',
                    'text-left text-color-terminal-text',
                    'focus:outline-none',
                    isTemplateOpen
                      ? 'border-color-terminal-accent-gold'
                      : 'border-color-terminal-border'
                  )}
                >
                  <span>{selectedTemplate?.label || t('ui.directionalIndicatorSelector.selectTemplate')}</span>
                  <ChevronDown className={cn('w-4 h-4 transition-transform', isTemplateOpen && 'rotate-180')} />
                </button>

                <PortalDropdown
                  isOpen={isTemplateOpen}
                  triggerRef={templateTriggerRef}
                  onClose={() => setIsTemplateOpen(false)}
                >
                  {availableTemplates.map((template) => (
                    <button
                      key={template.key}
                      onClick={() => handleSelectTemplate(template.key)}
                      className={cn(
                        'w-full px-4 py-2 text-xs text-left terminal-mono',
                        'hover:bg-color-terminal-accent-gold/10',
                        'transition-colors',
                        block.templateKey === template.key
                          ? 'text-color-terminal-accent-gold bg-color-terminal-accent-gold/5'
                          : 'text-color-terminal-text'
                      )}
                    >
                      {template.label}
                    </button>
                  ))}
                </PortalDropdown>
              </div>

              {/* Template Info Box */}
              {selectedTemplate && (
                <div className="p-3 border-l-2 border-color-terminal-accent-teal bg-color-terminal-surface/50 rounded-r text-xs space-y-1">
                  <div>
                    <span className="text-color-terminal-accent-teal font-bold">{t('ui.directionalIndicatorSelector.templateInfoType')}</span>
                    <span className="ml-2 text-color-terminal-text">{selectedTemplate.type}</span>
                  </div>
                  <div>
                    <span className="text-color-terminal-accent-teal font-bold">{t('ui.directionalIndicatorSelector.templateInfoDesc')}</span>
                    <span className="ml-2 text-color-terminal-text-secondary">{selectedTemplate.description}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RULE LOGIC Section */}
          {selectedIndicator && selectedTemplate && (
            <div className="space-y-3">
              <SectionTitle>{t('ui.directionalIndicatorSelector.ruleLogic')}</SectionTitle>

              {/* When Indicator Dropdown */}
              {selectedTemplate.rule_options?.operators && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
                    {t('ui.directionalIndicatorSelector.whenIndicator')}
                  </label>
                  <button
                    ref={operatorTriggerRef}
                    onClick={() => setIsOperatorOpen(!isOperatorOpen)}
                    aria-expanded={isOperatorOpen}
                    aria-haspopup="listbox"
                    className={cn(
                      'w-full flex items-center justify-between',
                      'px-4 py-3 text-xs terminal-mono',
                      'bg-color-terminal-surface border rounded',
                      'text-left text-color-terminal-text',
                      'focus:outline-none',
                      isOperatorOpen
                        ? 'border-color-terminal-accent-gold'
                        : 'border-color-terminal-border'
                    )}
                  >
                    <span>
                      {selectedTemplate.rule_options.operators.find(op => op.value === block.ruleOperator)?.label || t('ui.directionalIndicatorSelector.selectOperator')}
                    </span>
                    <ChevronDown className={cn('w-4 h-4 transition-transform', isOperatorOpen && 'rotate-180')} />
                  </button>

                  <PortalDropdown
                    isOpen={isOperatorOpen}
                    triggerRef={operatorTriggerRef}
                    onClose={() => setIsOperatorOpen(false)}
                  >
                    {selectedTemplate.rule_options.operators.map((op) => (
                      <button
                        key={op.value}
                        onClick={() => handleSelectOperator(op.value)}
                        className={cn(
                          'w-full px-4 py-2 text-xs text-left terminal-mono',
                          'hover:bg-color-terminal-accent-gold/10',
                          'transition-colors',
                          block.ruleOperator === op.value
                            ? 'text-color-terminal-accent-gold bg-color-terminal-accent-gold/5'
                            : 'text-color-terminal-text'
                        )}
                      >
                        {op.label}
                      </button>
                    ))}
                  </PortalDropdown>
                </div>
              )}

              {/* Threshold Value Input */}
              {(selectedTemplate.type === 'threshold_level' || selectedTemplate.default_rule?.threshold_value !== undefined) && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
                    {t('ui.directionalIndicatorSelector.thresholdValue')}
                  </label>
                  <input
                    type="number"
                    min={-1_000_000}
                    max={1_000_000}
                    value={block.ruleThresholdValue}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) handleThresholdChange(Math.max(-1_000_000, Math.min(1_000_000, v)));
                    }}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      handleThresholdChange(Number.isFinite(v) ? Math.max(-1_000_000, Math.min(1_000_000, v)) : 0);
                    }}
                    className="w-full px-4 py-3 text-xs terminal-mono border rounded focus:outline-none"
                    style={{
                      backgroundColor: THEME_COLORS.INPUT_BG,
                      borderColor: THEME_COLORS.INPUT_BORDER,
                      color: THEME_COLORS.INPUT_TEXT,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// DirectionalIndicatorSelector Component
// -----------------------------------------------------------------------------

export const DirectionalIndicatorSelector: React.FC<DirectionalIndicatorSelectorProps> = ({
  title,
  indicators,
  templates,
  blocks,
  onChange,
  addButtonLabel,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const addLabel = addButtonLabel || t('ui.directionalIndicatorSelector.addButton');

  // TICKET_1227: duplicates are born at update time (blocks start blank),
  // so detection runs over the whole list on every change.
  const duplicateIds = useMemo(
    () => findDuplicateBlockIds(blocks, indicators),
    [blocks, indicators]
  );

  // Add new block
  const handleAddBlock = useCallback(() => {
    const newBlock: DirectionalIndicatorBlock = {
      id: `directional-${Date.now()}`,
      direction: null,
      indicatorSlug: null,
      paramValues: {},
      templateKey: null,
      ruleOperator: '>',
      ruleThresholdValue: 0,
    };
    onChange([...blocks, newBlock]);
  }, [blocks, onChange]);

  // Update existing block
  const handleUpdateBlock = useCallback((updatedBlock: DirectionalIndicatorBlock) => {
    onChange(blocks.map(b => b.id === updatedBlock.id ? updatedBlock : b));
  }, [blocks, onChange]);

  // Delete block
  const handleDeleteBlock = useCallback((id: string) => {
    onChange(blocks.filter(b => b.id !== id));
  }, [blocks, onChange]);

  return (
    <div className={cn('directional-indicator-selector', className)}>
      {/* Indicator Blocks */}
      {blocks.length > 0 && (
        <div className="space-y-4 mb-4">
          {blocks.map((block) => (
            <DirectionalBlockItem
              key={block.id}
              block={block}
              indicators={indicators}
              templates={templates}
              onUpdate={handleUpdateBlock}
              onDelete={handleDeleteBlock}
              isDuplicate={duplicateIds.has(block.id)}
            />
          ))}
        </div>
      )}

      {/* Add Entry Signal Button */}
      <button
        onClick={handleAddBlock}
        className={cn(
          'w-full flex items-center justify-center gap-2',
          'px-4 py-3 text-xs font-bold',
          'border border-dashed border-color-terminal-border rounded-lg',
          'text-color-terminal-text-secondary',
          'hover:border-color-terminal-accent-teal/50 hover:text-color-terminal-accent-teal',
          'transition-all duration-200'
        )}
      >
        <Plus className="w-4 h-4" />
        {addLabel}
      </button>
    </div>
  );
};

export default DirectionalIndicatorSelector;
