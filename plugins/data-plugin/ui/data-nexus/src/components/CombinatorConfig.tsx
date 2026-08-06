/**
 * Combinator Config Component (Tier 0 shared)
 *
 * TICKET_077_31: Extracted from SignalFactorySection for cross-plugin consumption.
 * TICKET_250_11: Configure signal combination method.
 * TICKET_880_3_3 (G4): Nine fusion methods (FACTOR_COMBINATOR_METHODS).
 *
 * Grid layout with icons — matches Alpha Factory's method selector.
 */

import React from 'react';

// =============================================================================
// Types
// =============================================================================

export interface CombinatorConfigType {
  method: string;
  params: Record<string, unknown>;
}

export interface CombinatorMethodOption {
  id: string;
  nameKey: string;
  descriptionKey: string;
}

export interface CombinatorConfigProps {
  config: CombinatorConfigType;
  onChange: (config: CombinatorConfigType) => void;
  t: (key: string) => string;
  readOnly?: boolean;
  methods?: CombinatorMethodOption[];
}

// =============================================================================
// Default methods (FACTOR_COMBINATOR_METHODS from quant-lab constants)
// =============================================================================

const DEFAULT_METHODS: CombinatorMethodOption[] = [
  { id: 'equal_weight', nameKey: 'combinatorMethods.factor.equalWeight', descriptionKey: 'combinatorMethods.factor.equalWeightDesc' },
  { id: 'ic_weighted', nameKey: 'combinatorMethods.factor.icWeighted', descriptionKey: 'combinatorMethods.factor.icWeightedDesc' },
  { id: 'ic_signed', nameKey: 'combinatorMethods.factor.icSigned', descriptionKey: 'combinatorMethods.factor.icSignedDesc' },
  { id: 'regression', nameKey: 'combinatorMethods.factor.regression', descriptionKey: 'combinatorMethods.factor.regressionDesc' },
  { id: 'pca', nameKey: 'combinatorMethods.factor.pca', descriptionKey: 'combinatorMethods.factor.pcaDesc' },
  { id: 'handcraft', nameKey: 'combinatorMethods.factor.handcraft', descriptionKey: 'combinatorMethods.factor.handcraftDesc' },
  { id: 'hrp', nameKey: 'combinatorMethods.factor.hrp', descriptionKey: 'combinatorMethods.factor.hrpDesc' },
  { id: 'optimal', nameKey: 'combinatorMethods.factor.optimal', descriptionKey: 'combinatorMethods.factor.optimalDesc' },
  { id: 'kelly', nameKey: 'combinatorMethods.factor.kelly', descriptionKey: 'combinatorMethods.factor.kellyDesc' },
];

// =============================================================================
// Icons (inline SVG to avoid lucide-react dependency at Tier 0)
// =============================================================================

const ICON_PATHS: Record<string, string> = {
  equal_weight: 'M3 6h4v12H3V6zm7-2h4v14h-4V4zm7 4h4v10h-4V8z',
  ic_weighted: 'M3 12h4v6H3v-6zm7-4h4v10h-4V8zm7-4h4v14h-4V4z',
  ic_signed: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  regression: 'M22 7L13.5 15.5 8.5 10.5 2 17',
  pca: 'M5.5 8.5L9 12l-3.5 3.5L2 12l3.5-3.5zM12 2l3.5 3.5L12 9 8.5 5.5 12 2zM18.5 8.5L22 12l-3.5 3.5L15 12l3.5-3.5zM12 15l3.5 3.5L12 22l-3.5-3.5L12 15z',
  handcraft: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  hrp: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  optimal: 'M12 3l1.5 4.5H18l-3.6 2.7 1.4 4.3L12 12l-3.8 2.5 1.4-4.3L6 7.5h4.5L12 3z',
  kelly: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-14v4l3 3',
};

function MethodIcon({ methodId, selected, readOnly }: { methodId: string; selected: boolean; readOnly: boolean }): JSX.Element {
  const path = ICON_PATHS[methodId] ?? ICON_PATHS.equal_weight;
  const colorClass = readOnly
    ? (selected ? 'text-color-terminal-accent-primary' : 'text-color-terminal-text-muted')
    : (selected ? 'text-color-terminal-accent-primary' : 'text-white');

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 ${colorClass}`}
    >
      <path d={path} />
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

export const CombinatorConfig: React.FC<CombinatorConfigProps> = ({
  config,
  onChange,
  t,
  readOnly = false,
  methods = DEFAULT_METHODS,
}) => {
  const handleMethodChange = (methodId: string) => {
    try { (window as any).electronAPI?.log?.('warn', 'CombinatorConfig', `method clicked=${methodId} readOnly=${readOnly}`); } catch (_) { /* noop */ }
    if (readOnly) return;
    if (methods.some(m => m.id === methodId)) {
      onChange({ method: methodId, params: {} });
    }
  };

  return (
    <div className="grid grid-cols-4 gap-2">
      {methods.map(method => {
        const isSelected = config.method === method.id;
        return (
          <button
            key={method.id}
            type="button"
            disabled={readOnly && !isSelected}
            onClick={() => handleMethodChange(method.id)}
            title={t(method.descriptionKey)}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all',
              'border focus:outline-none',
              isSelected
                ? 'border-color-terminal-accent-primary bg-color-terminal-accent-primary/15 text-color-terminal-accent-primary font-semibold'
                : readOnly
                  ? 'border-color-terminal-border/30 bg-color-terminal-surface/20 text-color-terminal-text-muted opacity-40 cursor-default'
                  : 'border-color-terminal-border/60 bg-color-terminal-surface/40 text-white hover:border-color-terminal-text-secondary/50 hover:bg-color-terminal-surface/70 cursor-pointer',
            ].join(' ')}
          >
            <MethodIcon methodId={method.id} selected={isSelected} readOnly={readOnly} />
            <span className="truncate">{t(method.nameKey)}</span>
          </button>
        );
      })}
    </div>
  );
};
