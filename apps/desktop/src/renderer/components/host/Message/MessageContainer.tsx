/**
 * MessageContainer - Fixed position container for message notifications
 *
 * @see TICKET_096 - Host Layer Message Utils Design
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MessageItem } from './MessageItem';
import { Z_INDEX_MESSAGE } from '@shared/constants/z-index';
import type { Message } from './types';

interface MessageContainerProps {
  messages: Message[];
  onDismiss: (id: string) => void;
}

export function MessageContainer({ messages, onDismiss }: MessageContainerProps) {
  const { t } = useTranslation('ui');
  if (messages.length === 0) {
    return null;
  }

  return createPortal(
    <div
      className="fixed top-6 right-6 flex flex-col gap-2 max-w-[400px] pointer-events-none"
      style={{ zIndex: Z_INDEX_MESSAGE }}
      aria-live="polite"
      aria-label={t('notifications.regionLabel')}
    >
      {messages.map(message => (
        <div key={message.id} className="pointer-events-auto">
          <MessageItem message={message} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body
  );
}
