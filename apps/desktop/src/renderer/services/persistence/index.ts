/**
 * Persistence Service
 *
 * Centralized state persistence for framework and plugins.
 *
 * @see TICKET_007 - PersistenceManager design
 */

export { persistenceManager, usePersistence } from './persistence-manager';

export type {
  FrameworkPersistentState,
  PluginPersistentState,
  ViewId,
  WindowBounds,
} from './types';

export { FRAMEWORK_STATE_DEFAULTS, STORAGE_KEYS } from './types';
