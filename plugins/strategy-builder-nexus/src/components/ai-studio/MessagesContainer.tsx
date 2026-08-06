/**
 * MessagesContainer Component (component19F)
 *
 * Scrollable container for chat messages with auto-scroll and welcome state.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MessageBubble, Message } from './MessageBubble';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MessagesContainerProps {
  /** List of messages */
  messages: Message[];
  /** Loading state (show typing indicator) */
  isLoading?: boolean;
  /** Auto-scroll to bottom on new messages */
  autoScroll?: boolean;
  /** Welcome title when no messages */
  welcomeTitle?: string;
  /** Welcome subtitle when no messages */
  welcomeSubtitle?: string;
  /** Scroll to bottom callback */
  onScrollToBottom?: () => void;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Welcome Message Sub-component
// -----------------------------------------------------------------------------

interface WelcomeMessageProps {
  title: string;
  subtitle?: string;
}

const WelcomeMessage: React.FC<WelcomeMessageProps> = ({ title, subtitle }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 min-h-[300px]">
    {/* Watermark Icon */}
    <div className="relative mb-6">
      <Sparkles className="w-20 h-20 text-color-terminal-accent-primary/10" />
      <Sparkles className="w-12 h-12 text-color-terminal-accent-primary/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
    </div>

    {/* Title */}
    <h2 className="text-3xl font-semibold text-color-terminal-text mb-2 text-center">
      {title}
    </h2>

    {/* Subtitle */}
    {subtitle && (
      <p className="text-sm text-color-terminal-text-muted text-center max-w-md">
        {subtitle}
      </p>
    )}
  </div>
);

// -----------------------------------------------------------------------------
// Typing Indicator Sub-component (component19I inline)
// -----------------------------------------------------------------------------

const TypingIndicator: React.FC = () => (
  <div
    className={cn(
      'flex gap-3 mb-4',
      'animate-in fade-in slide-in-from-bottom-2 duration-300'
    )}
  >
    {/* Avatar */}
    <div
      className={cn(
        'w-9 h-9 rounded-full flex-shrink-0',
        'flex items-center justify-center',
        'bg-gradient-to-br from-purple-500 to-purple-600 text-white',
        'shadow-md'
      )}
    >
      <Sparkles className="w-4 h-4" />
    </div>

    {/* Typing Dots */}
    <div className="flex items-center px-4 py-3">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'w-2 h-2 rounded-full',
              'bg-color-terminal-text-secondary'
            )}
            style={{
              animation: 'typingDot 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  </div>
);

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const MessagesContainer: React.FC<MessagesContainerProps> = ({
  messages,
  isLoading = false,
  autoScroll = true,
  welcomeTitle,
  welcomeSubtitle,
  onScrollToBottom,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const displayTitle = welcomeTitle ?? t('pages.aiStrategyStudio.welcomeTitle');
  const displaySubtitle = welcomeSubtitle ?? t('pages.aiStrategyStudio.welcomeSubtitle');
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom function
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior });
      onScrollToBottom?.();
    }
  }, [onScrollToBottom]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (autoScroll && messages.length > 0) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        scrollToBottom('smooth');
      });
    }
  }, [messages.length, autoScroll, scrollToBottom]);

  // Auto-scroll when loading state changes
  useEffect(() => {
    if (autoScroll && isLoading) {
      requestAnimationFrame(() => {
        scrollToBottom('smooth');
      });
    }
  }, [isLoading, autoScroll, scrollToBottom]);

  // Empty state
  if (messages.length === 0 && !isLoading) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'flex-1 overflow-y-auto',
          'scroll-smooth',
          className
        )}
      >
        <WelcomeMessage title={displayTitle} subtitle={displaySubtitle} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex-1 overflow-y-auto',
        'p-4 pb-6',
        'scroll-smooth',
        className
      )}
    >
      {/* Messages */}
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          showAvatar={true}
          showTimestamp={true}
          showCopyButton={message.type === 'assistant'}
        />
      ))}

      {/* Typing Indicator */}
      {isLoading && <TypingIndicator />}

      {/* Scroll anchor */}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
};

// Re-export Message type
export type { Message } from './MessageBubble';

export default MessagesContainer;
