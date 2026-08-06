import type { SqliteDatabase } from '../../secure-store';

export interface Row {
  plugin_id: string;
  key: string;
  value: string;
  tier: number;
  updated_at: number;
}

export function createFakeDb(): SqliteDatabase & {
  _rows: Map<string, Row>;
  _archives: Map<string, string>;
} {
  const rows = new Map<string, Row>();
  const keyRows = new Map<string, {
    key_id: string;
    keyring_account: string;
    key_fingerprint: string;
    generation: number;
    lifecycle_status: 'available' | 'retired';
  }>();
  let state: {
    store_id: string;
    envelope_version: number;
    active_key_id: string;
    active_generation: number;
    minimum_writer_protocol: number;
  } | null = null;
  const archives = new Map<string, string>();
  const pk = (pluginId: string, key: string) => `${pluginId} ${key}`;

  return {
    _rows: rows,
    _archives: archives,
    pragma: () => undefined,
    exec: () => undefined,
    transaction<T>(fn: () => T) {
      const transaction = (() => fn()) as (() => T) & { immediate: () => T };
      transaction.immediate = () => fn();
      return transaction;
    },
    transactionImmediate<T>(fn: () => T) {
      return () => fn();
    },
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        get(...params: unknown[]): unknown {
          if (normalized.startsWith('SELECT COUNT(*) AS credential_count')) {
            const values = [...rows.values()];
            return {
              credential_count: values.length,
              legacy_count: values.filter(row => row.value.startsWith('gcm1:')).length,
              gcm2_count: values.filter(row => row.value.startsWith('gcm2:')).length,
            };
          }
          if (normalized.startsWith('SELECT plugin_id, key, value, tier, updated_at FROM credentials')) {
            const [pluginId, key] = params as [string, string];
            const row = rows.get(pk(pluginId, key));
            return row ? { ...row } : undefined;
          }
          if (normalized.startsWith('SELECT store_id, envelope_version')) return state ?? undefined;
          if (normalized.startsWith('SELECT key_id, keyring_account')) {
            return keyRows.get(params[0] as string);
          }
          if (normalized.startsWith('SELECT COUNT(*) AS count FROM secure_store_key')) {
            return {
              count: normalized.includes("lifecycle_status = 'retired'")
                ? [...keyRows.values()].filter(row => row.lifecycle_status === 'retired').length
                : keyRows.size,
            };
          }
          if (normalized.startsWith('SELECT COUNT(*) AS count FROM credentials')) {
            return {
              count: [...rows.values()].filter(row => (
                row.value.startsWith('gcm1:') || row.value.startsWith('gcm2:')
              )).length,
            };
          }
          if (normalized.startsWith('SELECT COUNT(*) AS count FROM secure_store_lifecycle_journal')) {
            return { count: 0 };
          }
          if (normalized.startsWith('SELECT COUNT(*) AS count FROM credential_recovery_archive')) {
            return { count: archives.size };
          }
          if (normalized.startsWith('SELECT plugin_id, key FROM credentials')) {
            const row = [...rows.values()].find(item => item.value.startsWith('gcm1:'));
            return row ? { plugin_id: row.plugin_id, key: row.key } : undefined;
          }
          if (normalized.startsWith('SELECT value FROM credential_recovery_archive')) {
            const value = archives.get(params[0] as string);
            return value === undefined ? undefined : { value };
          }
          throw new Error(`fake-db: unhandled get() SQL: ${normalized}`);
        },
        run(...params: unknown[]): unknown {
          if (normalized.startsWith('INSERT INTO secure_store_key')) {
            const [keyId, account, fingerprint] = params as [string, string, string];
            keyRows.set(keyId, {
              key_id: keyId,
              keyring_account: account,
              key_fingerprint: fingerprint,
              generation: 1,
              lifecycle_status: 'available',
            });
            return { changes: 1 };
          }
          if (normalized.startsWith('INSERT INTO secure_store_state')) {
            const [storeId, version, keyId, protocol] = params as [string, number, string, number];
            state = {
              store_id: storeId,
              envelope_version: version,
              active_key_id: keyId,
              active_generation: 1,
              minimum_writer_protocol: protocol,
            };
            return { changes: 1 };
          }
          if (normalized.startsWith('INSERT INTO secure_store_writer_lease')) return { changes: 1 };
          if (normalized.startsWith('DELETE FROM secure_store_writer_lease')) return { changes: 1 };
          if (normalized.startsWith('INSERT INTO secure_store_audit')) return { changes: 1 };
          if (normalized.startsWith('INSERT INTO credential_recovery_archive')) {
            const [recoveryId, , , value] = params as [string, string, string, string];
            archives.set(recoveryId, value);
            return { changes: 1 };
          }
          if (normalized.startsWith('INSERT INTO credentials')) {
            const [pluginId, key, value, tier, updatedAt] =
              params as [string, string, string, number, number];
            rows.set(pk(pluginId, key), {
              plugin_id: pluginId,
              key,
              value,
              tier,
              updated_at: updatedAt,
            });
            return { changes: 1 };
          }
          if (normalized.startsWith('DELETE FROM credentials')) {
            const [pluginId, key] = params as [string, string];
            rows.delete(pk(pluginId, key));
            return { changes: 1 };
          }
          throw new Error(`fake-db: unhandled run() SQL: ${normalized}`);
        },
        all(...params: unknown[]): unknown[] {
          if (normalized === 'SELECT value FROM credentials') {
            return [...rows.values()].map(row => ({ value: row.value }));
          }
          if (normalized === 'SELECT value FROM credential_recovery_archive') {
            return [...archives.values()].map(value => ({ value }));
          }
          if (normalized.startsWith('SELECT key FROM credentials WHERE plugin_id')) {
            const [pluginId] = params as [string];
            return [...rows.values()]
              .filter(row => row.plugin_id === pluginId)
              .sort((left, right) => left.key.localeCompare(right.key))
              .map(row => ({ key: row.key }));
          }
          if (normalized.startsWith('SELECT plugin_id, key, value, tier FROM credentials')) {
            return [...rows.values()].map(row => ({
              plugin_id: row.plugin_id,
              key: row.key,
              value: row.value,
              tier: row.tier,
            }));
          }
          // TICKET_1314_3: unreadable-cohort scan.
          if (normalized.startsWith('SELECT plugin_id, key, tier FROM credentials')) {
            return [...rows.values()]
              .sort((left, right) => (
                left.plugin_id.localeCompare(right.plugin_id) || left.key.localeCompare(right.key)
              ))
              .map(row => ({ plugin_id: row.plugin_id, key: row.key, tier: row.tier }));
          }
          if (normalized.startsWith('SELECT DISTINCT plugin_id FROM credentials')) {
            return [...new Set([...rows.values()].map(row => row.plugin_id))]
              .sort((left, right) => left.localeCompare(right))
              .map(plugin_id => ({ plugin_id }));
          }
          throw new Error(`fake-db: unhandled all() SQL: ${normalized}`);
        },
      };
    },
  };
}
