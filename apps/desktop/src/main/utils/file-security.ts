/**
 * File Security Utilities
 * 
 * Provides validation and security checks for file operations in the Hub.
 * 
 * Related: TICKET_117_2 - File Sharing Hub
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

// File size limits
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const BLOB_STORAGE_THRESHOLD = 1 * 1024 * 1024; // 1MB

/**
 * Validate that a path is within allowed directories
 * Prevents path traversal attacks
 */
export function validatePath(filePath: string, allowedBase?: string): boolean {
  const normalized = path.normalize(filePath);
  
  // Check for path traversal attempts
  if (normalized.includes('..')) {
    return false;
  }

  // If allowedBase is provided, ensure path is within it
  if (allowedBase) {
    const resolvedPath = path.resolve(normalized);
    const resolvedBase = path.resolve(allowedBase);
    return resolvedPath.startsWith(resolvedBase);
  }

  return true;
}

/**
 * Calculate SHA256 checksum for a buffer
 */
export function calculateChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculate SHA256 checksum for a file
 */
export function calculateFileChecksum(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return calculateChecksum(buffer);
}

/**
 * Validate MIME type matches file extension
 * Basic validation - can be extended with magic number checking
 */
export function validateMimeType(mimeType: string, fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  
  const mimeMap: Record<string, string[]> = {
    'text/plain': ['.txt', '.log', '.md'],
    'text/csv': ['.csv'],
    'application/json': ['.json'],
    'application/yaml': ['.yaml', '.yml'],
    'text/x-python': ['.py'],
    'application/javascript': ['.js'],
    'text/html': ['.html', '.htm'],
    'application/pdf': ['.pdf'],
    'application/octet-stream': ['.parquet', '.bin', '.dat'],
  };

  const expectedExtensions = mimeMap[mimeType];
  if (!expectedExtensions) {
    // Unknown MIME type - allow it but log warning
    return true;
  }

  return expectedExtensions.includes(ext);
}

/**
 * Get the shared directory path for a file type
 */
export function getSharedDirectory(fileType: string): string {
  const userData = app.getPath('userData');
  const sharedBase = path.join(userData, 'shared');
  
  const typeDir = path.join(sharedBase, fileType);
  
  // Ensure directory exists
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true });
  }
  
  return typeDir;
}

/**
 * Generate a unique filename to avoid conflicts
 */
export function generateUniqueFileName(originalName: string, fileId: string): string {
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  
  // Use first 8 chars of file ID as prefix
  return `${fileId.substring(0, 8)}_${baseName}${ext}`;
}

/**
 * Initialize shared directory structure
 */
export function initializeSharedDirectories(): void {
  const types = ['strategy', 'data', 'report', 'config', 'cache'];
  
  for (const type of types) {
    getSharedDirectory(type);
  }
}
