/**
 * ModalProvider - Context provider for modal dialogs
 *
 * @see TICKET_096 - Host Layer Message Utils Design (Section 11)
 */

import React, { createContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ModalDialog } from './ModalDialog';
import type { ModalOptions, ModalState, ModalContextValue } from './modal-types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ModalRequestDetail {
  requestId: string;
  // TICKET_770: 'destructive' joins 'alert' and 'confirm' so plugins can
  // request the red Trash2 header + red OK button variant via the event
  // bridge without importing host code.
  type: 'alert' | 'confirm' | 'destructive';
  content: string;
  title?: string;
  action?: string;
  okText?: string;
  cancelText?: string;
}

// Extended state to track plugin requests
interface ExtendedModalState extends ModalState {
  requestId?: string;
}

// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

export const ModalContext = createContext<ModalContextValue | null>(null);

// -----------------------------------------------------------------------------
// Provider Component
// -----------------------------------------------------------------------------

interface ModalProviderProps {
  children: React.ReactNode;
}

export function ModalProvider({ children }: ModalProviderProps) {
  const [state, setState] = useState<ExtendedModalState>({
    visible: false,
    options: null,
    resolve: null,
    requestId: undefined,
  });

  // Use ref to track current requestId for event response
  const requestIdRef = useRef<string | undefined>(undefined);

  const showModal = useCallback((options: ModalOptions): Promise<boolean> => {
    return new Promise(resolve => {
      requestIdRef.current = undefined;
      setState({
        visible: true,
        options,
        resolve,
        requestId: undefined,
      });
    });
  }, []);

  const handleOk = useCallback(() => {
    // If this was a plugin request, send response event
    if (requestIdRef.current) {
      window.dispatchEvent(
        new CustomEvent('nexus:modal-response', {
          detail: { requestId: requestIdRef.current, result: true },
        })
      );
    }
    if (state.resolve) {
      state.resolve(true);
    }
    requestIdRef.current = undefined;
    setState({
      visible: false,
      options: null,
      resolve: null,
      requestId: undefined,
    });
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    // If this was a plugin request, send response event
    if (requestIdRef.current) {
      window.dispatchEvent(
        new CustomEvent('nexus:modal-response', {
          detail: { requestId: requestIdRef.current, result: false },
        })
      );
    }
    if (state.resolve) {
      state.resolve(false);
    }
    requestIdRef.current = undefined;
    setState({
      visible: false,
      options: null,
      resolve: null,
      requestId: undefined,
    });
  }, [state.resolve]);

  // Listen for plugin modal requests (TICKET_096)
  useEffect(() => {
    const handleModalRequest = (event: Event) => {
      const customEvent = event as CustomEvent<ModalRequestDetail>;
      const { requestId, type, content, title, action, okText, cancelText } = customEvent.detail;

      console.log('[ModalProvider] Received modal request:', { requestId, type, content: content?.substring(0, 100), title });

      // TICKET_770: map the wire type to ModalDialog's ModalType. 'alert'
      // collapses to 'info' (single-OK), 'confirm' and 'destructive' are
      // preserved as-is so the dialog can render their distinct visuals.
      const dialogType =
        type === 'destructive' ? 'destructive'
        : type === 'confirm' ? 'confirm'
        : 'info';
      const showCancel = type === 'confirm' || type === 'destructive';

      requestIdRef.current = requestId;
      setState({
        visible: true,
        options: {
          type: dialogType,
          content,
          title,
          showCancel,
          action,
          okText,
          cancelText,
        },
        resolve: null,
        requestId,
      });
    };

    console.log('[ModalProvider] Registering nexus:modal-request listener');
    window.addEventListener('nexus:modal-request', handleModalRequest);
    return () => {
      console.log('[ModalProvider] Removing nexus:modal-request listener');
      window.removeEventListener('nexus:modal-request', handleModalRequest);
    };
  }, []);

  // Convenience methods
  const confirm = useCallback(
    (
      content: string,
      options?: Omit<ModalOptions, 'type' | 'content'>
    ): Promise<boolean> => {
      return showModal({
        ...options,
        type: 'confirm',
        content,
        showCancel: true,
      });
    },
    [showModal]
  );

  const alert = useCallback(
    async (
      content: string,
      options?: Omit<ModalOptions, 'content'>
    ): Promise<void> => {
      await showModal({
        ...options,
        type: options?.type ?? 'info',
        content,
        showCancel: false,
      });
    },
    [showModal]
  );

  const value = useMemo<ModalContextValue>(
    () => ({
      showModal,
      confirm,
      alert,
    }),
    [showModal, confirm, alert]
  );

  return (
    <ModalContext.Provider value={value}>
      {children}
      <ModalDialog
        visible={state.visible}
        options={state.options}
        onOk={handleOk}
        onCancel={handleCancel}
      />
    </ModalContext.Provider>
  );
}
