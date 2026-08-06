import { resolve } from 'node:path';
import {
  createBaseEvidence,
  finishEvidence,
  sha256File,
  type BaseWorkflowEvidence,
  type EvidenceState,
} from './public-tree-evidence';

export interface P9LifecycleStep {
  action: 'install' | 'upgrade' | 'uninstall' | 'discover' | 'execute'
    | 'cancel' | 'post-uninstall-discover' | 'post-uninstall-open-workflow';
  success: boolean;
  detail: Record<string, unknown>;
}

export interface P9WorkflowEvidence extends BaseWorkflowEvidence {
  criterion: 'AC-8';
  lifecycleSteps: P9LifecycleStep[];
  artifacts?: Array<{ path: string; sha256?: string; role: string }>;
}

export { sha256File };

export function createP9Evidence(): EvidenceState<P9WorkflowEvidence> {
  return createBaseEvidence<P9WorkflowEvidence>(
    'AC-8',
    [
      process.env.STRATCRAFT_P9_BUILD_COMMAND || 'bash start.sh build',
      process.env.STRATCRAFT_P9_TEST_COMMAND
        || 'pnpm --filter @StratCraft/desktop test:e2e -- ac-8.p9.test.ts',
    ],
    { lifecycleSteps: [] },
  );
}

export function finishP9Evidence(
  state: EvidenceState<P9WorkflowEvidence>,
  outputPath?: string,
): string {
  return finishEvidence(
    state,
    resolve(
      __dirname,
      '../test-results/p9',
      `ac-8-${process.platform}-${process.arch}.json`,
    ),
    outputPath,
  );
}
