/**
 * AIStrategyStudioPage (page38)
 *
 * AI Strategy Studio workspace page for comprehensive AI-powered strategy creation.
 * Combines chat interface with strategy rules management.
 * Persists conversations and messages to SQLite via IPC.
 *
 * @see TICKET_077_19_AI_STRATEGY_STUDIO_COMPONENTS.md - Component specifications
 * @see TICKET_077_1_PAGE_HIERARCHY.md - Page definition (page38)
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores';
import { cn } from '../../lib/utils';
import {
  conversationService,
  ConversationRecord,
  MessageRecord,
} from '../../services/conversation-service';
import {
  executeVibingChat,
  executeVibingChatAction,
  getVibingChatErrorMessage,
  VibingChatRequest,
  VibingChatResponse,
  StrategyRulesResponse,
  StrategyIndicator,
  getAlgorithmStorageService,
  StrategyType,
  SignalSource,
  StorageMode,
} from '../../services';
import { getCurrentUserIdAsString } from '../../utils/auth-utils';
import { useEventWatchdog } from '@StratCraft/shared-ui';
import { UI_WATCHDOG_GENERATION_MS } from '@shared/constants/timing';

// AI Studio Components (component19)
import {
  ConversationSidebar,
  Conversation,
  MessagesContainer,
  Message,
  ChatInputArea,
  ActionButtons,
  ActionButton,
  ActionId,
  StrategyRulesPanel,
  StrategyRule,
  RuleType,
  IndicatorsSection,
} from '../ai-studio';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AIStrategyStudioPageProps {
  /** Page title */
  pageTitle?: string;
  /** Initial strategy name */
  strategyName?: string;
  /** Strategy ID */
  strategyId?: string;
  /** On strategy name change */
  onStrategyNameChange?: (name: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** LLM provider setting from plugin config */
  llmProvider?: string;
  /** LLM model setting from plugin config */
  llmModel?: string;
  /** Settings click handler */
  onSettingsClick?: (tab?: string) => void;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Generate unique ID for local state
 */
function generateLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Convert DB record to UI Conversation
 */
function toConversation(record: ConversationRecord): Conversation {
  return {
    id: String(record.id),
    title: record.title,
    preview: record.preview || '',
    timestamp: new Date(record.updated_at),
    messageCount: record.message_count,
  };
}

/**
 * Convert DB record to UI Message
 */
function toMessage(record: MessageRecord): Message {
  return {
    id: String(record.id),
    type: record.type,
    content: record.content,
    timestamp: new Date(record.created_at),
  };
}

/**
 * Estimate token count (simple approximation)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Delete all empty conversations (message_count === 0)
 * Called before creating a new conversation to prevent accumulation
 * TICKET_243: AI Strategy Studio Empty Conversation Cleanup
 */
async function cleanupEmptyConversations(
  conversations: Conversation[]
): Promise<string[]> {
  const emptyConversations = conversations.filter((c) => c.messageCount === 0);
  const deletedIds: string[] = [];

  for (const conv of emptyConversations) {
    const dbId = parseInt(conv.id, 10);
    if (!isNaN(dbId)) {
      const result = await conversationService.deleteConversation(dbId);
      if (result.success) {
        deletedIds.push(conv.id);
      }
    }
  }

  return deletedIds;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const AIStrategyStudioPage: React.FC<AIStrategyStudioPageProps> = ({
  pageTitle,
  strategyName: initialStrategyName = '',
  strategyId = '',
  onStrategyNameChange,
  className,
  llmProvider = 'PRO_CATALOG',
  llmModel = '',
  onSettingsClick,
}) => {
  const { t } = useTranslation('strategy-builder');
  const { t: tErrors } = useTranslation('errors');
  const setPageTitle = useAppStore(s => s.setPageTitle);
  const displayPageTitle = pageTitle ?? t('pages.aiStrategyStudio.welcomeTitle');
  const resolveErrorMessage = useCallback((message: string): string => (
    /^MSG_[A-Z0-9_]+$/.test(message) ? tErrors(message) : message
  ), [tErrors]);

  // TICKET_591: Set page title in BreadcrumbBar center zone on mount
  useEffect(() => {
    setPageTitle(t('pages.aiStrategyStudio.breadcrumb'));
    return () => setPageTitle(null);
  }, [setPageTitle, t]);

  // -------------------------------------------------------------------------
  // User State
  // -------------------------------------------------------------------------
  const [userId, setUserId] = useState<string>('');

  // -------------------------------------------------------------------------
  // Conversation State
  // -------------------------------------------------------------------------
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeDbId, setActiveDbId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);

  // -------------------------------------------------------------------------
  // Session State
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Strategy Rules State
  // -------------------------------------------------------------------------
  const [strategyRules, setStrategyRules] = useState<StrategyRule[]>([]);

  // TICKET_530: Store technical indicators separately (not as rules)
  const [strategyIndicators, setStrategyIndicators] = useState<StrategyIndicator[]>([]);

  // TICKET_528: Store complete StrategyRulesResponse for Round 3 requests
  // Preserves indicators (structured objects), risk_management, completeness_score
  const [fullStrategyRules, setFullStrategyRules] = useState<StrategyRulesResponse | null>(null);

  // -------------------------------------------------------------------------
  // TICKET_558: Request Lifecycle Management
  // AbortController ref for cancelling in-flight API requests
  // -------------------------------------------------------------------------
  const activeRequestRef = useRef<AbortController | null>(null);

  // TICKET_596: Refs for unmount cleanup (closures can't access latest state)
  const activeDbIdRef = useRef<number | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => { activeDbIdRef.current = activeDbId; }, [activeDbId]);
  useEffect(() => { activeConversationIdRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // -------------------------------------------------------------------------
  // TICKET_592 Phase 2: No refs needed -- local DB save triggers immediately
  // on generate_code success, consistent with other builders.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // TICKET_708 + TICKET_709 Phase 3: Track last saved algorithm ID for compilation status feedback
  // Use ref to avoid race condition: subscription callback always reads latest ID
  // without depending on React render cycles.
  // -------------------------------------------------------------------------
  const lastSavedAlgorithmIdRef = useRef<number | null>(null);

  // -------------------------------------------------------------------------
  // Action Buttons
  // TICKET_467: Button visibility driven by backend available_actions
  // -------------------------------------------------------------------------
  const [actionStates, setActionStates] = useState<Record<ActionId, boolean>>({
    generate_code: false,
  });
  const [backendActions, setBackendActions] = useState<string[]>([]);

  const availableActions = useMemo<ActionButton[]>(() => {
    if (backendActions.length === 0) {
      return [];
    }

    const allButtons: ActionButton[] = [
      {
        id: 'generate_code',
        label: t('pages.aiStrategyStudio.actions.generateCode'),
        loading: actionStates.generate_code,
      },
    ];

    return allButtons.filter((btn) => backendActions.includes(btn.id));
  }, [backendActions, actionStates]);

  // -------------------------------------------------------------------------
  // Load User & Conversations on Mount
  // TICKET_235: Always create a new chat on page load
  // -------------------------------------------------------------------------
  useEffect(() => {
    const loadUserAndConversations = async () => {
      try {
        // Get user ID from centralized auth utils
        const currentUserId = await getCurrentUserIdAsString();
        setUserId(currentUserId);

        // Load existing conversations from SQLite
        const result = await conversationService.listConversations(currentUserId);
        const loadedConversations = result.success && result.data
          ? result.data.map(toConversation)
          : [];

        // TICKET_243: Cleanup empty conversations before creating new one
        const deletedIds = await cleanupEmptyConversations(loadedConversations);
        const cleanedConversations = deletedIds.length > 0
          ? loadedConversations.filter((c) => !deletedIds.includes(c.id))
          : loadedConversations;

        // TICKET_235: Always create a new chat on page load
        const createResult = await conversationService.createConversation({
          userId: currentUserId,
          title: t('pages.aiStrategyStudio.newChatTitle'),
          preview: t('pages.aiStrategyStudio.newChatPreview'),
        });

        if (createResult.success && createResult.data) {
          const newConversation = toConversation(createResult.data);
          setConversations([newConversation, ...cleanedConversations]);
          setActiveConversationId(newConversation.id);
          setActiveDbId(createResult.data.id);
        } else {
          // Fallback: just load existing conversations
          setConversations(cleanedConversations);
        }
      } catch (error) {
        console.error('[E:STRATEGY:STUDIO_LOAD_CONVERSATIONS_FAILED] [AIStrategyStudio] Failed to load conversations:', error);
      } finally {
        setIsLoadingConversations(false);
      }
    };

    loadUserAndConversations();
  }, []);

  // TICKET_558: Abort in-flight request on unmount
  // TICKET_596: Discard empty session on unmount
  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;

      // TICKET_596: Discard active session if no messages were sent
      const dbId = activeDbIdRef.current;
      const convId = activeConversationIdRef.current;
      if (dbId != null && convId != null) {
        const currentConv = conversationsRef.current.find((c) => c.id === convId);
        if (currentConv && currentConv.messageCount === 0) {
          conversationService.deleteConversation(dbId);
        }
      }
    };
  }, []);

  // TICKET_559: ESC key cancels in-flight request
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLoading) {
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        setIsLoading(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading]);

  // ---------------------------------------------------------------------------
  // TICKET_755 Phase 7: UI watchdog.
  // Vibing Chat is a single-shot request flow without streaming progress;
  // the watchdog runs as a fixed-duration deadline that augments (does not
  // replace) Escape-key manual cancellation. On timeout it aborts the
  // in-flight request, clears the busy state, and surfaces an error system
  // message via the existing chat-message pattern.
  // ---------------------------------------------------------------------------
  useEventWatchdog({
    active: isLoading,
    timeoutMs: UI_WATCHDOG_GENERATION_MS,
    resetSignals: [],
    onTimeout: () => {
      const seconds = Math.round(UI_WATCHDOG_GENERATION_MS / 1000);
      const message = `AI Studio watchdog: no response for ${seconds}s. Backend may be unresponsive. Try again or check logs.`;
      console.error('[E:STRATEGY:STUDIO_WATCHDOG_TIMEOUT] [AIStrategyStudio]', message);
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      setIsLoading(false);
      const systemMessage: Message = {
        id: generateLocalId(),
        type: 'system',
        content: t('pages.aiStrategyStudio.errorPrefix', { message }),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, systemMessage]);
    },
  });

  // -------------------------------------------------------------------------
  // Conversation Handlers
  // -------------------------------------------------------------------------
  const handleNewChat = useCallback(async () => {
    if (!userId) return;

    // TICKET_558: Cancel in-flight request before creating new chat
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;

    setIsLoading(true);
    try {
      // TICKET_243: Cleanup empty conversations before creating new one
      const deletedIds = await cleanupEmptyConversations(conversations);
      if (deletedIds.length > 0) {
        setConversations((prev) => prev.filter((c) => !deletedIds.includes(c.id)));
      }

      // Create conversation in SQLite
      const result = await conversationService.createConversation({
        userId,
        title: t('pages.aiStrategyStudio.newChatTitle'),
        preview: t('pages.aiStrategyStudio.newChatPreview'),
      });

      if (result.success && result.data) {
        const newConversation = toConversation(result.data);
        setConversations((prev) => [newConversation, ...prev]);
        setActiveConversationId(newConversation.id);
        setActiveDbId(result.data.id);
        setMessages([]);
        setStrategyRules([]);
        setBackendActions([]);
        setFullStrategyRules(null);
        setStrategyIndicators([]);
      }
    } catch (error) {
      console.error('[E:STRATEGY:STUDIO_CREATE_CONVERSATION_FAILED] [AIStrategyStudio] Failed to create conversation:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, conversations]);

  const handleSelectConversation = useCallback(async (id: string) => {
    const dbId = parseInt(id, 10);
    if (isNaN(dbId)) return;

    // TICKET_558: Cancel in-flight request before switching conversation
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;

    // TICKET_596: Discard previous empty session before switching
    const prevConvId = activeConversationIdRef.current;
    const prevDbId = activeDbIdRef.current;
    if (prevDbId != null && prevConvId != null && prevConvId !== id) {
      const prevConv = conversationsRef.current.find((c) => c.id === prevConvId);
      if (prevConv && prevConv.messageCount === 0) {
        conversationService.deleteConversation(prevDbId);
        setConversations((prev) => prev.filter((c) => c.id !== prevConvId));
      }
    }

    setActiveConversationId(id);
    setActiveDbId(dbId);
    setIsLoading(true);

    try {
      // Load messages from SQLite
      const messagesResult = await conversationService.listMessages(dbId);
      if (messagesResult.success && messagesResult.data) {
        setMessages(messagesResult.data.map(toMessage));
      }

      // Load conversation details for rules
      const convResult = await conversationService.getConversation(dbId);
      if (convResult.success && convResult.data) {

        // Parse strategy rules if stored
        if (convResult.data.strategy_rules) {
          try {
            const rules = JSON.parse(convResult.data.strategy_rules);
            setStrategyRules(rules);
          } catch (err) {
            console.error('[E:STRATEGY:STUDIO_RULES_PARSE_FAILED] [AIStrategyStudio] strategy_rules parse failed; defaulting to empty', err);
            setStrategyRules([]);
          }
        } else {
          setStrategyRules([]);
        }
      }

      // TICKET_467: Reset backend actions on conversation switch
      setBackendActions([]);

      // TICKET_528: Reset fullStrategyRules on conversation switch
      // (DB only stores UI format, not complete StrategyRulesResponse)
      setFullStrategyRules(null);

      // TICKET_530: Clear indicators (will reload from backend)
      setStrategyIndicators([]);
    } catch (error) {
      console.error('[E:STRATEGY:STUDIO_LOAD_CONVERSATION_FAILED] [AIStrategyStudio] Failed to load conversation:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDeleteConversation = useCallback(async (id: string) => {
    const dbId = parseInt(id, 10);
    if (isNaN(dbId)) return;

    try {
      // Delete from SQLite
      const result = await conversationService.deleteConversation(dbId);
      if (result.success) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          setActiveConversationId(null);
          setActiveDbId(null);
          setMessages([]);
          setStrategyRules([]);
          setBackendActions([]);
          setFullStrategyRules(null); // TICKET_528: Clear fullStrategyRules
        }
      }
    } catch (error) {
      console.error('[E:STRATEGY:STUDIO_DELETE_CONVERSATION_FAILED] [AIStrategyStudio] Failed to delete conversation:', error);
    }
  }, [activeConversationId]);

  // -------------------------------------------------------------------------
  // Message Handlers
  // -------------------------------------------------------------------------
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading || !activeDbId) return;

    const content = inputValue.trim();
    const tokenCount = estimateTokens(content);

    // TICKET_558: Abort previous in-flight request
    activeRequestRef.current?.abort();
    const abortController = new AbortController();
    activeRequestRef.current = abortController;

    // TICKET_558: Capture conversation ID at call time for staleness guard
    const capturedDbId = activeDbId;
    const capturedConversationId = activeConversationId;

    setInputValue('');
    setIsLoading(true);

    try {
      // Add user message to SQLite
      const userResult = await conversationService.addMessage({
        conversationId: capturedDbId,
        type: 'user',
        content,
        tokenCount,
      });

      // TICKET_595: Detect first message in conversation (frontend is source of truth)
      const isFirstMessage = userResult.success && userResult.data
        && userResult.data.conversation.message_count === 1;

      if (userResult.success && userResult.data) {
        // Update local state with user message
        const userMessage: Message = {
          id: String(userResult.data.messageId),
          type: 'user',
          content,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);

        // Update conversation preview
        setConversations((prev) =>
          prev.map((c) =>
            c.id === capturedConversationId
              ? {
                  ...c,
                  preview: content.slice(0, 50),
                  timestamp: new Date(),
                  messageCount: userResult.data!.conversation.message_count,
                }
              : c
          )
        );

      }

      // Call vibing_chat API
      try {
        // Build session ID in expected format
        const sessionId = `strategy-${capturedDbId}-session`;

        // TICKET_528: Preserve complete strategy_rules structure for Round 3
        // Use fullStrategyRules (complete backend data) instead of strategyRules (UI display format)
        const currentRules: Partial<StrategyRulesResponse> | undefined = fullStrategyRules
          ? fullStrategyRules // Send complete structure (indicators, risk_management, completeness_score)
          : undefined;

        const response: VibingChatResponse = await executeVibingChat({
          session_id: sessionId,
          message: content,
          strategy_name: initialStrategyName || t('pages.aiStrategyStudio.newChatTitle'),
          strategy_id: strategyId,
          current_strategy_rules: currentRules,
          output_format: 'v3',
          storage_mode: 'local',
          model: llmProvider as VibingChatRequest['model'],
          llm_model: llmModel,
          signal: abortController.signal,
          metadata: {
            mode: 'generator',
          },
        });

        // TICKET_558: Guard against stale response -- conversation may have changed during polling
        if (capturedDbId !== activeDbId) {
          console.info('[AIStrategyStudio] Response discarded: conversation changed during request');
          return;
        }

        if (response.success && response.result) {
          const assistantContent = response.result.content || response.result.explanation || '';
          const assistantTokens = estimateTokens(assistantContent);

          // Save assistant message to SQLite
          const assistantResult = await conversationService.addMessage({
            conversationId: capturedDbId,
            type: 'assistant',
            content: assistantContent,
            tokenCount: assistantTokens,
          });

          // TICKET_597: Extract opensource_algorithms from response metadata
          const opensourceAlgorithms = response.result.metadata?.opensource_algorithms;

          if (assistantResult.success && assistantResult.data) {
            const assistantMessage: Message = {
              id: String(assistantResult.data.messageId),
              type: 'assistant',
              content: assistantContent,
              timestamp: new Date(),
              metadata: opensourceAlgorithms?.length
                ? { opensource_algorithms: opensourceAlgorithms }
                : undefined,
            };
            setMessages((prev) => [...prev, assistantMessage]);


            // Update conversation message count
            setConversations((prev) =>
              prev.map((c) =>
                c.id === capturedConversationId
                  ? { ...c, messageCount: assistantResult.data!.conversation.message_count }
                  : c
              )
            );
          }

          // TICKET_558: Sync strategy_rules -- always update to prevent stale state
          if (response.result.strategy_rules) {
            const serverRules = response.result.strategy_rules;

            // TICKET_528: Store complete StrategyRulesResponse for Round 3 requests
            setFullStrategyRules(serverRules);

            const newRules: StrategyRule[] = [];

            // Convert entry conditions
            serverRules.entry_conditions?.forEach((ec) => {
              newRules.push({
                id: generateLocalId(),
                type: 'entry',
                condition: ec.condition,
                description: ec.action || t('pages.aiStrategyStudio.entryDescription', { type: ec.type }),
                enabled: true,
              });
            });

            // Convert exit conditions
            serverRules.exit_conditions?.forEach((ec) => {
              newRules.push({
                id: generateLocalId(),
                type: 'exit',
                condition: ec.condition,
                description: t('pages.aiStrategyStudio.exitDescription', { type: ec.type }),
                enabled: true,
              });
            });

            // TICKET_530: Always set indicators (empty array clears the section)
            setStrategyIndicators(serverRules.indicators || []);

            // TICKET_558: Always set rules (empty array clears the panel)
            setStrategyRules(newRules);
            // Persist to DB
            conversationService.updateConversation(capturedDbId, {
              strategyRules: JSON.stringify(newRules),
            }).catch((err) => console.error('[E:STRATEGY:STUDIO_SAVE_RULES_FAILED] [AIStrategyStudio] Failed to save rules:', err));
          } else {
            // TICKET_558: No strategy_rules in response -- clear stale state
            setStrategyRules([]);
            setFullStrategyRules(null);
            setStrategyIndicators([]);

            // Clear persisted rules in DB
            conversationService.updateConversation(capturedDbId, {
              strategyRules: JSON.stringify([]),
            }).catch((err) => console.error('[E:STRATEGY:STUDIO_CLEAR_RULES_FAILED] [AIStrategyStudio] Failed to clear rules:', err));
          }

          // TICKET_467: Sync available_actions from backend response
          setBackendActions(response.result.available_actions || []);

          // TICKET_595: Auto-generate session title on first message
          // Frontend-driven: uses message_count from local DB (source of truth),
          // not backend conversation_history which may be stale after delete/recreate.
          if (isFirstMessage) {
            let sessionTitle: string | undefined;

            // Priority 1: Backend suggested_title (works for truly new backend sessions)
            if (response.result.suggested_title) {
              sessionTitle = response.result.suggested_title;
            }

            // Priority 2: Extract strategy name from LLM response
            if (!sessionTitle && assistantContent) {
              const namePatterns = [
                /[""\u201c]([A-Z][A-Za-z0-9 ]{3,45}(?:Strategy|Trading|Crossover|Reversal|Breakout|System))[""\u201d]/,
                /\*\*([A-Z][A-Za-z0-9 ]{3,45}(?:Strategy|Trading|Crossover|Reversal|Breakout|System))\*\*/,
              ];
              for (const pattern of namePatterns) {
                const match = assistantContent.match(pattern);
                if (match) {
                  sessionTitle = match[1].trim().slice(0, 50);
                  break;
                }
              }
            }

            // Priority 3: First sentence of user message
            if (!sessionTitle) {
              const firstSentence = content.split(/[.!?\n]/)[0].trim();
              if (firstSentence.length >= 5) {
                sessionTitle = firstSentence.length > 50
                  ? firstSentence.slice(0, 47) + '...'
                  : firstSentence;
              }
            }

            if (sessionTitle) {
              // Deduplicate: append sequence number if same title already exists
              setConversations((prev) => {
                const baseTitle = sessionTitle!;
                const otherTitles = prev
                  .filter((c) => c.id !== capturedConversationId)
                  .map((c) => c.title);

                let finalTitle = baseTitle;
                if (otherTitles.includes(baseTitle)) {
                  let seq = 2;
                  while (otherTitles.includes(`${baseTitle} (${seq})`)) {
                    seq++;
                  }
                  finalTitle = `${baseTitle} (${seq})`;
                }

                conversationService.updateConversation(capturedDbId, {
                  title: finalTitle,
                }).catch((err) => console.error('[E:STRATEGY:STUDIO_UPDATE_TITLE_FAILED] [AIStrategyStudio] Failed to update title:', err));

                return prev.map((c) =>
                  c.id === capturedConversationId
                    ? { ...c, title: finalTitle }
                    : c
                );
              });
            }
          }
        } else {
          // Handle error response
          const errorMessage = resolveErrorMessage(getVibingChatErrorMessage(response));
          const errorResult = await conversationService.addMessage({
            conversationId: capturedDbId,
            type: 'system',
            content: t('pages.aiStrategyStudio.errorPrefix', { message: errorMessage }),
            tokenCount: 0,
          });

          if (errorResult.success && errorResult.data) {
            const systemMessage: Message = {
              id: String(errorResult.data.messageId),
              type: 'system',
              content: t('pages.aiStrategyStudio.errorPrefix', { message: errorMessage }),
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, systemMessage]);
          }
        }
      } catch (error) {
        // TICKET_558: Silently ignore AbortError (user-initiated cancellation)
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.info('[AIStrategyStudio] Request cancelled');
          return;
        }

        console.error('[E:STRATEGY:STUDIO_API_CALL_FAILED] [AIStrategyStudio] API call failed:', error);

        // Handle network/auth errors
        const errorMessage = error instanceof Error ? error.message : t('pages.aiStrategyStudio.unknownError');
        try {
          const errorResult = await conversationService.addMessage({
            conversationId: capturedDbId,
            type: 'system',
            content: t('pages.aiStrategyStudio.errorPrefix', { message: errorMessage }),
            tokenCount: 0,
          });

          if (errorResult.success && errorResult.data) {
            const systemMessage: Message = {
              id: String(errorResult.data.messageId),
              type: 'system',
              content: t('pages.aiStrategyStudio.errorPrefix', { message: errorMessage }),
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, systemMessage]);
          }
        } catch (saveError) {
          console.error('[E:STRATEGY:STUDIO_SAVE_ERROR_MESSAGE_FAILED] [AIStrategyStudio] Failed to save error message:', saveError);
        }
      } finally {
        // TICKET_558: Only clear loading if this request is still the active one
        if (activeRequestRef.current === abortController) {
          activeRequestRef.current = null;
        }
        setIsLoading(false);
      }
    } catch (error) {
      console.error('[E:STRATEGY:STUDIO_SEND_MESSAGE_FAILED] [AIStrategyStudio] Failed to send message:', error);
      setIsLoading(false);
    }
  }, [inputValue, isLoading, activeDbId, activeConversationId, fullStrategyRules, initialStrategyName, strategyId, userId, llmProvider, llmModel, resolveErrorMessage]);

  // -------------------------------------------------------------------------
  // TICKET_708 + TICKET_709 Phase 3: Compilation Status Feedback
  // Subscribe once on mount using refs to avoid race condition.
  // The compilation fires non-blocking immediately after save in main process
  // (algorithm-handlers.ts:130). If we depend on React state + useEffect,
  // the subscription may be established AFTER the compilation event is emitted.
  // By using a stable mount-time subscription with ref-based ID check, we
  // guarantee no events are missed.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = window.electronAPI?.executor?.onCompilationStatus?.(
      (update) => {
        const currentAlgId = lastSavedAlgorithmIdRef.current;
        const currentDbId = activeDbIdRef.current;
        if (!currentAlgId || !currentDbId) return;
        if (update.algorithmId !== String(currentAlgId)) return;

        if (update.status === 'success' || update.status === 'error') {
          const content = update.status === 'success'
            ? t('pages.aiStrategyStudio.actionResults.compilationSuccess')
            : t('pages.aiStrategyStudio.actionResults.compilationFailed', { summary: update.parsedErrors?.summary || update.error || 'Unknown error' });

          // Add system message to chat (fire-and-forget for DB persistence)
          conversationService.addMessage({
            conversationId: currentDbId,
            type: 'system',
            content,
            tokenCount: 0,
          }).then((result) => {
            if (result.success && result.data) {
              const systemMessage: Message = {
                id: String(result.data.messageId),
                type: 'system',
                content,
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, systemMessage]);
            }
          }).catch((err) => {
            console.error('[E:STRATEGY:STUDIO_SAVE_COMPILATION_STATUS_FAILED] [AIStrategyStudio] [TICKET_708] Failed to save compilation status message:', err);
          });
        }
      }
    );

    return () => { unsubscribe?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // -------------------------------------------------------------------------
  // Action Handlers
  // -------------------------------------------------------------------------
  const handleAction = useCallback(async (actionId: ActionId) => {
    if (!activeDbId) return;

    // TICKET_558: Abort previous in-flight request before action
    activeRequestRef.current?.abort();
    const abortController = new AbortController();
    activeRequestRef.current = abortController;

    setActionStates((prev) => ({ ...prev, [actionId]: true }));

    try {
      const sessionId = `strategy-${activeDbId}-session`;

      // TICKET_528: Preserve complete strategy_rules structure for action triggers
      // Use fullStrategyRules (complete backend data) instead of strategyRules (UI display format)
      const currentRules: Partial<StrategyRulesResponse> | undefined = fullStrategyRules
        ? fullStrategyRules // Send complete structure (indicators, risk_management, completeness_score)
        : undefined;

      const response = await executeVibingChatAction(
        sessionId,
        actionId,
        currentRules,
        llmProvider as VibingChatRequest['model'],
        llmModel,
        abortController.signal
      );

      if (response.success && response.result) {
        const actionLabels: Record<ActionId, string> = {
          generate_code: t('pages.aiStrategyStudio.actionResults.codeGenerated'),
        };

        // If action returned content, show it as assistant message
        if (response.result.content) {
          const assistantTokens = estimateTokens(response.result.content);
          const assistantResult = await conversationService.addMessage({
            conversationId: activeDbId,
            type: 'assistant',
            content: response.result.content,
            tokenCount: assistantTokens,
          });

          if (assistantResult.success && assistantResult.data) {
            const assistantMessage: Message = {
              id: String(assistantResult.data.messageId),
              type: 'assistant',
              content: response.result.content,
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
          }
        }

        // Add system message for action completion
        const systemResult = await conversationService.addMessage({
          conversationId: activeDbId,
          type: 'system',
          content: actionLabels[actionId],
          tokenCount: 0,
        });

        if (systemResult.success && systemResult.data) {
          const systemMessage: Message = {
            id: String(systemResult.data.messageId),
            type: 'system',
            content: actionLabels[actionId],
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, systemMessage]);
        }

        // TICKET_467: Sync available_actions from backend response
        if (response.result.available_actions) {
          setBackendActions(response.result.available_actions);
        }

        // TICKET_528: Store complete StrategyRulesResponse for subsequent requests
        if (response.result.strategy_rules) {
          setFullStrategyRules(response.result.strategy_rules);
        }

        // TICKET_592 Phase 2: Save to local DB immediately on generate_code
        // Consistent with other builders -- audit triggers on code generation, not manual save
        if (actionId === 'generate_code' && response.result.type === 'strategy_code' && response.result.content) {
          try {
            const storageService = getAlgorithmStorageService();
            const code = response.result.content;
            const classNameMatch = code.match(/class\s+(\w+)\s*\(/);
            const className = response.result.class_name || (classNameMatch ? classNameMatch[1] : 'AIStudioStrategy');
            const strategyName = initialStrategyName || t('common.untitledAIStudio');

            const saveResult = await storageService.save({
              strategy_name: strategyName,
              code,
              user_id: userId || 'default',
              strategy_type: StrategyType.TYPE_EXECUTION,
              storage_mode: StorageMode.LOCAL,
              classification_metadata: {
                signal_source: SignalSource.AI_STUDIO,
                strategy_role: 'execution',
                trading_style: 'ai_driven',
                strategy_composition: 'atomic',
                class_name: className,
                components: {
                  indicator: {
                    llm_provider: llmProvider,
                    llm_model: llmModel,
                  },
                },
                tags: ['vibing_chat', 'aiStudio', 'conversational'],
                created_at: new Date().toISOString(),
              },
            });

            // TICKET_708 + TICKET_709 Phase 3: Track algorithm ID for compilation status feedback
            // Use ref (not state) so the mount-time subscription immediately sees the new ID
            // without waiting for a React re-render cycle -- eliminates the race condition
            // where compilation completes before the subscription useEffect re-runs.
            if (saveResult.success && saveResult.data?.id) {
              lastSavedAlgorithmIdRef.current = saveResult.data.id;
            }
          } catch (saveErr) {
            console.error('[E:STRATEGY:STUDIO_LOCAL_DB_SAVE_FAILED] [AIStrategyStudio] [TICKET_592] Local DB save failed:', saveErr);
          }
        }
      } else {
        // Handle error
        const errorMessage = resolveErrorMessage(getVibingChatErrorMessage(response));
        const errorResult = await conversationService.addMessage({
          conversationId: activeDbId,
          type: 'system',
          content: t('pages.aiStrategyStudio.actionFailedPrefix', { message: errorMessage }),
          tokenCount: 0,
        });

        if (errorResult.success && errorResult.data) {
          const systemMessage: Message = {
            id: String(errorResult.data.messageId),
            type: 'system',
            content: t('pages.aiStrategyStudio.actionFailedPrefix', { message: errorMessage }),
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, systemMessage]);
        }
      }
    } catch (error) {
      // TICKET_558: Silently ignore AbortError (user-initiated cancellation)
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.info('[AIStrategyStudio] Action cancelled');
        return;
      }

      console.error('[E:STRATEGY:STUDIO_ACTION_FAILED] [AIStrategyStudio] Action failed:', error);

      const errorMessage = error instanceof Error ? error.message : t('pages.aiStrategyStudio.unknownError');
      try {
        const errorResult = await conversationService.addMessage({
          conversationId: activeDbId,
          type: 'system',
          content: t('pages.aiStrategyStudio.actionFailedPrefix', { message: errorMessage }),
          tokenCount: 0,
        });

        if (errorResult.success && errorResult.data) {
          const systemMessage: Message = {
            id: String(errorResult.data.messageId),
            type: 'system',
            content: t('pages.aiStrategyStudio.actionFailedPrefix', { message: errorMessage }),
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, systemMessage]);
        }
      } catch (saveError) {
        console.error('[E:STRATEGY:STUDIO_SAVE_ACTION_ERROR_FAILED] [AIStrategyStudio] Failed to save error message:', saveError);
      }
    } finally {
      // TICKET_558: Only clear ref if this is still the active request
      if (activeRequestRef.current === abortController) {
        activeRequestRef.current = null;
      }
      setActionStates((prev) => ({ ...prev, [actionId]: false }));
    }
  }, [activeDbId, fullStrategyRules, llmProvider, llmModel, userId, initialStrategyName, resolveErrorMessage]); // TICKET_528, TICKET_592

  // -------------------------------------------------------------------------
  // Strategy Rules Handlers
  // -------------------------------------------------------------------------
  const saveRulesToDb = useCallback(async (rules: StrategyRule[]) => {
    if (!activeDbId) return;

    try {
      await conversationService.updateConversation(activeDbId, {
        strategyRules: JSON.stringify(rules),
      });
    } catch (error) {
      console.error('[E:STRATEGY:STUDIO_SAVE_RULES_PERSIST_FAILED] [AIStrategyStudio] Failed to save rules:', error);
    }
  }, [activeDbId]);

  // TICKET_529: handleAddRule removed - AI Studio is AI-driven only
  // Rules come from vibing_chat API responses, not manual user input
  // See TICKET_529_AI_STUDIO_MANUAL_ADD_RULE_DESIGN_CONFLICT.md for rationale

  const handleEditRule = useCallback((id: string, updates: Partial<StrategyRule>) => {
    setStrategyRules((prev) => {
      const updated = prev.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule));
      saveRulesToDb(updated);
      return updated;
    });
  }, [saveRulesToDb]);

  const handleDeleteRule = useCallback((id: string) => {
    setStrategyRules((prev) => {
      const updated = prev.filter((rule) => rule.id !== id);
      saveRulesToDb(updated);
      return updated;
    });
  }, [saveRulesToDb]);

  const handleToggleRule = useCallback((id: string) => {
    setStrategyRules((prev) => {
      const updated = prev.map((rule) =>
        rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
      );
      saveRulesToDb(updated);
      return updated;
    });
  }, [saveRulesToDb]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div
      className={cn(
        'flex flex-col h-full w-full overflow-hidden',
        'bg-color-terminal-bg',
        className
      )}
    >
      {/* TICKET_558: Zone A removed - title and settings icon merged into BreadcrumbBar */}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Conversation History */}
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          isLoading={isLoadingConversations}
          width={384}
        />

        {/* Main Area - Chat Interface */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Messages Container */}
          <MessagesContainer
            messages={messages}
            isLoading={isLoading}
            welcomeTitle={t('pages.aiStrategyStudio.welcomeTitle')}
            welcomeSubtitle={t('pages.aiStrategyStudio.welcomeSubtitle')}
          />

          {/* Action Buttons */}
          {availableActions.length > 0 && (
            <div className="px-4">
              <ActionButtons
                actions={availableActions}
                onAction={handleAction}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Chat Input Area */}
          <ChatInputArea
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSendMessage}
            disabled={isLoading || !activeDbId}
            isLoading={isLoading}
            placeholder={activeDbId ? t('pages.aiStrategyStudio.chatPlaceholder') : t('pages.aiStrategyStudio.chatPlaceholderDisabled')}
          />
        </main>

        {/* Right Sidebar - Strategy Rules (TICKET_529: AI-driven only) */}
        <StrategyRulesPanel
          rules={strategyRules}
          indicators={strategyIndicators}
          onEditRule={handleEditRule}
          onDeleteRule={handleDeleteRule}
          onToggleRule={handleToggleRule}
          width={360}
        />
      </div>
    </div>
  );
};

export default AIStrategyStudioPage;
