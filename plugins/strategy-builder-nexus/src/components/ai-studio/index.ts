/**
 * AI Strategy Studio Components (component19)
 *
 * Components for the AI Strategy Studio page (page38).
 * Based on vibing-entry page design from web platform.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specifications
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

// component19A: ConversationSidebar (main container)
export { ConversationSidebar } from './ConversationSidebar';
export type { ConversationSidebarProps } from './ConversationSidebar';

// component19B: NewChatButton
export { NewChatButton } from './NewChatButton';
export type { NewChatButtonProps } from './NewChatButton';

// component19C: ConversationSearch
export { ConversationSearch } from './ConversationSearch';
export type { ConversationSearchProps } from './ConversationSearch';

// component19D: ConversationList
export { ConversationList } from './ConversationList';
export type { ConversationListProps, Conversation } from './ConversationList';

// component19F: MessagesContainer
export { MessagesContainer } from './MessagesContainer';
export type { MessagesContainerProps } from './MessagesContainer';

// component19G: MessageBubble
export { MessageBubble } from './MessageBubble';
export type { MessageBubbleProps, Message, MessageType } from './MessageBubble';

// component19H: ChatInputArea
export { ChatInputArea } from './ChatInputArea';
export type { ChatInputAreaProps } from './ChatInputArea';

// component19J: StrategyRulesPanel
export { StrategyRulesPanel } from './StrategyRulesPanel';
export type { StrategyRulesPanelProps, StrategyRule, RuleType } from './StrategyRulesPanel';

// component19L: IndicatorsSection (TICKET_530)
export { IndicatorsSection } from './IndicatorsSection';
export type { IndicatorsSectionProps } from './IndicatorsSection';

// component19K: ActionButtons
export { ActionButtons } from './ActionButtons';
export type { ActionButtonsProps, ActionButton, ActionId } from './ActionButtons';

// component19M: AlgorithmCardList (TICKET_597, typed placement per TICKET_1318)
export { AlgorithmCard, placeAlgorithmCards } from './AlgorithmCardList';
export type { AlgorithmCardProps, PlacedItem, TranslateFn } from './AlgorithmCardList';
export type { OpensourceAlgorithm, MessageMetadata } from './MessageBubble';

// TICKET_1318: shared-AST chat content adapter
export { ChatContent } from './ChatContent';
export type { ChatContentProps } from './ChatContent';
