/**
 * Message Utils Type Definitions
 *
 * @see TICKET_096 - Host Layer Message Utils Design
 */

import { MESSAGE_DURATION_ERROR_MS, MESSAGE_DURATION_INFO_MS, MESSAGE_DURATION_SUCCESS_MS, MESSAGE_DURATION_WARNING_MS } from '@shared/constants/timing';

export type MessageType = 'info' | 'success' | 'warning' | 'error';

export interface MessageAction {
  label: string;
  onClick: () => void;
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  duration: number;
  actions?: MessageAction[];
  dismissible: boolean;
  timestamp: number;
}

export interface MessageOptions {
  type?: MessageType;
  duration?: number;
  actions?: MessageAction[];
  dismissible?: boolean;
}

export interface MessageContextValue {
  messages: Message[];
  show: (content: string, options?: MessageOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  info: (content: string, options?: Omit<MessageOptions, 'type'>) => string;
  success: (content: string, options?: Omit<MessageOptions, 'type'>) => string;
  warning: (content: string, options?: Omit<MessageOptions, 'type'>) => string;
  error: (content: string, options?: Omit<MessageOptions, 'type'>) => string;
}

// Default durations by message type (ms)
export const DEFAULT_DURATIONS: Record<MessageType, number> = {
  info: MESSAGE_DURATION_INFO_MS,
  success: MESSAGE_DURATION_SUCCESS_MS,
  warning: MESSAGE_DURATION_WARNING_MS,
  error: MESSAGE_DURATION_ERROR_MS,
};

export const MAX_MESSAGES = 5;
