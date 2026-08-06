import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsoncConfigFile, updateJsoncConfigValue } from './jsonc-config-file';

const temporaryDirectories: string[] = [];

function temporaryFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qnx-jsonc-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'config.jsonc');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('JSONC config file access', () => {
  it('reads missing files as empty documents', () => {
    expect(readJsoncConfigFile(temporaryFile())).toEqual({});
  });

  it('preserves comments and atomically edits a nested value', async () => {
    const filePath = temporaryFile();
    fs.writeFileSync(filePath, '{\n  // retained\n  "performance": { "maxBacktestTasks": 3 }\n}\n');
    const result = await updateJsoncConfigValue(filePath, 'performance.maxBacktestTasks', 4);
    expect(result).toEqual({ performance: { maxBacktestTasks: 4 } });
    expect(fs.readFileSync(filePath, 'utf8')).toContain('// retained');
    expect(fs.existsSync(`${filePath}.lock`)).toBe(false);
  });

  it('adds missing nested objects and refuses malformed JSONC', async () => {
    const filePath = temporaryFile();
    await updateJsoncConfigValue(filePath, 'resource.enabled', true);
    expect(readJsoncConfigFile(filePath)).toEqual({ resource: { enabled: true } });
    fs.writeFileSync(filePath, '{ invalid');
    await expect(updateJsoncConfigValue(filePath, 'resource.enabled', false)).rejects.toThrow(
      'Invalid JSONC configuration',
    );
  });

  it('rejects non-object roots', () => {
    const filePath = temporaryFile();
    fs.writeFileSync(filePath, '[]');
    expect(() => readJsoncConfigFile(filePath)).toThrow('root must be an object');
  });
});
