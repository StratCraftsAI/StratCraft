/**
 * useHubFile - React hook for File Sharing Hub
 * 
 * Provides convenient React interface for file operations in the Data Hub.
 * 
 * Related: TICKET_117_2 - File Sharing Hub
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { hubClient } from '../lib/hub-client';
import { useHubEvent } from './use-hub';

interface FileRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  storageType: 'blob' | 'external';
  createdBy: string;
  createdAt: string;
  description?: string;
  tags?: string[];
}

interface FileMetadata {
  name: string;
  type: 'strategy' | 'data' | 'report' | 'config' | 'cache';
  mimeType?: string;
  sourcePath?: string;
  content?: Buffer;
  description?: string;
  tags?: string[];
}

/**
 * Hook for managing a specific file
 */
export function useHubFile(fileId?: string, fileType?: string) {
  const { t: tErrors } = useTranslation('errors');
  const [file, setFile] = useState<FileRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Translate MSG_*-prefixed messages from hub-client; pass other strings through.
  const tHubError = useCallback(
    (msg: string): string => (msg.startsWith('MSG_') ? tErrors(msg) : msg),
    [tErrors],
  );

  // Load file metadata when fileId changes
  useEffect(() => {
    if (fileId && fileType) {
      setLoading(true);
      setError(null);

      hubClient.files.get(fileId, fileType).then(result => {
        if (result.success) {
          setFile(result.data as FileRecord);
        } else {
          setError(tHubError(result.error.message));
        }
      }).catch(err => {
        setError(err.message);
      }).finally(() => {
        setLoading(false);
      });
    }
  }, [fileId, fileType, tHubError]);

  // Register a new file
  const registerFile = useCallback(async (metadata: FileMetadata) => {
    setLoading(true);
    setError(null);

    try {
      const result = await hubClient.files.save(metadata);
      if (result.success) {
        return result.data;
      } else {
        const translated = tHubError(result.error.message);
        setError(translated);
        throw new Error(translated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [tHubError]);

  // Resolve file to get content or path
  const resolveFile = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await hubClient.files.resolve(id);
      if (result.success) {
        return result.data;
      } else {
        const translated = tHubError(result.error.message);
        setError(translated);
        throw new Error(translated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [tHubError]);

  // Remove file
  const removeFile = useCallback(async (id: string, deletePhysical = true) => {
    setLoading(true);
    setError(null);

    try {
      const result = await hubClient.files.remove(id, deletePhysical);
      if (result.success) {
        if (id === fileId) {
          setFile(null);
        }
      } else {
        const translated = tHubError(result.error.message);
        setError(translated);
        throw new Error(translated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fileId, tHubError]);

  return {
    file,
    loading,
    error,
    registerFile,
    resolveFile,
    removeFile,
  };
}

/**
 * Hook for querying files
 */
export function useHubFiles(query: {
  type?: string;
  created_by?: string;
  tags?: string[];
  name_pattern?: string;
}) {
  const { t: tErrors } = useTranslation('errors');
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stabilize query object to prevent infinite re-renders
  const stableQuery = useMemo(() => query, [
    query.type,
    query.created_by,
    query.name_pattern,
    JSON.stringify(query.tags || []),
  ]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await hubClient.files.find(stableQuery);
      if (result.success) {
        setFiles(result.data as FileRecord[]);
      } else {
        const msg = result.error.message;
        setError(msg.startsWith('MSG_') ? tErrors(msg) : msg);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [stableQuery, tErrors]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for file events to auto-refresh
  useHubEvent('file:registered', () => {
    refresh();
  });

  useHubEvent('file:removed', () => {
    refresh();
  });

  return {
    files,
    loading,
    error,
    refresh,
  };
}
