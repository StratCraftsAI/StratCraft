/**
 * MessageProvider - Context provider for message notifications
 *
 * @see TICKET_096 - Host Layer Message Utils Design
 */

import React, { createContext, useReducer, useCallback, useMemo } from 'react';
import { MessageContainer } from './MessageContainer';
import type {
  Message,
  MessageType,
  MessageOptions,
  MessageContextValue,
} from './types';
import { DEFAULT_DURATIONS, MAX_MESSAGES } from './types';

// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

export const MessageContext = createContext<MessageContextValue | null>(null);

// -----------------------------------------------------------------------------
// Reducer
// -----------------------------------------------------------------------------

type MessageAction =
  | { type: 'ADD'; payload: Message }
  | { type: 'DISMISS'; payload: string }
  | { type: 'DISMISS_ALL' };

function messageReducer(state: Message[], action: MessageAction): Message[] {
  switch (action.type) {
    case 'ADD': {
      const newMessages = [action.payload, ...state];
      // Limit to MAX_MESSAGES
      return newMessages.slice(0, MAX_MESSAGES);
    }
    case 'DISMISS':
      return state.filter(msg => msg.id !== action.payload);
    case 'DISMISS_ALL':
      return [];
    default:
      return state;
  }
}

// -----------------------------------------------------------------------------
// Provider Component
// -----------------------------------------------------------------------------

interface MessageProviderProps {
  children: React.ReactNode;
}

export function MessageProvider({ children }: MessageProviderProps) {
  const [messages, dispatch] = useReducer(messageReducer, []);

  const generateId = useCallback(() => {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const show = useCallback(
    (content: string, options?: MessageOptions): string => {
      const type = options?.type ?? 'info';
      const id = generateId();

      const message: Message = {
        id,
        type,
        content,
        duration: options?.duration ?? DEFAULT_DURATIONS[type],
        actions: options?.actions,
        dismissible: options?.dismissible ?? true,
        timestamp: Date.now(),
      };

      dispatch({ type: 'ADD', payload: message });
      return id;
    },
    [generateId]
  );

  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'DISMISS', payload: id });
  }, []);

  const dismissAll = useCallback(() => {
    dispatch({ type: 'DISMISS_ALL' });
  }, []);

  // Convenience methods
  const info = useCallback(
    (content: string, options?: Omit<MessageOptions, 'type'>) => {
      return show(content, { ...options, type: 'info' });
    },
    [show]
  );

  const success = useCallback(
    (content: string, options?: Omit<MessageOptions, 'type'>) => {
      return show(content, { ...options, type: 'success' });
    },
    [show]
  );

  const warning = useCallback(
    (content: string, options?: Omit<MessageOptions, 'type'>) => {
      return show(content, { ...options, type: 'warning' });
    },
    [show]
  );

  const error = useCallback(
    (content: string, options?: Omit<MessageOptions, 'type'>) => {
      return show(content, { ...options, type: 'error' });
    },
    [show]
  );

  const value = useMemo<MessageContextValue>(
    () => ({
      messages,
      show,
      dismiss,
      dismissAll,
      info,
      success,
      warning,
      error,
    }),
    [messages, show, dismiss, dismissAll, info, success, warning, error]
  );

  return (
    <MessageContext.Provider value={value}>
      {children}
      <MessageContainer messages={messages} onDismiss={dismiss} />
    </MessageContext.Provider>
  );
}
