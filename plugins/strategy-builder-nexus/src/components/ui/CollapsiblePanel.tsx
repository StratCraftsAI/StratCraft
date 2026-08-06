/**
 * CollapsiblePanel Component
 *
 * Expandable/collapsible panel wrapper with header.
 * Used to organize optional or advanced settings.
 *
 * @see TICKET_077_15 - CollapsiblePanel Specification
 * @see TICKET_077 - StratCraftsAI UI Component Library (component15)
 */

import React, { useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type BadgeVariant = 'default' | 'success' | 'warning';

export interface CollapsiblePanelProps {
  /** Panel title */
  title: string;
  /** Optional badge text */
  badge?: string;
  /** Badge variant */
  badgeVariant?: BadgeVariant;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Initial expanded state (uncontrolled mode) */
  defaultExpanded?: boolean;
  /** Controlled expanded state */
  expanded?: boolean;
  /** Expand change callback (for controlled mode) */
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * TICKET_077_27: resolved display of the current selection, shown inline in
   * the collapsed header next to the title (e.g. "S&P 500 Top 50"). `null` /
   * empty means "no selection yet" and the header shows just the title. Has no
   * effect while expanded.
   */
  selectionLabel?: string | null;
  /**
   * TICKET_077_27: when provided together with a non-empty `selectionLabel`,
   * renders a "Change" link in the collapsed header that re-expands the panel.
   * Lets the panel act as a Layer-1 "summary + Change" affordance, replacing the
   * bespoke CollapsibleSection in the Parameter Sweep tab.
   */
  onChange?: () => void;
  /** Label for the Change link (default: "Change"). */
  changeLabel?: string;
  /**
   * TICKET_077_27: keep children mounted when collapsed (renders them with
   * `display:none` instead of the grid-rows collapse). Use when unmounting the
   * subtree would re-trigger expensive work on re-expand (e.g. the Tool Sweep
   * pickers re-fetching `signalDiscovery.listTemplates()`). Default false
   * preserves the original grid-rows animation behaviour.
   */
  keepMounted?: boolean;
  /**
   * TICKET_077_27: optional `data-testid` stamped on the panel root, so callers
   * migrating from a bespoke collapsible (which carried its own testids) keep a
   * stable hook for integration tests.
   */
  testId?: string;
  /**
   * TICKET_077_27: optional `data-testid` stamped on the header toggle button.
   * Lets callers preserve a click-target pin (e.g. "single-asset-toggle") when
   * migrating a bespoke disclosure to this primitive.
   */
  headerTestId?: string;
  /** Panel children */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Badge Variant Styles
// -----------------------------------------------------------------------------

const badgeVariantStyles: Record<BadgeVariant, string> = {
  default: 'bg-color-terminal-accent-teal text-color-terminal-bg',
  success: 'bg-green-500 text-white',
  warning: 'bg-color-terminal-accent-gold text-color-terminal-bg',
};

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const CollapsiblePanel: React.FC<CollapsiblePanelProps> = ({
  title,
  badge,
  badgeVariant = 'default',
  subtitle,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  selectionLabel,
  onChange,
  changeLabel = 'Change',
  keepMounted = false,
  testId,
  headerTestId,
  children,
  className,
}) => {
  // Internal state for uncontrolled mode
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  // Determine if controlled or uncontrolled
  const isControlled = controlledExpanded !== undefined;
  const isExpanded = isControlled ? controlledExpanded : internalExpanded;

  // Handle toggle
  const handleToggle = useCallback(() => {
    const newState = !isExpanded;

    if (!isControlled) {
      setInternalExpanded(newState);
    }

    onExpandedChange?.(newState);
  }, [isExpanded, isControlled, onExpandedChange]);

  // TICKET_077_27: the collapsed-header "Change" link is a real interactive
  // control, so it cannot nest inside the header <button> (invalid HTML). It is
  // rendered as a sibling absolutely beside the toggle. Shown only when the
  // panel is collapsed AND a selection + onChange handler are both present.
  const showChangeLink = !isExpanded && !!selectionLabel && !!onChange;

  const handleChangeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Re-expand so the user lands in the editor, then notify the caller.
      if (!isControlled) {
        setInternalExpanded(true);
      }
      onExpandedChange?.(true);
      onChange?.();
    },
    [isControlled, onExpandedChange, onChange]
  );

  return (
    <div
      data-testid={testId}
      className={cn(
        'border border-color-terminal-border rounded-lg',
        'bg-color-terminal-surface overflow-hidden',
        className
      )}
    >
      {/* Header row -- the toggle button + an optional sibling Change link */}
      <div className="relative">
        <button
          type="button"
          data-testid={headerTestId}
          onClick={handleToggle}
          className={cn(
            'w-full flex flex-col p-3',
            'cursor-pointer select-none',
            'hover:bg-white/[0.02] transition-colors duration-200',
            'text-left'
          )}
          aria-expanded={isExpanded}
        >
          {/* Title Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-bold text-color-terminal-text">
                {title}
              </span>
              {badge && (
                <span
                  className={cn(
                    'px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide rounded',
                    badgeVariantStyles[badgeVariant]
                  )}
                >
                  {badge}
                </span>
              )}
              {/* TICKET_077_27: collapsed-state selection summary (read-only
                  text -- safe inside the button). The Change link beside it is
                  a separate control rendered outside this button. */}
              {!isExpanded && selectionLabel && (
                <span className="text-[13px] text-color-terminal-text-muted truncate">
                  {selectionLabel}
                </span>
              )}
            </div>
            <ChevronDown
              className={cn(
                'w-4 h-4 text-color-terminal-text-muted flex-shrink-0',
                'transition-transform duration-300',
                isExpanded && 'rotate-180',
                // Leave room for the Change link when it is shown.
                showChangeLink && 'mr-14'
              )}
            />
          </div>

          {/* Subtitle */}
          {subtitle && (
            <p className="text-xs text-color-terminal-text-muted mt-1">
              {subtitle}
            </p>
          )}
        </button>

        {showChangeLink && (
          <button
            type="button"
            onClick={handleChangeClick}
            className={cn(
              'absolute top-3 right-9',
              'text-xs underline text-color-terminal-accent-teal',
              'hover:opacity-80 transition-opacity'
            )}
          >
            {changeLabel}
          </button>
        )}
      </div>

      {/* Content. Default: CSS-grid collapse animation (unmount-style -- the
          0fr row clips the subtree). keepMounted: render with display:none so
          the subtree is never torn down (TICKET_077_27 -- avoids re-triggering
          expensive work on re-expand). */}
      {keepMounted ? (
        <div
          style={{ display: isExpanded ? 'block' : 'none' }}
          aria-hidden={!isExpanded}
        >
          <div className="p-4 border-t border-color-terminal-border">
            {children}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-300 ease-out',
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="p-4 border-t border-color-terminal-border">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollapsiblePanel;
