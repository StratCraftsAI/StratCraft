/**
 * AlgorithmCompilationService
 *
 * NONABT_TICKET_011: post-save C++ strategy compilation lifecycle.
 */

import { execFile } from 'child_process';
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { getDatabaseManager } from '../database/db-manager';
import type { ParentKind } from '../database/services/parent-kind';
import { getCompilerResolver } from './compiler-resolver';
import { createLogger } from '../utils/logger';
import { parseCompilerOutput } from '../utils/compiler-error-parser';
import { sendToRenderer } from '../window';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
// TICKET_661_1 AC-10: exactly one `extractCppClassName()` implementation exists
// in the repository, and it is this comment-aware, inheritance-aware one
// (carrying the TICKET_1226 fix). It now lives in the Electron-free shared
// owner so Main, the Service API, and MCP consume the same code.
import {
  extractCppClassName,
  extractDeclaredCppClassNames,
} from '@StratCraft/types';

const log = createLogger('AlgorithmCompilation');
const ABI_VERSION = 2;

export type CompilationStatus = 'pending' | 'success' | 'error';

/**
 * TICKET_762 R4: every compile call must declare which parent table owns the
 * id so writeStatus and loadAlgorithm dispatch the SQL to the correct table.
 * The schema columns are identical between `nona_algorithms` and `nona_signal`
 * (TICKET_762 Schema section), so only the table name in the SQL string
 * changes.
 */
export interface CompileAlgorithmRequest {
  algorithmId: number | string;
  parentKind: ParentKind;
  sourceCode?: string;
  strategyName?: string;
}

function tableForParentKind(parentKind: ParentKind): 'nona_algorithms' | 'nona_signal' {
  return parentKind === 'signal' ? 'nona_signal' : 'nona_algorithms';
}

export interface CompileAlgorithmResult {
  success: boolean;
  algorithmId: string;
  status: CompilationStatus;
  artifactPath?: string;
  sourceHash?: string;
  error?: string;
}

interface AlgorithmRow {
  id: number;
  code: string | null;
  strategy_name: string | null;
}

