/**
 * Message Utils Exports
 *
 * @see TICKET_096 - Host Layer Message Utils Design
 */

// Toast notifications
export { MessageProvider, MessageContext } from './MessageProvider';
export { MessageContainer } from './MessageContainer';
export { MessageItem } from './MessageItem';
export type {
  Message,
  MessageType,
  MessageAction,
  MessageOptions,
  MessageContextValue,
} from './types';
export { DEFAULT_DURATIONS, MAX_MESSAGES } from './types';

// Modal dialogs
export { ModalProvider, ModalContext } from './ModalProvider';
export { ModalDialog } from './ModalDialog';
export type {
  ModalType,
  ModalOptions,
  ModalState,
  ModalContextValue,
} from './modal-types';
