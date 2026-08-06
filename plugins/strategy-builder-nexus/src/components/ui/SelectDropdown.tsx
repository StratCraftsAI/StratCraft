/**
 * SelectDropdown Component
 *
 * Custom div-based dropdown matching the 077 terminal design language.
 * Uses PortalDropdown to escape overflow clipping contexts.
 *
 * @see TICKET_883_1 - DataSourceSelector 077 Component Unification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PortalDropdown } from './PortalDropdown';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Colored dot rendered after the label (CSS color string, e.g. '#22c55e') */
  statusColor?: string;
  /** Tooltip for the status dot */
  statusTooltip?: string;
}

export interface SelectDropdownProps<T extends string = string> {
  /** Current value */
  value: T;
  /** Change callback */
  onChange: (value: T) => void;
  /** Available options */
  options: ReadonlyArray<SelectOption<T>>;
  /** Placeholder shown when no value is selected */
  placeholder?: string;
  /** Optional label rendered above the trigger */
  label?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Additional CSS classes on the trigger element */
  className?: string;
  /** Test ID for the trigger element */
  testId?: string;
  /** Max height of the dropdown menu in px (default: 240) */
  maxHeight?: number;
}

export function SelectDropdown<T extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  label,
  disabled = false,
  className,
  testId,
  maxHeight,
}: SelectDropdownProps<T>): React.ReactElement {
  const selectId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(opt => opt.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? '';

  const handleToggle = useCallback(() => {
    if (!disabled) setIsOpen(prev => !prev);
  }, [disabled]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleSelect = useCallback(
    (optValue: T) => {
      onChange(optValue);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [disabled],
  );

  const trigger = (
    <button
      ref={triggerRef}
      id={label ? selectId : undefined}
      type="button"
      data-testid={testId}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      className={cn(
        'w-full px-2 py-1.5 text-[13px] text-left',
        'border border-color-terminal-border rounded',
        'bg-color-terminal-surface text-color-terminal-text',
        'focus:outline-none focus:border-color-terminal-accent-teal',
        'transition-colors duration-200',
        'flex items-center justify-between gap-1',
        disabled && 'opacity-50 cursor-not-allowed',
        !selectedOption && 'text-color-terminal-text-muted',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <span className="truncate">{displayLabel}</span>
        {selectedOption?.statusColor && (
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: selectedOption.statusColor }}
            title={selectedOption.statusTooltip}
          />
        )}
      </span>
      <ChevronDown
        size={14}
        className={cn(
          'shrink-0 transition-transform duration-200',
          isOpen && 'rotate-180',
        )}
      />
    </button>
  );

  const dropdown = (
    <PortalDropdown
      isOpen={isOpen}
      triggerRef={triggerRef as React.RefObject<HTMLElement>}
      onClose={handleClose}
      maxHeight={maxHeight}
    >
      {placeholder && (
        <button
          type="button"
          data-testid={testId ? `${testId}-option-placeholder` : undefined}
          onClick={() => handleSelect('' as T)}
          className={cn(
            'w-full px-2 py-1.5 text-[13px] text-left',
            'text-color-terminal-text-muted',
            'hover:bg-color-terminal-accent-teal/20',
            'transition-colors duration-150',
          )}
        >
          {placeholder}
        </button>
      )}
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
          disabled={opt.disabled}
          onClick={() => !opt.disabled && handleSelect(opt.value)}
          className={cn(
            'w-full px-2 py-1.5 text-[13px] text-left',
            'text-color-terminal-text',
            'hover:bg-color-terminal-accent-teal/20',
            'transition-colors duration-150',
            'flex items-center justify-between',
            opt.value === value && 'bg-color-terminal-accent-teal/30',
            opt.disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <span className="truncate">{opt.label}</span>
          {opt.statusColor && (
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: opt.statusColor }}
              title={opt.statusTooltip}
            />
          )}
        </button>
      ))}
    </PortalDropdown>
  );

  const content = (
    <>
      {trigger}
      {dropdown}
    </>
  );

  if (!label) return content as React.ReactElement;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={selectId}
        className="text-[13px] font-medium text-color-terminal-text"
      >
        {label}
      </label>
      {content}
    </div>
  );
}

export default SelectDropdown;
