import { resolve } from 'node:path';
import {
  createBaseEvidence,
  finishEvidence,
  sha256File,
  type BaseWorkflowEvidence,
  type EvidenceState,
} from './public-tree-evidence';

export interface P8WorkflowEvidence extends BaseWorkflowEvidence {
  criterion: 'AC-6' | 'AC-7';
  data?: Record<string, unknown>;
  artifacts?: Array<{ path: string; sha256?: string; role: string }>;
  result?: Record<string, unknown>;
}

export { sha256File };

export function createP8Evidence(
  criterion: P8WorkflowEvidence['criterion'],
): EvidenceState<P8WorkflowEvidence> {
  return createBaseEvidence<P8WorkflowEvidence>(
    criterion,
    [
      process.env.STRATCRAFT_P8_BUILD_COMMAND || 'bash start.sh build',
      process.env.STRATCRAFT_P8_TEST_COMMAND
        || `pnpm --filter @StratCraft/desktop test:e2e -- ${criterion.toLowerCase()}.p8.test.ts`,
    ],
    {},
  );
}

export function finishP8Evidence(
  state: EvidenceState<P8WorkflowEvidence>,
  outputPath?: string,
): string {
  return finishEvidence(
    state,
    resolve(
      __dirname,
      '../test-results/p8',
      `${state.evidence.criterion.toLowerCase()}-${process.platform}-${process.arch}.json`,
    ),
    outputPath,
  );
}
