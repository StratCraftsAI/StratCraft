/**
 * useMessage - Hook for accessing message notification API (toast + modal)
 *
 * @see TICKET_096 - Host Layer Message Utils Design
 */

import { useContext, useMemo } from 'react';
import { MessageContext } from '@/components/host/Message/MessageProvider';
import { ModalContext } from '@/components/host/Message/ModalProvider';
import type { MessageContextValue } from '@/components/host/Message/types';
import type { ModalContextValue } from '@/components/host/Message/modal-types';

export type UnifiedMessageContextValue = MessageContextValue & ModalContextValue;

export function useMessage(): UnifiedMessageContextValue {
  const messageContext = useContext(MessageContext);
  const modalContext = useContext(ModalContext);

  if (!messageContext) {
    throw new Error('useMessage must be used within a MessageProvider');
  }

  if (!modalContext) {
    throw new Error('useMessage must be used within a ModalProvider');
  }

  return useMemo(
    () => ({
      ...messageContext,
      ...modalContext,
    }),
    [messageContext, modalContext]
  );
}

/**
 * useModal - Hook for accessing modal dialog API only
 */
export function useModal(): ModalContextValue {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
}
