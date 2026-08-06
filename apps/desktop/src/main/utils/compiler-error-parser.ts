/**
 * Compiler Error Parser
 *
 * TICKET_711: Transforms raw g++/clang compiler output into structured,
 * user-friendly error messages. Strips absolute paths, filters template
 * backtraces, and generates concise summaries.
 */

import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from '../services/locale-service';
import type { ParsedCompilerError } from '../../shared/types/compiler';
export type { CompilerErrorEntry, ParsedCompilerError } from '../../shared/types/compiler';

/**
 * Regex matching g++/clang diagnostic format:
 *   /some/path/to/file.cpp:42:10: error: undeclared identifier 'foo'
 */
const DIAGNOSTIC_RE = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.+)$/;

/**
 * Lines to filter out entirely -- these add noise for non-C++ users.
 */
const NOISE_PATTERNS = [
  /^In file included from /,
  /^\s+from /,
  /required from here/,
  /required from '/,
  /in instantiation of /,
  /recursively required from /,
  /^\s*\^~*\s*$/,
  /^\s*\|\s*$/,
  /^\s+\d+ \|/,
];

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Strip absolute path prefixes, keeping only the filename.
 * e.g., /home/user/.config/StratCraft/cpp_cache/42_abc123.cpp -> strategy.cpp
 */
function stripPath(filePath: string): string {
  const filename = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  // Normalize cache filenames (e.g., "42_abc123.cpp") to "strategy.cpp"
  if (/^\d+.*\.cpp$/.test(filename)) {
    return 'strategy.cpp';
  }
  return filename;
}

export function parseCompilerOutput(raw: string): ParsedCompilerError {
  const result: ParsedCompilerError = {
    summary: '',
    errors: [],
    errorCount: 0,
    warningCount: 0,
    rawOutput: raw,
  };

  if (!raw?.trim()) {
    result.summary = 'No compiler output';
    return result;
  }

  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    if (isNoiseLine(line)) {
      continue;
    }

    const match = DIAGNOSTIC_RE.exec(line);
    if (!match) {
      continue;
    }

    const [, filePath, lineNum, colNum, severity, message] = match;

    // Filter out note-level diagnostics (expansion context, candidate lists)
    if (severity === 'note') {
      continue;
    }

    const sev = severity as 'error' | 'warning';

    result.errors.push({
      line: parseInt(lineNum, 10),
      column: parseInt(colNum, 10),
      severity: sev,
      message: `${stripPath(filePath)}:${lineNum}:${colNum}: ${message}`,
    });

    if (sev === 'error') {
      result.errorCount += 1;
    } else {
      result.warningCount += 1;
    }
  }

  // Generate summary
  const parts: string[] = [];
  if (result.errorCount > 0) {
    parts.push(`${result.errorCount} error${result.errorCount > 1 ? 's' : ''}`);
  }
  if (result.warningCount > 0) {
    parts.push(`${result.warningCount} warning${result.warningCount > 1 ? 's' : ''}`);
  }

  if (parts.length > 0) {
    result.summary = parts.join(', ');
  } else {
    // No parseable diagnostics -- fallback to first non-empty line
    const firstLine = lines.find((l) => l.trim().length > 0);
    result.summary = firstLine?.trim().slice(0, 120) || mainT(getCurrentMainLocale(), 'errors', 'main.compilerParser.compilationFailed');
  }

  return result;
}
