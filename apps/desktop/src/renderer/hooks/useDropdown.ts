/**
 * useDropdown -- Renderer dismiss-behavior hook for dropdown/popover components.
 *
 * TICKET_1033: Unified Dropdown Dismiss Behavior
 *
 * Built-in behaviors:
 * - Click outside the dropdown (mousedown) closes it
 * - Escape key closes it
 * - Focus returns to the trigger element on close
 *
 * Usage:
 *   const { isOpen, open, close, toggle, triggerRef, dropdownRef, triggerProps } = useDropdown();
 *
 * Attach triggerRef to your button, dropdownRef to the dropdown container.
 * Spread triggerProps onto the trigger element for ARIA attributes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDropdownOptions {
  onClose?: () => void;
  onOpen?: () => void;
}

export interface UseDropdownReturn<
  TTrigger extends HTMLElement = HTMLButtonElement,
  TDropdown extends HTMLElement = HTMLDivElement,
> {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerRef: React.RefObject<TTrigger>;
  dropdownRef: React.RefObject<TDropdown>;
  triggerProps: {
    'aria-expanded': boolean;
    'aria-haspopup': true;
  };
}

export function useDropdown<
  TTrigger extends HTMLElement = HTMLButtonElement,
  TDropdown extends HTMLElement = HTMLDivElement,
>(opts?: UseDropdownOptions): UseDropdownReturn<TTrigger, TDropdown> {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<TTrigger>(null);
  const dropdownRef = useRef<TDropdown>(null);
  const prevOpenRef = useRef(false);

  const open = useCallback(() => {
    setIsOpen(true);
    opts?.onOpen?.();
  }, [opts?.onOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
    opts?.onClose?.();
  }, [opts?.onClose]);

  const toggle = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev;
      if (next) opts?.onOpen?.();
      else opts?.onClose?.();
      return next;
    });
  }, [opts?.onOpen, opts?.onClose]);

  // Click-outside + Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleMousedown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handleMousedown);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleMousedown);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [isOpen, close]);

  // Focus return on close
  useEffect(() => {
    if (prevOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  return {
    isOpen,
    open,
    close,
    toggle,
    triggerRef,
    dropdownRef,
    triggerProps: {
      'aria-expanded': isOpen,
      'aria-haspopup': true as const,
    },
  };
}
