/**
 * Cross-process-safe, comment-preserving JSONC access for system config.
 */

import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse, type ParseError, printParseErrorCode } from 'jsonc-parser';
import { withConfigFileLock, writeConfigFileAtomically } from './json-config-file';

export function readJsoncConfigFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const errors: ParseError[] = [];
  const value = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new Error(
      `Invalid JSONC configuration: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}`,
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('System configuration root must be an object');
  }
  return value as Record<string, unknown>;
}

export async function updateJsoncConfigValue(
  filePath: string,
  dottedPath: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  return withConfigFileLock(filePath, async () => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const original = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : '{}\n';
    // Parse first so a malformed file is never overwritten with a partial edit.
    readJsoncConfigFile(filePath);
    const edits = modify(original, dottedPath.split('.'), value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    });
    const updated = applyEdits(original, edits);
    writeConfigFileAtomically(filePath, updated);
    return readJsoncConfigFile(filePath);
  });
}
