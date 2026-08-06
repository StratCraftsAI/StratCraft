/**
 * Z-Index Layer Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * Centralized z-index scale for consistent stacking context across the UI.
 * Use inline style={{ zIndex: Z_INDEX_* }} (Tailwind JIT does not support
 * template-literal class names).
 */

/** Sticky header inside a scroll container (local stacking context) */
export const Z_INDEX_INLINE_STICKY = 10;

/** Local popover anchored to a parent (below global layers) */
export const Z_INDEX_LOCAL_POPOVER = 50;

/** Assistant contextual help panel (TICKET_593_1) */
export const Z_INDEX_ASSISTANT_PANEL = 500;

/** Floating progress monitor overlay (TICKET_897) */
export const Z_INDEX_FLOATING_MONITOR = 800;

/** Dropdown overlay (e.g., WorkflowDropdown) */
export const Z_INDEX_DROPDOWN = 1000;

/** Elevated dropdown (e.g., TimeframeDropdown above another dropdown) */
export const Z_INDEX_DROPDOWN_ELEVATED = 1001;

/** Toast / notification container */
export const Z_INDEX_MESSAGE = 9999;

/** Modal backdrop + dialog */
export const Z_INDEX_MODAL = 10000;

/** Portal dropdown (rendered in document.body, must float above everything) */
export const Z_INDEX_PORTAL = 99999;