export function getCppArtifactCacheDir(): string {
  const cacheDir = join(app.getPath('userData'), 'cpp_cache');
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

export function hashCppStrategySource(source: string, includePaths: string[] = [], pchPath = ''): string {
  const input = [
    source,
    ...includePaths.filter(Boolean).sort(),
    pchPath,
    `abi:${ABI_VERSION}`,
  ].join('\n');

  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function getCppArtifactPath(algorithmId: number | string, sourceHash: string): string {
  const safeId = String(algorithmId).replace(/[^A-Za-z0-9_-]/g, '_');
  const extension = process.platform === 'win32'
    ? '.dll'
    : process.platform === 'darwin'
      ? '.dylib'
      : '.so';
  return join(getCppArtifactCacheDir(), `${safeId}_${sourceHash}${extension}`);
}

/**
 * Separate #include and #pragma once directives from LLM-generated strategy code.
 *
 * TICKET_660_1: LLM code often contains #include directives and #pragma once.
 * When embedded into main.cpp.template (inside an anonymous namespace), these
 * cause namespace nesting issues: headers define types inside (anonymous)::nonabt
 * instead of ::nonabt, leading to compilation failures.
 *
 * This function extracts includes so they can be hoisted to file scope, and strips
 * #pragma once (meaningless in a .cpp translation unit).
 */
export function separateCppIncludes(code: string): { includes: string[]; body: string } {
  const includePattern = /^\s*#include\s*[<"][^>"]+[>"]\s*$/;
  const pragmaOncePattern = /^\s*#pragma\s+once\s*$/;

  const lines = code.split('\n');
  const includes: string[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (pragmaOncePattern.test(line)) {
      continue;
    }
    if (includePattern.test(line)) {
      includes.push(line.trim());
      continue;
    }
    bodyLines.push(line);
  }

  return { includes, body: bodyLines.join('\n') };
}

export function buildCompilableCppSource(sourceCode: string, strategyName = 'Strategy'): string {
  if (sourceCode.includes('QNX_STRATEGY_FACTORY_EXPORT')) {
    return normalizeFactoryExport(sourceCode);
  }

  const className = extractCppClassName(sourceCode);
  if (!className) {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.algorithmCompilation.cannotExtractClassName'));
  }

  // TICKET_660_1: Hoist #include directives from LLM code to file scope.
  // The template embeds {{STRATEGY_CODE}} inside an anonymous namespace.
  // Any #include inside that namespace creates (anonymous)::nonabt types
  // that conflict with ::nonabt types used in the template boilerplate.
  const { includes: strategyIncludes, body: strategyBody } = separateCppIncludes(sourceCode);

  const frameworkPath = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), '..', '..', 'packages', 'builder-templates');
  const templatePath = join(frameworkPath, 'templates', 'main.cpp.template');
  const template = readFileSync(templatePath, 'utf-8');

  // Collect includes already present in the template to avoid duplicates
  const templateIncludes = new Set<string>();
  for (const match of template.matchAll(/^\s*#include\s*([<"][^>"]+[>"])\s*$/gm)) {
    templateIncludes.add(match[1]);
  }

  // Filter strategy includes to only those not already in the template
  const newIncludes = strategyIncludes.filter((inc) => {
    const headerMatch = inc.match(/#include\s*([<"][^>"]+[>"])/);
    return headerMatch ? !templateIncludes.has(headerMatch[1]) : false;
  });

  let result = template
    .replace(/\{\{STRATEGY_NAME\}\}/g, strategyName)
    .replace(/\{\{STRATEGY_CLASS\}\}/g, className)
    .replace(/\{\{STRATEGY_CODE\}\}/g, strategyBody)
    .replace(/\{\{GENERATED_TIME\}\}/g, new Date().toISOString());

  // Insert hoisted includes after the last #include block in the template
  if (newIncludes.length > 0) {
    const lastIncludeIdx = result.lastIndexOf('#include');
    if (lastIncludeIdx >= 0) {
      const lineEnd = result.indexOf('\n', lastIncludeIdx);
      const insertionPoint = lineEnd >= 0 ? lineEnd + 1 : result.length;
      result = result.slice(0, insertionPoint)
        + newIncludes.join('\n') + '\n'
        + result.slice(insertionPoint);
    }
  }

  return result;
}

const FACTORY_EXPORT_PATTERN = /(QNX_STRATEGY_FACTORY_EXPORT\s*\(\s*)([A-Za-z_]\w*)(\s*\))/g;

/**
 * TICKET_1226: the ABI v2 factory export macro argument MUST be a class
 * declared in the source. The live incident shipped
 * `QNX_STRATEGY_FACTORY_EXPORT(headers)` -- produced by this service's own
 * template path when the pre-fix comment-blind extractor matched a comment.
 * Rewrite undeclared arguments to the declared strategy class; throw when the
 * source declares no class at all.
 */
export function normalizeFactoryExport(sourceCode: string): string {
  const declared = new Set(extractDeclaredCppClassNames(sourceCode));
  return sourceCode.replace(FACTORY_EXPORT_PATTERN, (full, prefix: string, arg: string, suffix: string) => {
    if (declared.has(arg)) {
      return full;
    }
    const strategyClass = extractCppClassName(sourceCode);
    if (!strategyClass) {
      throw new Error(
        `QNX_STRATEGY_FACTORY_EXPORT references undeclared class '${arg}' and the source declares no class`,
      );
    }
    log.warn(
      `[TICKET_1226] Factory export references undeclared class '${arg}'; corrected to declared strategy class '${strategyClass}'`,
    );
    return `${prefix}${strategyClass}${suffix}`;
  });
}

function writeStatus(
  algorithmId: number | string,
  parentKind: ParentKind,
  status: CompilationStatus,
  fields: { error?: string | null; hash?: string | null; artifactPath?: string | null } = {},
): void {
  const db = getDatabaseManager();
  const table = tableForParentKind(parentKind);
  db.prepare(`
    UPDATE ${table}
    SET compile_status = ?,
        compile_error = ?,
        compile_hash = ?,
        compile_artifact_path = ?,
        compiled_at = ?
    WHERE id = ?
  `).run(
    status,
    fields.error ?? null,
    fields.hash ?? null,
    fields.artifactPath ?? null,
    status === 'pending' ? null : Math.floor(Date.now() / 1000),
    algorithmId,
  );
}

function emitStatus(algorithmId: number | string, status: Exclude<CompilationStatus, 'pending'> | 'compiling', error?: string): void {
  const parsedErrors = (status === 'error' && error) ? parseCompilerOutput(error) : undefined;
  sendToRenderer('v3:algorithm:compilation-status', {
    algorithmId: String(algorithmId),
    status,
    error: parsedErrors?.summary || error,
    parsedErrors,
  });
}

export class AlgorithmCompilationService {
  // Dedup map: coalesce concurrent compileAlgorithm calls for the same algorithm
  private inFlight = new Map<string, Promise<CompileAlgorithmResult>>();

  async compileAlgorithm(request: CompileAlgorithmRequest): Promise<CompileAlgorithmResult> {
    const algorithmId = request.algorithmId;
    const key = String(algorithmId);

    // If a compilation for this algorithm is already in flight, return the same promise
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.doCompile(request);
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
    return promise;
  }

  private async doCompile(request: CompileAlgorithmRequest): Promise<CompileAlgorithmResult> {
    const algorithmId = request.algorithmId;
    const parentKind = request.parentKind;
    const row = this.loadAlgorithm(algorithmId, parentKind);
    const sourceCode = request.sourceCode ?? row?.code;
    const strategyName = request.strategyName ?? row?.strategy_name ?? `Algorithm ${algorithmId}`;

    if (!sourceCode?.trim()) {
      const error = `Algorithm ${algorithmId} has no C++ source code`;
      writeStatus(algorithmId, parentKind, 'error', { error });
      emitStatus(algorithmId, 'error', error);
      return { success: false, algorithmId: String(algorithmId), status: 'error', error };
    }

    writeStatus(algorithmId, parentKind, 'pending');
    emitStatus(algorithmId, 'compiling');

    try {
      const resolver = getCompilerResolver();
      const toolchain = resolver.resolve();
      if (!toolchain.available || !toolchain.info) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.algorithmCompilation.toolchainNotAvailable', { error: toolchain.error || 'unknown' }));
      }

      const compiledSource = buildCompilableCppSource(sourceCode, strategyName);
      const sourceHash = hashCppStrategySource(compiledSource, toolchain.info.includes);
      const artifactPath = getCppArtifactPath(algorithmId, sourceHash);
      const sourcePath = join(getCppArtifactCacheDir(), `${String(algorithmId).replace(/[^A-Za-z0-9_-]/g, '_')}_${sourceHash}.cpp`);

      writeFileSync(sourcePath, compiledSource, 'utf-8');

      if (!existsSync(artifactPath)) {
        await this.compileSource(toolchain.info.compiler, sourcePath, artifactPath, toolchain.info.includes);
      }

      const metaPath = `${artifactPath}.meta`;
      writeFileSync(metaPath, JSON.stringify({
        compiled_at: Math.floor(Date.now() / 1000),
        compiler_version: toolchain.info.version,
        abi_version: ABI_VERSION,
        platform: process.platform,
        source_hash: sourceHash,
        source_file: basename(sourcePath),
      }, null, 2), 'utf-8');

      writeStatus(algorithmId, parentKind, 'success', {
        hash: sourceHash,
        artifactPath,
      });
      emitStatus(algorithmId, 'success');

      return {
        success: true,
        algorithmId: String(algorithmId),
        status: 'success',
        artifactPath,
        sourceHash,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Compilation failed for algorithm ${algorithmId}: ${message}`);
      writeStatus(algorithmId, parentKind, 'error', { error: message });
      emitStatus(algorithmId, 'error', message);
      return {
        success: false,
        algorithmId: String(algorithmId),
        status: 'error',
        error: message,
      };
    }
  }

  private loadAlgorithm(algorithmId: number | string, parentKind: ParentKind): AlgorithmRow | undefined {
    const db = getDatabaseManager();
    const table = tableForParentKind(parentKind);
    return db.prepare(
      `SELECT id, code, strategy_name FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
    ).get(algorithmId) as AlgorithmRow | undefined;
  }

  private compileSource(
    compilerPath: string,
    sourcePath: string,
    artifactPath: string,
    includePaths: string[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-std=c++23',
        '-shared',
        ...(process.platform === 'win32' ? [] : ['-fPIC']),
        ...includePaths.flatMap((includePath) => ['-I', includePath]),
        sourcePath,
        '-o',
        artifactPath,
      ];

      execFile(compilerPath, args, { maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error([stderr, stdout, error.message].filter(Boolean).join('\n')));
          return;
        }
        resolve();
      });
    });
  }
}

let instance: AlgorithmCompilationService | null = null;

export function getAlgorithmCompilationService(): AlgorithmCompilationService {
  if (!instance) {
    instance = new AlgorithmCompilationService();
  }
  return instance;
}
