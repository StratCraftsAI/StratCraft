/**
 * Centralized renderer-layer CustomEvent names
 *
 * TICKET_179: NO MAGIC NUMBERS - all event strings in one place
 * TICKET_507: Added MODEL_POOL_CHANGED for status bar sync
 *
 * Usage (dispatch):
 *   window.dispatchEvent(new CustomEvent(RENDERER_EVENTS.LLM_SELECTION_CHANGED, { detail }));
 *
 * Usage (listen):
 *   window.addEventListener(RENDERER_EVENTS.LLM_SELECTION_CHANGED, handler);
 */

export const RENDERER_EVENTS = {
  /** LLM provider/model selection changed in status bar */
  LLM_SELECTION_CHANGED: 'llm-selection-changed',

  /** TICKET_507: Nona model pool changed (add/remove user models) */
  MODEL_POOL_CHANGED: 'nexus:model-pool-changed',

  /** Authentication required - highlights login button */
  AUTH_REQUIRED: 'nexus:auth-required',

  /** View provider registered */
  VIEW_PROVIDER_REGISTERED: 'nexus:view-provider-registered',

  /** View change notification */
  VIEW_CHANGE: 'nexus:view-change',

  /** View close notification */
  VIEW_CLOSE: 'nexus:view-close',

  /** Editor open request */
  EDITOR_OPEN: 'nexus:editor-open',

  /** Modal dialog request (plugin -> host) */
  MODAL_REQUEST: 'nexus:modal-request',

  /** Modal dialog response (host -> plugin) */
  MODAL_RESPONSE: 'nexus:modal-response',

  /** Plugin command dispatch */
  PLUGIN_COMMAND: 'plugin:command',

  /** TICKET_701: Plugin signals generation busy state (plugin -> host) */
  GENERATION_BUSY: 'nexus:generation-busy',

  /** TICKET_701: Host requests plugin cancel generation (host -> plugin) */
  GENERATION_CANCEL: 'nexus:generation-cancel',
} as const;
