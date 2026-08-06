/**
 * WorkflowRowSelector Component (component7)
 *
 * Algorithm workflow builder for Zone C variable content area.
 * Displays a row of 4 algorithm selection buttons with stage-level timeframe:
 * - Select Algorithm (Trend-Range) + Timeframe
 * - Pre-condition + Timeframe
 * - Select Steps + Timeframe
 * - Post-condition + Timeframe
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_248 - Stage-Level Timeframe Selector
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { WorkflowDropdown, type AlgorithmOption, type ColorTheme } from './WorkflowDropdown';
import { INTERVAL_1d, INTERVAL_1h } from '@StratCraft/types';
import { TimeframeDropdown, type TimeframeValue } from './TimeframeDropdown';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** TICKET_248: Algorithm selection with stage-level timeframe */
export interface AlgorithmSelection {
  id: number;
  code: string;
  strategyName: string;
  strategyType: number;
  description?: string;
  classificationMetadata?: string;
  /** TICKET_248: Stage-level timeframe for this algorithm */
  timeframe: TimeframeValue;
  /** TICKET_650: C++ compilation status */
  compileStatus?: 'pending' | 'success' | 'error' | null;
}

export interface WorkflowRow {
  id: string;
  rowNumber: number;
  analysisSelections: AlgorithmSelection[];
  preConditionSelections: AlgorithmSelection[];
  stepSelections: AlgorithmSelection[];
  postConditionSelections: AlgorithmSelection[];
}

