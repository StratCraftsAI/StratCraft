/**
 * FileService - Service layer for hub_files table operations
 * 
 * Implements hybrid storage strategy:
 * - Small files (<1MB): SQLite BLOB storage
 * - Large files (>=1MB): External file storage with DB reference
 * 
 * Related: TICKET_117_2 - File Sharing Hub
 */

import { DatabaseManager } from '../db-manager';
import { EntityService } from './entity-service';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  calculateChecksum,
  calculateFileChecksum,
  validatePath,
  validateMimeType,
  getSharedDirectory,
  generateUniqueFileName,
  BLOB_STORAGE_THRESHOLD,
  MAX_FILE_SIZE,
} from '../../utils/file-security';
import { dbLog } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface FileMetadata {
  name: string;
  type: 'strategy' | 'data' | 'report' | 'config' | 'cache';
  mimeType?: string;
  sourcePath?: string;   // For large files - path to source
  content?: Buffer;      // For small files - direct content
  description?: string;
  tags?: string[];
}

export interface FileRecord {
  id: string;
  name: string;
  type: string;
  mime_type: string | null;
  size: number;
  storage_type: 'blob' | 'external';
  content: Buffer | null;
  external_path: string | null;
  checksum: string | null;
  description: string | null;
  tags: string | null;  // JSON string
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface FileQuery {
  type?: string;
  created_by?: string;
  tags?: string[];
  name_pattern?: string;
}

// ============================================================================
// FileService
// ============================================================================

export class FileService extends EntityService<FileRecord> {
  constructor(db: DatabaseManager) {
    super(db, 'hub_files');
  }

  /**
   * Register a file in the hub
   * Automatically determines storage strategy based on file size
   */
  async registerFile(metadata: FileMetadata, createdBy: string): Promise<string> {
    const fileId = randomUUID();

    // Validate inputs
    if (metadata.mimeType && !validateMimeType(metadata.mimeType, metadata.name)) {
      throw new Error(`MIME type ${metadata.mimeType} does not match file extension`);
    }

    let fileSize: number;
    let fileContent: Buffer | null = null;
    let externalPath: string | null = null;
    let storageType: 'blob' | 'external';
    let checksum: string | null = null;

    // Determine content source
    if (metadata.content) {
      fileContent = metadata.content;
      fileSize = fileContent.length;
    } else if (metadata.sourcePath) {
      if (!validatePath(metadata.sourcePath)) {
        throw new Error('Invalid source path: path traversal detected');
      }
      if (!fs.existsSync(metadata.sourcePath)) {
        throw new Error(`Source file not found: ${metadata.sourcePath}`);
      }
      const stats = fs.statSync(metadata.sourcePath);
      fileSize = stats.size;
    } else {
      throw new Error('Either content or sourcePath must be provided');
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`File size ${fileSize} exceeds maximum allowed size ${MAX_FILE_SIZE}`);
    }

    // Decide storage strategy
    if (fileSize < BLOB_STORAGE_THRESHOLD) {
      // Small file - store as BLOB
      storageType = 'blob';
      if (!fileContent) {
        fileContent = fs.readFileSync(metadata.sourcePath!);
      }
      checksum = calculateChecksum(fileContent);
    } else {
      // Large file - store externally
      storageType = 'external';
      const targetDir = getSharedDirectory(metadata.type);
      const uniqueFileName = generateUniqueFileName(metadata.name, fileId);
      externalPath = path.join(targetDir, uniqueFileName);

      // Copy file to shared directory
      if (metadata.sourcePath) {
        fs.copyFileSync(metadata.sourcePath, externalPath);
        checksum = calculateFileChecksum(externalPath);
      } else if (metadata.content) {
        fs.writeFileSync(externalPath, metadata.content);
        checksum = calculateChecksum(metadata.content);
      }

      dbLog.info(`[FileService] Stored large file externally: ${externalPath}`);
    }

