/**
 * ConversationSidebar Component (component19A)
 *
 * Left sidebar containing conversation history management.
 * Composes NewChatButton, ConversationSearch, and ConversationList.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specification
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { NewChatButton } from './NewChatButton';
import { ConversationSearch } from './ConversationSearch';
import { ConversationList, Conversation } from './ConversationList';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ConversationSidebarProps {
  /** List of conversations */
  conversations: Conversation[];
  /** Currently active conversation ID */
  activeConversationId: string | null;
  /** New chat handler */
  onNewChat: () => void;
  /** Conversation selection handler */
  onSelectConversation: (id: string) => void;
  /** Conversation deletion handler */
  onDeleteConversation?: (id: string) => void;
  /** Search change handler (optional, for external state) */
  onSearchChange?: (query: string) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Sidebar width in pixels */
  width?: number;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onSearchChange,
  isLoading = false,
  width = 384,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  // Internal search state
  const [searchQuery, setSearchQuery] = useState('');

  // Handle search change
  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      onSearchChange?.(query);
    },
    [onSearchChange]
  );

  // Handle search clear
  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
    onSearchChange?.('');
  }, [onSearchChange]);

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) {
      return conversations;
    }

    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) ||
        conv.preview.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  return (
    <aside
      className={cn(
        // Layout
        'flex flex-col',
        'h-full overflow-hidden',
        // Appearance
        'bg-color-terminal-surface-secondary',
        'border-r border-color-terminal-border',
        className
      )}
      style={{ width }}
    >
      {/* New Chat Button */}
      <NewChatButton
        onClick={onNewChat}
        disabled={isLoading}
      />

      {/* Search Input */}
      <ConversationSearch
        value={searchQuery}
        onChange={handleSearchChange}
        onClear={handleSearchClear}
        disabled={isLoading}
      />

      {/* Conversation List */}
      <ConversationList
        conversations={filteredConversations}
        activeId={activeConversationId}
        onSelect={onSelectConversation}
        onDelete={onDeleteConversation}
        emptyText={
          searchQuery
            ? t('aiStudio.noSearchResults')
            : t('aiStudio.emptyConversations')
        }
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-color-terminal-bg/50 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-color-terminal-accent-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </aside>
  );
};

// Re-export types from sub-components
export type { Conversation } from './ConversationList';

export default ConversationSidebar;
