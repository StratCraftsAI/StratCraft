/**
 * Centralised data-root resolver.
 *
 * When STRATCRAFT_DATA_ROOT is set, all heavy I/O (parquet, algorithms,
 * research DBs, pooled caches) writes to that directory instead of
 * Electron's userData (~/.config/Electron).  This lets operators move
 * the ~1 TB sweep output to a larger volume without touching app code.
 *
 * Lightweight Electron state (config, plugins, logs, browser caches)
 * stays in userData.
 *
 * TICKET_1243: `getArtifactsRoot()` adds a dedicated resolver for
 * sweep artifact directories (`algorithms/<id>/artifact/`). Priority:
 *   1. User-configured path (Settings UI, persisted in electron-store)
 *   2. STRATCRAFT_DATA_ROOT env var (backwards-compatible)
 *   3. app.getPath('userData') (default)
 */

import { app } from 'electron';
import path from 'node:path';
import Store from 'electron-store';

// =============================================================================
// Data Root
// =============================================================================

let cachedRoot: string | null = null;

export function getDataRoot(): string {
  if (cachedRoot !== null) return cachedRoot;
  const envRoot = process.env.STRATCRAFT_DATA_ROOT;
  cachedRoot = envRoot && envRoot.length > 0 ? envRoot : app.getPath('userData');
  return cachedRoot;
}

export function resetDataRootCache(): void {
  cachedRoot = null;
}

// =============================================================================
// TICKET_1243: Artifacts Root
// =============================================================================

interface ArtifactStoreSchema {
  artifactsPath: string;
}

const artifactStore = new Store<ArtifactStoreSchema>({
  name: 'artifact-storage',
  schema: {
    artifactsPath: {
      type: 'string',
      default: '',
    },
  },
});

let cachedArtifactsRoot: string | null = null;

export function getArtifactsRoot(): string {
  if (cachedArtifactsRoot !== null) return cachedArtifactsRoot;

  const configured = artifactStore.get('artifactsPath', '');
  if (configured.length > 0) {
    cachedArtifactsRoot = path.join(configured, 'algorithms');
    return cachedArtifactsRoot;
  }

  cachedArtifactsRoot = path.join(getDataRoot(), 'algorithms');
  return cachedArtifactsRoot;
}

export function setArtifactsPath(newPath: string): void {
  artifactStore.set('artifactsPath', newPath);
  cachedArtifactsRoot = null;
}

export function getConfiguredArtifactsPath(): string {
  return artifactStore.get('artifactsPath', '');
}

export function resetArtifactsRootCache(): void {
  cachedArtifactsRoot = null;
}

/**
 * TICKET_1243 D0: Resolve a possibly-relative artifact_path to an absolute
 * filesystem path. Relative paths are resolved against getArtifactsRoot().
 * Absolute paths (legacy rows written before D0 migration) pass through
 * unchanged so pre-migration data keeps working.
 */
export function resolveArtifactPath(relOrAbsPath: string): string {
  if (path.isAbsolute(relOrAbsPath)) return relOrAbsPath;
  return path.resolve(getArtifactsRoot(), relOrAbsPath);
}

/**
 * TICKET_1243 D0: Convert an absolute artifact path to relative form
 * (relative to getArtifactsRoot()). Used by writers when persisting
 * artifact_path to nona_signal / signal_run.
 */
export function toRelativeArtifactPath(absolutePath: string): string {
  return path.relative(getArtifactsRoot(), absolutePath);
}
