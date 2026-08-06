/**
 * DataHubClient - Renderer-side implementation of the Unified Data Hub API
 * 
 * Provides type-safe access to shared entities, global state, and the event bus.
 * Wraps IPC calls to the main process.
 * 
 * Related: TICKET_117_1 - Unified Data Hub Pattern Design
 */

import { HubEntityType, HubEntityMap, HubEventPayload, HubEventType, HubStateMap, HubStateKey } from '../../shared/types/hub/schema';

// Standard result wrapper
export type HubResult<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

export class DataHubClient {
  private static instance: DataHubClient | null = null;
  private pluginId: string = 'system'; // Default to system for internal UI

  private constructor() {}

  static getInstance(): DataHubClient {
    if (!DataHubClient.instance) {
      DataHubClient.instance = new DataHubClient();
    }
    return DataHubClient.instance;
  }

  /**
   * Set the plugin identity for permission checks
   */
  setPluginId(id: string): void {
    this.pluginId = id;
  }

  // --- Entity API ---

  entities<K extends HubEntityType>(entityName: K) {
    const { electronAPI } = window;
    
    return {
      save: async (data: Partial<HubEntityMap[K]>): Promise<HubResult<string | number>> => {
        return await electronAPI.hub.invokeEntity('save', entityName, data, this.pluginId);
      },
      get: async (id: string | number): Promise<HubResult<HubEntityMap[K]>> => {
        return await electronAPI.hub.invokeEntity('get', entityName, id, this.pluginId);
      },
      list: async (options: any): Promise<HubResult<HubEntityMap[K][]>> => {
        return await electronAPI.hub.invokeEntity('list', entityName, options, this.pluginId);
      },
      update: async (id: string | number, data: Partial<HubEntityMap[K]>, expectedVersion?: number): Promise<HubResult<void>> => {
        return await electronAPI.hub.invokeEntity('update', entityName, { id, data, expectedVersion }, this.pluginId);
      }
    };
  }

  // --- State API ---

  state = {
    set: <K extends HubStateKey>(key: K, value: HubStateMap[K]): void => {
      window.electronAPI.hub.setState(key, value, this.pluginId);
    },
    get: async <K extends HubStateKey>(key: K): Promise<HubStateMap[K]> => {
      return await window.electronAPI.hub.getState(key);
    },
    getAll: async (): Promise<Partial<HubStateMap>> => {
      return await window.electronAPI.hub.getAllState();
    },
    /**
     * Subscribe to state changes
     */
    subscribe: <K extends HubStateKey>(key: K, callback: (val: HubStateMap[K]) => void): (() => void) => {
      return window.electronAPI.hub.onStateChanged((event: any) => {
        if (event.key === key) {
          callback(event.value);
        }
      });
    }
  };

  // --- Event Bus API ---

  events = {
    emit: <E extends HubEventType>(type: E, payload: HubEventPayload[E]): void => {
      window.electronAPI.hub.emit(type, payload, this.pluginId);
    },
    /**
     * Listen for global events
     */
    on: <E extends HubEventType>(
      type: E, 
      callback: (payload: HubEventPayload[E]) => void,
      options?: { filter?: (p: HubEventPayload[E]) => boolean, replay?: boolean }
    ): (() => void) => {
      // Handle replay if requested
      if (options?.replay) {
        window.electronAPI.hub.replay(type).then((lastPayload: any) => {
          if (lastPayload) {
            if (!options.filter || options.filter(lastPayload)) {
              callback(lastPayload);
            }
          }
        });
      }

      return window.electronAPI.hub.onEvent((event: any) => {
        if (event.event === type) {
          if (!options?.filter || options.filter(event.payload)) {
            callback(event.payload);
          }
        }
      });
    }
  };

  // --- Files API ---

  files = {
    /**
     * Register a file in the hub
     */
    save: async (metadata: Partial<HubEntityMap['file:strategy']>): Promise<HubResult<string>> => {
      if (!metadata.type) {
        // i18n key in the `errors` namespace; consumer translates MSG_* prefixed messages.
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'MSG_HUB_FILE_TYPE_REQUIRED' } };
      }
      const entityType = `file:${metadata.type}` as HubEntityType;
      return await window.electronAPI.hub.invokeEntity('save', entityType, metadata, this.pluginId);
    },

    /**
     * Get file metadata by ID
     */
    get: async (fileId: string, fileType: string): Promise<HubResult<HubEntityMap['file:strategy']>> => {
      const entityType = `file:${fileType}` as HubEntityType;
      return await window.electronAPI.hub.invokeEntity('get', entityType, fileId, this.pluginId);
    },

    /**
     * Find files by criteria
     */
    find: async (query: any): Promise<HubResult<HubEntityMap['file:strategy'][]>> => {
      return await window.electronAPI.hub.findFiles(query, this.pluginId);
    },

    /**
     * Resolve file to get content or path
     */
    resolve: async (fileId: string): Promise<HubResult<{ type: 'buffer' | 'path'; data: Buffer | string }>> => {
      return await window.electronAPI.hub.resolveFile(fileId, this.pluginId);
    },

    /**
     * Remove file registration
     */
    remove: async (fileId: string, deleteFile = true): Promise<HubResult<void>> => {
      return await window.electronAPI.hub.removeFile(fileId, deleteFile, this.pluginId);
    },
  };

  /**
   * Execute atomic transaction (Future)
   */
  async transaction(operations: any[]): Promise<HubResult<void>> {
    return await window.electronAPI.hub.transaction(operations, this.pluginId);
  }
}

export const hubClient = DataHubClient.getInstance();
export default hubClient;