    // Insert record
    const record: Partial<FileRecord> = {
      id: fileId,
      name: metadata.name,
      type: metadata.type,
      mime_type: metadata.mimeType || null,
      size: fileSize,
      storage_type: storageType,
      content: fileContent,
      external_path: externalPath,
      checksum,
      description: metadata.description || null,
      tags: metadata.tags ? JSON.stringify(metadata.tags) : null,
      created_by: createdBy,
      version: 1,
    };

    await this.save(record as FileRecord);
    dbLog.info(`[FileService] Registered file ${fileId} (${storageType} storage, ${fileSize} bytes)`);

    return fileId;
  }

  /**
   * Get file content or path
   */
  async resolveFile(fileId: string): Promise<{ type: 'buffer' | 'path'; data: Buffer | string }> {
    const record = await this.get(fileId);
    if (!record) {
      throw new Error(`File ${fileId} not found`);
    }

    if (record.storage_type === 'blob') {
      if (!record.content) {
        throw new Error(`File ${fileId} has no content in database`);
      }
      return { type: 'buffer', data: record.content };
    } else {
      if (!record.external_path) {
        throw new Error(`File ${fileId} has no external path`);
      }
      if (!fs.existsSync(record.external_path)) {
        throw new Error(`External file not found: ${record.external_path}`);
      }
      return { type: 'path', data: record.external_path };
    }
  }

  /**
   * Find files by criteria
   */
  async findFiles(query: FileQuery): Promise<FileRecord[]> {
    const filters: Record<string, any> = {};

    if (query.type) {
      filters.type = query.type;
    }
    if (query.created_by) {
      filters.created_by = query.created_by;
    }

    let results = await this.find(filters);

    // Post-filter for tags and name pattern (SQLite JSON support is limited)
    if (query.tags && query.tags.length > 0) {
      results = results.filter(file => {
        if (!file.tags) return false;
        const fileTags = JSON.parse(file.tags) as string[];
        return query.tags!.some(tag => fileTags.includes(tag));
      });
    }

    if (query.name_pattern) {
      const pattern = query.name_pattern.toLowerCase();
      results = results.filter(file => file.name.toLowerCase().includes(pattern));
    }

    return results;
  }

  /**
   * Remove file and optionally delete physical file
   */
  async removeFile(fileId: string, deletePhysicalFile = true): Promise<void> {
    const record = await this.get(fileId);
    if (!record) {
      throw new Error(`File ${fileId} not found`);
    }

    // Delete physical file if external storage
    if (deletePhysicalFile && record.storage_type === 'external' && record.external_path) {
      if (fs.existsSync(record.external_path)) {
        fs.unlinkSync(record.external_path);
        dbLog.info(`[FileService] Deleted external file: ${record.external_path}`);
      }
    }

    // Delete database record
    await this.delete(fileId);
    dbLog.info(`[FileService] Removed file record ${fileId}`);
  }

  /**
   * Cleanup orphaned external files
   * Removes files in shared directory that have no DB record
   */
  async cleanupOrphanedFiles(): Promise<number> {
    const types = ['strategy', 'data', 'report', 'config', 'cache'];
    let cleanedCount = 0;

    for (const type of types) {
      const typeDir = getSharedDirectory(type);
      if (!fs.existsSync(typeDir)) continue;

      const files = fs.readdirSync(typeDir);
      for (const file of files) {
        const fullPath = path.join(typeDir, file);
        
        // Check if this path exists in DB
        const stmt = this.db.prepare(
          'SELECT COUNT(*) as count FROM hub_files WHERE external_path = ?'
        );
        const result = stmt.get(fullPath) as { count: number };
        
        if (result.count === 0) {
          // Orphaned file - delete it
          fs.unlinkSync(fullPath);
          cleanedCount++;
          dbLog.info(`[FileService] Cleaned up orphaned file: ${fullPath}`);
        }
      }
    }

    return cleanedCount;
  }
}