export interface WorkflowRowSelectorProps {
  /** Component title */
  title?: string;
  /** Current workflow rows data */
  rows: WorkflowRow[];
  /** Callback when rows change */
  onChange: (rows: WorkflowRow[]) => void;
  /** Available algorithms grouped by type */
  algorithms: {
    trendRange: AlgorithmOption[];
    preCondition: AlgorithmOption[];
    selectSteps: AlgorithmOption[];
    postCondition: AlgorithmOption[];
  };
  /** Permanently disable Pre-condition and Post-condition buttons */
  disableConditions?: boolean;
  /** TICKET_077_20: Permanently disable Market Analysis button (for Trader cockpit) */
  disableAnalysis?: boolean;
  /** TICKET_499: Permanently disable Entry Filter (Pre-condition) column (for AI Libero cockpit) */
  disablePreCondition?: boolean;
  /** TICKET_305: Restrict timeframe options to provider-supported intervals */
  allowedIntervals?: TimeframeValue[];
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Default timeframe for new selections */
const DEFAULT_TIMEFRAME: TimeframeValue = INTERVAL_1d;

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// Selection Chips Component (with timeframe display)
// -----------------------------------------------------------------------------

interface SelectionChipsProps {
  selections: AlgorithmSelection[];
  onRemove: (id: number) => void;
  onTimeframeChange: (id: number, timeframe: TimeframeValue) => void;
  theme: ColorTheme;
  disabled?: boolean;
  /** TICKET_305: Restrict timeframe options */
  allowedIntervals?: TimeframeValue[];
}

const SelectionChips: React.FC<SelectionChipsProps> = ({
  selections,
  onRemove,
  onTimeframeChange,
  theme,
  disabled,
  allowedIntervals,
}) => {
  const { t } = useTranslation('backtest');
  if (selections.length === 0) return null;

  const themeClasses: Record<ColorTheme, string> = {
    teal: 'bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal border-color-terminal-accent-teal/30',
    purple: 'bg-color-workflow-purple/10 text-color-workflow-purple border-color-workflow-purple/30',
    blue: 'bg-color-workflow-blue/10 text-color-workflow-blue border-color-workflow-blue/30',
    gold: 'bg-color-workflow-gold/10 text-color-workflow-gold border-color-workflow-gold/30',
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {selections.map((sel) => (
        <div
          key={sel.id}
          className={cn(
            'inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 text-[10px] rounded border',
            themeClasses[theme]
          )}
        >
          {/* Inline timeframe selector */}
          <TimeframeDropdown
            value={sel.timeframe}
            onChange={(tf) => onTimeframeChange(sel.id, tf)}
            allowedValues={allowedIntervals}
            theme={theme}
            disabled={disabled}
            className="!min-w-[40px] !px-1 !py-0.5 !text-[12px] !border-0 !bg-transparent"
          />
          <span className="truncate max-w-[80px]">{sel.strategyName}</span>
          {/* TICKET_650: C++ compile status indicator */}
          {sel.compileStatus === 'success' && (
            <span className="text-color-terminal-accent-teal" title={t('workflow.compiled')}>
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          )}
          {sel.compileStatus === 'error' && (
            <span className="text-color-terminal-accent-red" title={t('workflow.compilationFailed')}>
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            </span>
          )}
          <button
            onClick={() => onRemove(sel.id)}
            className="hover:opacity-70 transition-opacity"
            disabled={disabled}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Algorithm Selector with Timeframe
// -----------------------------------------------------------------------------

interface AlgorithmSelectorWithTimeframeProps {
  label: string;
  options: AlgorithmOption[];
  selections: AlgorithmSelection[];
  onSelectionsChange: (selections: AlgorithmSelection[]) => void;
  theme: ColorTheme;
  disabled?: boolean;
  multiSelect?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  /** Current timeframe for new selections */
  defaultTimeframe: TimeframeValue;
  onDefaultTimeframeChange: (timeframe: TimeframeValue) => void;
  /** TICKET_305: Restrict timeframe options */
  allowedIntervals?: TimeframeValue[];
}

const AlgorithmSelectorWithTimeframe: React.FC<AlgorithmSelectorWithTimeframeProps> = ({
  label,
  options,
  selections,
  onSelectionsChange,
  theme,
  disabled = false,
  multiSelect = true,
  showSearch = true,
  searchPlaceholder,
  defaultTimeframe,
  onDefaultTimeframeChange,
  allowedIntervals,
}) => {
  // Handle algorithm selection change
  const handleAlgorithmChange = useCallback((selectedIds: number[]) => {
    // Find newly added IDs
    const existingIds = new Set(selections.map(s => s.id));
    const newSelections: AlgorithmSelection[] = [];

    for (const id of selectedIds) {
      if (existingIds.has(id)) {
        // Keep existing selection with its timeframe
        const existing = selections.find(s => s.id === id);
        if (existing) {
          newSelections.push(existing);
        }
      } else {
        // Add new selection with default timeframe
        const option = options.find(o => o.id === id);
        if (option) {
          newSelections.push({
            id: option.id,
            code: option.code,
            strategyName: option.strategyName,
            strategyType: option.strategyType,
            description: option.description,
            classificationMetadata: option.classificationMetadata,
            timeframe: defaultTimeframe,
            compileStatus: option.compileStatus,
          });
        }
      }
    }

    onSelectionsChange(newSelections);
  }, [selections, options, defaultTimeframe, onSelectionsChange]);

  // Handle chip removal
  const handleRemoveChip = useCallback((id: number) => {
    onSelectionsChange(selections.filter(s => s.id !== id));
  }, [selections, onSelectionsChange]);

  // Handle timeframe change for a specific selection
  const handleTimeframeChange = useCallback((id: number, timeframe: TimeframeValue) => {
    onSelectionsChange(
      selections.map(s => s.id === id ? { ...s, timeframe } : s)
    );
  }, [selections, onSelectionsChange]);

  return (
    <div className="flex flex-col">
      {/* Row: Timeframe + Algorithm Dropdown */}
      <div className="flex items-stretch gap-1">
        {/* Timeframe selector (for new selections) */}
        <TimeframeDropdown
          value={defaultTimeframe}
          onChange={onDefaultTimeframeChange}
          allowedValues={allowedIntervals}
          theme={theme}
          disabled={disabled}
        />
        {/* Algorithm dropdown */}
        <WorkflowDropdown
          label={label}
          options={options}
          selectedIds={selections.map(s => s.id)}
          onChange={handleAlgorithmChange}
          theme={theme}
          disabled={disabled}
          multiSelect={multiSelect}
          showSearch={showSearch}
          searchPlaceholder={searchPlaceholder}
          className="flex-1"
        />
      </div>
      {/* Selection chips with inline timeframe */}
      <SelectionChips
        selections={selections}
        onRemove={handleRemoveChip}
        onTimeframeChange={handleTimeframeChange}
        theme={theme}
        disabled={disabled}
        allowedIntervals={allowedIntervals}
      />
    </div>
  );
};

// -----------------------------------------------------------------------------
// Single Workflow Row Component
// -----------------------------------------------------------------------------

interface WorkflowRowItemProps {
  row: WorkflowRow;
  algorithms: WorkflowRowSelectorProps['algorithms'];
  onUpdate: (rowId: string, updates: Partial<WorkflowRow>) => void;
  disableConditions?: boolean;
  disableAnalysis?: boolean;
  disablePreCondition?: boolean;
  t: (key: string) => string;
  /** TICKET_305: Restrict timeframe options */
  allowedIntervals?: TimeframeValue[];
}

const WorkflowRowItem: React.FC<WorkflowRowItemProps> = ({
  row,
  algorithms,
  onUpdate,
  disableConditions,
  disableAnalysis,
  disablePreCondition,
  t,
  allowedIntervals,
}) => {
  // TICKET_248: Track default timeframe for each column (used when adding new selections)
  // TICKET_257: Different defaults for different stages (regime=1d, entry/exit=1h)
  const [defaultTimeframes, setDefaultTimeframes] = useState<{
    analysis: TimeframeValue;
    preCondition: TimeframeValue;
    steps: TimeframeValue;
    postCondition: TimeframeValue;
  }>({
    analysis: INTERVAL_1d,      // Regime detection typically on higher timeframe
    preCondition: INTERVAL_1h,  // Entry filter on lower timeframe
    steps: INTERVAL_1h,         // Entry signal on lower timeframe
    postCondition: INTERVAL_1h, // Exit on lower timeframe
  });

  const handleSelectionsChange = useCallback((
    column: 'analysis' | 'preCondition' | 'steps' | 'postCondition',
    selections: AlgorithmSelection[]
  ) => {
    const updateKey = {
      analysis: 'analysisSelections',
      preCondition: 'preConditionSelections',
      steps: 'stepSelections',
      postCondition: 'postConditionSelections',
    }[column] as keyof WorkflowRow;

    onUpdate(row.id, { [updateKey]: selections });
  }, [row.id, onUpdate]);

  // TICKET_380: When step-level timeframe changes, propagate to ALL existing selections in that column
  const handleDefaultTimeframeChange = useCallback((
    column: 'analysis' | 'preCondition' | 'steps' | 'postCondition',
    timeframe: TimeframeValue
  ) => {
    setDefaultTimeframes(prev => ({ ...prev, [column]: timeframe }));

    // TICKET_380: Update existing algorithm selections to use new timeframe
    const selectionKey = {
      analysis: 'analysisSelections',
      preCondition: 'preConditionSelections',
      steps: 'stepSelections',
      postCondition: 'postConditionSelections',
    }[column] as keyof WorkflowRow;

    const currentSelections = row[selectionKey] as AlgorithmSelection[];
    if (currentSelections.length > 0) {
      const updated = currentSelections.map(s => ({ ...s, timeframe }));
      onUpdate(row.id, { [selectionKey]: updated });
    }
  }, [row, onUpdate]);

  // Pre-condition (Entry Filter):
  // - If disablePreCondition is true (AI Libero mode), always disabled
  // - If disableAnalysis is true (trader mode), always enabled (independent of Market Analysis)
  // - Otherwise, enabled when algorithm is selected (respects disableConditions)
  const preConditionEnabled = disablePreCondition ? false : (disableAnalysis ? true : (disableConditions ? false : row.analysisSelections.length > 0));
  // Post-condition: enabled when step is selected (independent of disableConditions)
  const postConditionEnabled = row.stepSelections.length > 0;

  return (
    <div className="border border-color-terminal-border rounded-lg bg-color-terminal-surface/20 p-4 mb-4">
      {/* 4 Columns: [TF][Algorithm] for each */}
      <div className="flex flex-row gap-3 w-full">
        {/* Select Algorithm (Market Analysis) - wide (3 units) */}
        <div className="flex-[3]">
          <AlgorithmSelectorWithTimeframe
            label={t('workflowSelector.selectAlgorithm')}
            options={algorithms.trendRange}
            selections={row.analysisSelections}
            onSelectionsChange={(sel) => handleSelectionsChange('analysis', sel)}
            theme="teal"
            disabled={disableAnalysis}
            multiSelect={true}
            showSearch={true}
            searchPlaceholder={t('workflowSelector.search')}
            defaultTimeframe={defaultTimeframes.analysis}
            onDefaultTimeframeChange={(tf) => handleDefaultTimeframeChange('analysis', tf)}
            allowedIntervals={allowedIntervals}
          />
        </div>

        {/* Pre-condition - narrow (2 units) */}
        <div className="flex-[2]">
          <AlgorithmSelectorWithTimeframe
            label={t('workflowSelector.preCondition')}
            options={algorithms.preCondition}
            selections={row.preConditionSelections}
            onSelectionsChange={(sel) => handleSelectionsChange('preCondition', sel)}
            theme="purple"
            disabled={!preConditionEnabled}
            multiSelect={false}
            showSearch={false}
            defaultTimeframe={defaultTimeframes.preCondition}
            onDefaultTimeframeChange={(tf) => handleDefaultTimeframeChange('preCondition', tf)}
            allowedIntervals={allowedIntervals}
          />
        </div>

        {/* Select Steps - wide (3 units) */}
        <div className="flex-[3]">
          <AlgorithmSelectorWithTimeframe
            label={t('workflowSelector.selectSteps')}
            options={algorithms.selectSteps}
            selections={row.stepSelections}
            onSelectionsChange={(sel) => handleSelectionsChange('steps', sel)}
            theme="blue"
            multiSelect={true}
            showSearch={true}
            searchPlaceholder={t('workflowSelector.search')}
            defaultTimeframe={defaultTimeframes.steps}
            onDefaultTimeframeChange={(tf) => handleDefaultTimeframeChange('steps', tf)}
            allowedIntervals={allowedIntervals}
          />
        </div>

        {/* Post-condition - narrow (2 units) */}
        <div className="flex-[2]">
          <AlgorithmSelectorWithTimeframe
            label={t('workflowSelector.postCondition')}
            options={algorithms.postCondition}
            selections={row.postConditionSelections}
            onSelectionsChange={(sel) => handleSelectionsChange('postCondition', sel)}
            theme="gold"
            disabled={!postConditionEnabled}
            multiSelect={false}
            showSearch={false}
            defaultTimeframe={defaultTimeframes.postCondition}
            onDefaultTimeframeChange={(tf) => handleDefaultTimeframeChange('postCondition', tf)}
            allowedIntervals={allowedIntervals}
          />
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// WorkflowRowSelector Component
// -----------------------------------------------------------------------------

export const WorkflowRowSelector: React.FC<WorkflowRowSelectorProps> = ({
  title,
  rows,
  onChange,
  algorithms,
  disableConditions = false,
  disableAnalysis = false,
  disablePreCondition = false,
  allowedIntervals,
  className,
}) => {
  const { t } = useTranslation('backtest');
  const displayTitle = title || t('page.workflowTitle');

  const updateRow = useCallback(
    (rowId: string, updates: Partial<WorkflowRow>) => {
      onChange(rows.map((row) =>
        row.id === rowId ? { ...row, ...updates } : row
      ));
    },
    [rows, onChange]
  );

  const row = rows[0];
  if (!row) return null;

  return (
    <div className={cn('workflow-row-selector w-full', className)}>
      {/* Title */}
      <h2 className="text-sm font-bold terminal-mono uppercase tracking-widest text-color-terminal-accent-gold mb-4">
        {displayTitle}
      </h2>

      {/* Single Workflow Row */}
      <WorkflowRowItem
        key={row.id}
        row={row}
        algorithms={algorithms}
        onUpdate={updateRow}
        disableConditions={disableConditions}
        disableAnalysis={disableAnalysis}
        disablePreCondition={disablePreCondition}
        t={t}
        allowedIntervals={allowedIntervals}
      />
    </div>
  );
};

export default WorkflowRowSelector;
