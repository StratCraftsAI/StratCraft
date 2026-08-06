/**
 * MessageItem - Single message notification component
 *
 * @see TICKET_096 - Host Layer Message Utils Design
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, CheckCircle, AlertTriangle, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message, MessageType } from './types';

interface MessageItemProps {
  message: Message;
  onDismiss: (id: string) => void;
}

const ICON_MAP: Record<MessageType, React.ElementType> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const TYPE_STYLES: Record<MessageType, { border: string; icon: string }> = {
  info: {
    border: 'border-l-color-terminal-accent-teal',
    icon: 'text-color-terminal-accent-teal',
  },
  success: {
    border: 'border-l-green-500',
    icon: 'text-green-500',
  },
  warning: {
    border: 'border-l-color-terminal-accent-gold',
    icon: 'text-color-terminal-accent-gold',
  },
  error: {
    border: 'border-l-red-500',
    icon: 'text-red-500',
  },
};

export function MessageItem({ message, onDismiss }: MessageItemProps) {
  const { t } = useTranslation(['ui', 'errors']);
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(message.id);
    }, 200);
  }, [message.id, onDismiss]);

  // Auto-dismiss timer
  useEffect(() => {
    if (message.duration > 0) {
      const timer = setTimeout(handleDismiss, message.duration);
      return () => clearTimeout(timer);
    }
  }, [message.duration, handleDismiss]);

  const Icon = ICON_MAP[message.type];
  const styles = TYPE_STYLES[message.type];
  const displayContent = message.content.startsWith('MSG_')
    ? t(message.content, { ns: 'errors' })
    : message.content;

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 pr-4',
        'rounded-lg border border-color-terminal-border border-l-[3px]',
        'bg-color-terminal-surface backdrop-blur-sm',
        'shadow-[0_4px_12px_rgba(0,0,0,0.3)]',
        styles.border,
        isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
      )}
      role="alert"
    >
      {/* Icon */}
      <Icon className={cn('w-[18px] h-[18px] flex-shrink-0 mt-0.5', styles.icon)} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[12px] leading-relaxed text-color-terminal-text break-words">
          {displayContent}
        </p>

        {/* Actions */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex gap-2 mt-2">
            {message.actions.map((action, index) => {
              const label = action.label.startsWith('MSG_')
                ? t(action.label, { ns: 'errors' })
                : action.label;

              return (
                <button
                  key={index}
                  onClick={() => {
                    action.onClick();
                    handleDismiss();
                  }}
                  className={cn(
                    'px-2 py-1 text-[12px] font-bold uppercase tracking-wider',
                    'border border-color-terminal-border rounded',
                    'bg-transparent text-color-terminal-text-secondary',
                    'hover:border-color-terminal-accent-teal hover:text-color-terminal-accent-teal',
                    'transition-all duration-200'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      {message.dismissible && (
        <button
          onClick={handleDismiss}
          className={cn(
            'p-0.5 flex-shrink-0',
            'text-color-terminal-text-muted hover:text-color-terminal-text',
            'transition-colors duration-200'
          )}
          aria-label={t('accessibility.dismiss', { ns: 'ui' })}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
