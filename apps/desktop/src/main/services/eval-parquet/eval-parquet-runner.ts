import { spawn } from 'node:child_process';

import { getCompilerResolver } from '../compiler-resolver';

export const EVAL_PARQUET_CONTRACT_VERSION = 'qnx.eval-parquet/1.0.0' as const;
export const EVAL_PARQUET_ARG_PREFIX = '--eval-parquet=' as const;

type EvalParquetTestInvoker = (
  requestPath: string,
) => Promise<Record<string, unknown>>;

let testInvoker: EvalParquetTestInvoker | null = null;

export function __setEvalParquetInvokerForTesting(
  invoker: EvalParquetTestInvoker | null,
): void {
  testInvoker = invoker;
}

export async function invokeEvalParquetOwner(
  requestPath: string,
): Promise<Record<string, unknown>> {
  if (testInvoker !== null) return testInvoker(requestPath);
  const executor = getCompilerResolver().resolvePluginExecutor();
  if (!executor) {
    throw new Error(
      'StratCraft-executor not resolved; rebuild through start.sh executor ' +
      'or set STRATCRAFT_EXECUTOR',
    );
  }
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(
      executor.path,
      [`${EVAL_PARQUET_ARG_PREFIX}${requestPath}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(
          `StratCraft-executor --eval-parquet exited ${code}: ` +
          `${stderr.trim() || stdout.trim() || '(empty output)'}`,
        ));
        return;
      }
      try {
        const line = stdout.trim().split(/\r?\n/).at(-1) ?? '';
        const result = JSON.parse(line) as Record<string, unknown>;
        if (
          result.status !== 'ok' ||
          result.version !== EVAL_PARQUET_CONTRACT_VERSION
        ) {
          throw new Error(`unexpected C++ response: ${line.slice(0, 500)}`);
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
