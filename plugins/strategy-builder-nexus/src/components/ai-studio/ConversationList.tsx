/**
 * ConversationList Component (component19D)
 *
 * Scrollable list of conversation history items.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatTimestamp } from '@shared/utils/format-locale';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface Conversation {
  /** Unique identifier */
  id: string;
  /** Conversation title */
  title: string;
  /** Preview of last message */
  preview: string;
  /** Last activity timestamp */
  timestamp: Date;
  /** Total message count */
  messageCount: number;
}

export interface ConversationListProps {
  /** List of conversations */
  conversations: Conversation[];
  /** Currently active conversation ID */
  activeId: string | null;
  /** Selection handler */
  onSelect: (id: string) => void;
  /** Delete handler */
  onDelete?: (id: string) => void;
  /** Empty state placeholder text */
  emptyText?: string;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// ConversationItem Sub-component
// -----------------------------------------------------------------------------

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}) => {
  const { t } = useTranslation('strategy-builder');

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.();
    },
    [onDelete]
  );

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      role="button"
      tabIndex={0}
      className={cn(
        // Layout
        'p-3 mx-2 my-1',
        'rounded-lg',
        'cursor-pointer',
        'group',
        // Appearance
        'border border-transparent',
        'transition-all duration-200',
        // Default state
        !isActive && 'hover:bg-color-terminal-surface-hover hover:border-color-terminal-border hover:translate-x-1',
        // Active state
        isActive && 'bg-color-terminal-accent-primary text-color-terminal-bg border-color-terminal-accent-primary shadow-lg shadow-color-terminal-accent-primary/20',
        // Animation
        'animate-in slide-in-from-left-2 duration-300'
      )}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-1">
        <span
          className={cn(
            'text-sm font-semibold truncate flex-1',
            isActive ? 'text-color-terminal-bg' : 'text-color-terminal-text'
          )}
        >
          {conversation.title}
        </span>
        <span
          className={cn(
            'text-xs ml-2 flex-shrink-0',
            isActive ? 'text-color-terminal-bg/80' : 'text-color-terminal-text-muted'
          )}
        >
          {formatTimestamp(conversation.timestamp)}
        </span>
      </div>

      {/* Preview */}
      <p
        className={cn(
          'text-xs truncate mb-1',
          isActive ? 'text-color-terminal-bg/90' : 'text-color-terminal-text-secondary'
        )}
      >
        {conversation.preview}
      </p>

      {/* Meta Row */}
      <div className="flex items-center justify-between">
        <div
          className={cn(
            'flex items-center gap-1 text-xs',
            isActive ? 'text-color-terminal-bg/70' : 'text-color-terminal-text-muted'
          )}
        >
          <MessageSquare className="w-3 h-3" />
          <span>{conversation.messageCount}</span>
        </div>

        {/* Delete Button */}
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className={cn(
              'p-1 rounded opacity-0 group-hover:opacity-100',
              'transition-all duration-200',
              isActive
                ? 'hover:bg-color-terminal-bg/20 text-color-terminal-bg/70 hover:text-color-terminal-bg'
                : 'hover:bg-red-500/10 text-color-terminal-text-muted hover:text-red-500'
            )}
            aria-label={t('aiStudio.deleteConversation')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeId,
  onSelect,
  onDelete,
  emptyText,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const displayEmptyText = emptyText ?? t('aiStudio.emptyConversations');
  // Empty state
  if (conversations.length === 0) {
    return (
      <div
        className={cn(
          'flex-1 flex flex-col items-center justify-center',
          'p-6 text-center',
          className
        )}
      >
        <MessageSquare className="w-10 h-10 text-color-terminal-text-muted/50 mb-3" />
        <p className="text-sm text-color-terminal-text-muted">{displayEmptyText}</p>
        <p className="text-xs text-color-terminal-text-muted/70 mt-1">
          {t('aiStudio.startNewChat')}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex-1 overflow-y-auto',
        'py-2',
        className
      )}
    >
      {conversations.map((conversation, index) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          isActive={conversation.id === activeId}
          onSelect={() => onSelect(conversation.id)}
          onDelete={onDelete ? () => onDelete(conversation.id) : undefined}
        />
      ))}
    </div>
  );
};

export default ConversationList;
