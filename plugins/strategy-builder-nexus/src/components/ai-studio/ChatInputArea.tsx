/**
 * ChatInputArea Component (component19H)
 *
 * Input area with textarea and action buttons for sending messages.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip, Image } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ChatInputAreaProps {
  /** Current input value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Send message handler */
  onSend: () => void;
  /** Attach image handler */
  onAttachImage?: () => void;
  /** Disabled state */
  disabled?: boolean;
  /** Loading state - shows ESC cancel hint */
  isLoading?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Maximum character length */
  maxLength?: number;
  /** Minimum rows */
  minRows?: number;
  /** Maximum rows */
  maxRows?: number;
  /** Show character count */
  showCharCount?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  value,
  onChange,
  onSend,
  onAttachImage,
  disabled = false,
  isLoading = false,
  placeholder,
  maxLength = 5000,
  minRows = 3,
  maxRows = 8,
  showCharCount = true,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const displayPlaceholder = placeholder ?? t('aiStudio.chatPlaceholder');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to calculate scroll height
    textarea.style.height = 'auto';

    // Calculate line height and set bounds
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 24;
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    // Set new height within bounds
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [minRows, maxRows]);

  // Adjust height on value change
  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  // Restore focus to textarea when re-enabled (e.g., after receiving API response)
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  // Handle input change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      if (maxLength && newValue.length > maxLength) {
        return;
      }
      onChange(newValue);
    },
    [onChange, maxLength]
  );

  // Handle key down (Shift+Enter to send)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !disabled) {
          onSend();
        }
      }
    },
    [value, disabled, onSend]
  );

  // Handle send click
  const handleSend = useCallback(() => {
    if (value.trim() && !disabled) {
      onSend();
    }
  }, [value, disabled, onSend]);

  // Calculate character count
  const charCount = value.length;
  const isNearLimit = charCount > maxLength * 0.9;

  return (
    <div
      className={cn(
        // Layout
        'border-t border-color-terminal-border',
        'p-4',
        'bg-color-terminal-bg',
        className
      )}
    >
      {/* Input Wrapper */}
      <div
        className={cn(
          // Layout
          'flex flex-col',
          'overflow-hidden',
          // Appearance
          'bg-color-terminal-surface',
          'border border-color-terminal-border',
          'rounded-lg',
          // Focus state
          'focus-within:border-color-terminal-accent-primary',
          'focus-within:ring-1 focus-within:ring-color-terminal-accent-primary/30',
          'transition-all duration-200'
        )}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={displayPlaceholder}
          disabled={disabled}
          maxLength={maxLength}
          rows={minRows}
          className={cn(
            // Layout
            'w-full px-4 py-3',
            'resize-none',
            // Appearance
            'bg-transparent',
            'text-sm text-color-terminal-text',
            'placeholder:text-color-terminal-text-muted/70',
            // Focus
            'outline-none',
            // Disabled
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          aria-label={t('aiStudio.messageInput')}
        />

        {/* Toolbar */}
        <div
          className={cn(
            'flex items-center justify-between',
            'px-3 py-2',
            // Gradient background matching vibing-entry design
            'bg-gradient-to-b from-color-terminal-surface-secondary via-color-terminal-accent-primary/20 to-color-terminal-text-muted/30'
          )}
        >
          {/* Left Actions */}
          <div className="flex items-center gap-2">
            {/* Attach Image Button */}
            {onAttachImage && (
              <button
                type="button"
                onClick={onAttachImage}
                disabled={disabled}
                className={cn(
                  'p-2 rounded-md',
                  'bg-color-terminal-surface',
                  'border border-color-terminal-border/50',
                  'text-color-terminal-text-muted',
                  'transition-all duration-200',
                  'hover:bg-color-terminal-surface-hover',
                  'hover:text-color-terminal-text',
                  'hover:-translate-y-0.5',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'disabled:hover:translate-y-0'
                )}
                aria-label={t('aiStudio.attachImage')}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            )}

            {/* Character Count */}
            {showCharCount && (
              <span
                className={cn(
                  'text-[10px] font-mono',
                  isNearLimit ? 'text-yellow-500' : 'text-color-terminal-text-muted/50'
                )}
              >
                {charCount}/{maxLength}
              </span>
            )}
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            className={cn(
              'p-2.5 rounded-md',
              'bg-color-terminal-surface',
              'border border-color-terminal-border/50',
              'text-color-terminal-text-muted',
              'transition-all duration-200',
              // Enabled state
              value.trim() && !disabled && 'hover:bg-color-terminal-accent-primary hover:text-color-terminal-bg hover:border-color-terminal-accent-primary hover:-translate-y-0.5 hover:shadow-lg hover:shadow-color-terminal-accent-primary/20',
              // Disabled state
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'disabled:hover:translate-y-0',
              'disabled:hover:shadow-none'
            )}
            aria-label={t('aiStudio.sendMessage')}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Helper Text - TICKET_559: Show ESC cancel hint during loading */}
      <p className="text-[10px] text-color-terminal-text-muted/60 mt-2 text-center">
        {isLoading ? (
          <>
            {t('aiStudio.helperPress')} <kbd className="px-1 py-0.5 bg-color-terminal-surface rounded text-[12px]">Esc</kbd> {t('aiStudio.helperEscCancel')}
          </>
        ) : (
          <>
            {t('aiStudio.helperPress')} <kbd className="px-1 py-0.5 bg-color-terminal-surface rounded text-[12px]">{t('aiStudio.helperEnter')}</kbd> {t('aiStudio.helperSendText')}{' '}
            <kbd className="px-1 py-0.5 bg-color-terminal-surface rounded text-[12px]">{t('aiStudio.helperShiftEnter')}</kbd> {t('aiStudio.helperNewLineText')}
          </>
        )}
      </p>
    </div>
  );
};

export default ChatInputArea;
