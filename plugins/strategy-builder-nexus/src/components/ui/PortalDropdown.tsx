/**
 * PortalDropdown Component
 *
 * Renders dropdown content via React Portal to escape overflow clipping contexts.
 * Use this when dropdown needs to appear above parent containers with overflow: auto/hidden.
 *
 * @see TICKET_078 - Input Theming and Portal Patterns
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { THEME_COLORS } from '@shared/constants/colors';
import { Z_INDEX_PORTAL } from '@shared/constants/z-index';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PortalDropdownProps {
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Reference to the trigger element for positioning */
  triggerRef: React.RefObject<HTMLElement>;
  /** Callback when dropdown should close */
  onClose: () => void;
  /** Dropdown content */
  children: React.ReactNode;
  /** Optional max height (default: 240px) */
  maxHeight?: number;
  /** Optional z-index (default: Z_INDEX_PORTAL) */
  zIndex?: number;
}

// -----------------------------------------------------------------------------
// PortalDropdown Component
// -----------------------------------------------------------------------------

export const PortalDropdown: React.FC<PortalDropdownProps> = ({
  isOpen,
  triggerRef,
  onClose,
  children,
  maxHeight = 240,
  zIndex = Z_INDEX_PORTAL,
}) => {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate position based on trigger element
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [isOpen, triggerRef]);

  // Handle click outside, Escape, and scroll events
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isOutsideTrigger = triggerRef.current && !triggerRef.current.contains(target);
      const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(target);

      if (isOutsideTrigger && isOutsideDropdown) {
        onClose();
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleScroll = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        });
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed overflow-y-auto rounded shadow-xl"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight,
        zIndex,
        backgroundColor: THEME_COLORS.INPUT_BG,
        border: `1px solid ${THEME_COLORS.INPUT_BORDER}`,
      }}
    >
      {children}
    </div>,
    document.body
  );
};

export default PortalDropdown;
