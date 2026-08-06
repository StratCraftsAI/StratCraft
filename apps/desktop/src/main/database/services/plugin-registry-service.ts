/**
 * PluginRegistryService - Manages plugin metadata and Hub permissions
 * 
 * Stores manifest-declared permissions in the framework database
 * to enable fast runtime checks without re-parsing JSON files.
 * 
 * Related: TICKET_117_1 - Phase 3
 */

import { DatabaseManager } from '../db-manager';
import { EntityService } from './entity-service';
import { dbLog } from '../../utils/logger';

export interface PluginRegistryRecord {
  plugin_id: string;
  version: string;
  display_name: string;
  hub_contributes: string; // JSON
  hub_consumes: string;    // JSON
  status: 'active' | 'inactive' | 'disabled';
  installed_at: string;
  updated_at: string;
}

export class PluginRegistryService extends EntityService<any> {
  constructor(db: DatabaseManager) {
    super(db, 'plugin_registry');
  }

  /**
   * Register or update a plugin's manifest declarations
   */
  async registerPlugin(manifest: any): Promise<void> {
    const { id, version, displayName, hub } = manifest;
    
    const record = {
      plugin_id: id,
      version,
      display_name: displayName || id,
      hub_contributes: JSON.stringify(hub?.contributes || []),
      hub_consumes: JSON.stringify(hub?.consumes || []),
      status: 'active',
      updated_at: new Date().toISOString()
    };

    try {
      // Use UPSERT pattern
      const query = `
        INSERT INTO plugin_registry (
          plugin_id, version, display_name, hub_contributes, hub_consumes, status, updated_at
        ) VALUES (
          @plugin_id, @version, @display_name, @hub_contributes, @hub_consumes, @status, @updated_at
        )
        ON CONFLICT(plugin_id) DO UPDATE SET
          version = excluded.version,
          display_name = excluded.display_name,
          hub_contributes = excluded.hub_contributes,
          hub_consumes = excluded.hub_consumes,
          updated_at = excluded.updated_at;
      `;
      
      this.db.prepare(query).run(record);
      dbLog.info(`[PluginRegistry] Registered plugin: ${id} v${version}`);
    } catch (error) {
      dbLog.error(`[PluginRegistry] Failed to register plugin ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get permissions for a specific plugin
   */
  async getPermissions(pluginId: string): Promise<{ contributes: string[], consumes: string[] } | null> {
    try {
      const stmt = this.db.prepare('SELECT hub_contributes, hub_consumes FROM plugin_registry WHERE plugin_id = ?');
      const row = stmt.get(pluginId) as any;
      
      if (!row) return null;

      return {
        contributes: JSON.parse(row.hub_contributes || '[]'),
        consumes: JSON.parse(row.hub_consumes || '[]')
      };
    } catch (error) {
      dbLog.error(`[PluginRegistry] Failed to get permissions for ${pluginId}:`, error);
      return null;
    }
  }
}
