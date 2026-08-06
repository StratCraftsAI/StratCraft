/**
 * MessageBubble Component (component19G)
 *
 * Individual message bubble with different styles for user, assistant, and system messages.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Bot, Info, Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatTimestamp } from '@shared/utils/format-locale';
import { COPY_FEEDBACK_DURATION_MS } from '@shared/constants/timing';
import type { OpensourceAlgorithm } from '@StratCraft/ai-studio-operations/vibing-chat-protocol';
import { ChatContent } from './ChatContent';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type MessageType = 'user' | 'assistant' | 'system';

export type { OpensourceAlgorithm };

/** TICKET_597: Metadata attached to assistant messages */
export interface MessageMetadata {
  opensource_algorithms?: OpensourceAlgorithm[];
}

export interface Message {
  /** Unique identifier */
  id: string;
  /** Message type */
  type: MessageType;
  /** Message content (supports markdown) */
  content: string;
  /** Message timestamp */
  timestamp?: Date;
  /** Is message still streaming */
  isStreaming?: boolean;
  /** TICKET_597: Structured metadata for rendering extensions */
  metadata?: MessageMetadata;
}

export interface MessageBubbleProps {
  /** Message data */
  message: Message;
  /** Show avatar */
  showAvatar?: boolean;
  /** Show timestamp */
  showTimestamp?: boolean;
  /** Show copy button */
  showCopyButton?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const MESSAGE_CONFIG: Record<MessageType, {
  icon: React.FC<{ className?: string }>;
  roleKey: string;
  avatarClass: string;
  contentClass: string;
  alignClass: string;
  animationClass: string;
}> = {
  user: {
    icon: User,
    roleKey: 'aiStudio.roleUser',
    avatarClass: 'bg-gradient-to-br from-color-terminal-accent-primary to-color-terminal-accent-primary/80 text-color-terminal-bg',
    contentClass: 'bg-color-terminal-accent-primary text-color-terminal-bg rounded-br-sm',
    alignClass: 'flex-row-reverse',
    animationClass: 'animate-in slide-in-from-right-5',
  },
  assistant: {
    icon: Bot,
    roleKey: 'aiStudio.roleAssistant',
    avatarClass: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white',
    contentClass: 'bg-color-terminal-surface border border-color-terminal-border text-color-terminal-text rounded-bl-sm',
    alignClass: 'flex-row',
    animationClass: 'animate-in slide-in-from-left-5',
  },
  system: {
    icon: Info,
    roleKey: 'aiStudio.roleSystem',
    avatarClass: 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white',
    contentClass: 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white border-none shadow-lg shadow-indigo-500/30',
    alignClass: 'justify-center',
    animationClass: 'animate-in fade-in zoom-in-95',
  },
};

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

interface LoadingDotsProps {
  className?: string;
}

const LoadingDots: React.FC<LoadingDotsProps> = ({ className }) => (
  <div className={cn('flex items-center gap-1.5 py-1', className)}>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className={cn(
          'w-2 h-2 rounded-full',
          'bg-color-terminal-text-muted'
        )}
        style={{
          animation: 'typingDot 1.4s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }}
      />
    ))}
    <style>{`
      @keyframes typingDot {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-6px); opacity: 1; }
      }
    `}</style>
  </div>
);

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  showAvatar = true,
  showTimestamp = true,
  showCopyButton = true,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [copied, setCopied] = React.useState(false);

  const config = MESSAGE_CONFIG[message.type];
  const Icon = config.icon;

  // Handle copy to clipboard
  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } catch (err) {
      console.error('[E:UI:COPY_FAILED] Failed to copy:', err);
    }
  }, [message.content]);

  /**
   * TICKET_1318 AC7/AC9: content rendering is delegated to the shared-AST
   * adapter. The local regex renderer is gone -- it decided bold, emphasis,
   * inline code, line breaks and fences on its own, and discarded the fence
   * language hint entirely.
   */
  const renderedContent = useMemo(() => {
    if (message.isStreaming && !message.content) {
      return <LoadingDots />;
    }

    return (
      <ChatContent
        content={message.content}
        algorithms={message.metadata?.opensource_algorithms}
      />
    );
  }, [message.content, message.isStreaming, message.metadata?.opensource_algorithms]);

  return (
    <div
      className={cn(
        'flex gap-3 mb-4',
        'duration-300',
        config.alignClass,
        config.animationClass,
        className
      )}
    >
      {/* Avatar */}
      {showAvatar && message.type !== 'system' && (
        <div
          className={cn(
            'w-9 h-9 rounded-full flex-shrink-0',
            'flex items-center justify-center',
            'shadow-md',
            config.avatarClass
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
      )}

      {/* Content Wrapper */}
      <div
        className={cn(
          'flex flex-col gap-1',
          message.type === 'system' ? 'items-center' : 'max-w-[75%]',
          message.type === 'user' && 'items-end'
        )}
      >
        {/* Header (Role + Timestamp) */}
        {message.type !== 'system' && (showTimestamp || showAvatar) && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs font-semibold text-color-terminal-text-secondary">
              {t(config.roleKey)}
            </span>
            {showTimestamp && message.timestamp && (
              <span className="text-[10px] text-color-terminal-text-muted">
                {formatTimestamp(message.timestamp)}
              </span>
            )}
          </div>
        )}

        {/* Message Content */}
        <div
          className={cn(
            'relative group',
            'px-4 py-3 rounded-lg',
            'text-sm leading-relaxed',
            config.contentClass
          )}
        >
          {renderedContent}

          {/* Copy Button */}
          {showCopyButton && message.type === 'assistant' && !message.isStreaming && (
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'absolute -right-2 -top-2',
                'p-1.5 rounded-md',
                'bg-color-terminal-surface border border-color-terminal-border',
                'text-color-terminal-text-muted',
                'opacity-0 group-hover:opacity-100',
                'transition-all duration-200',
                'hover:bg-color-terminal-surface-hover',
                'hover:text-color-terminal-text',
                'shadow-sm'
              )}
              aria-label={copied ? t('aiStudio.copied') : t('aiStudio.copyMessage')}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Streaming indicator */}
          {message.isStreaming && message.content && (
            <span className="inline-block w-1.5 h-4 ml-1 bg-current animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
