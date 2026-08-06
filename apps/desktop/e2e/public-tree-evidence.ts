import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface DependencyClosureEvidence {
  status: 'passed';
  checkedEntries: number;
}

export interface PublicTreeIdentity {
  schemaVersion: 1;
  sourceRevision: string;
  publicManifest: { path: string; sha256: string };
  publicReleaseEvidence: { path: string; status: 'passed' };
  dependencyClosureEvidence: DependencyClosureEvidence;
}

export interface BaseWorkflowEvidence {
  criterion: 'AC-6' | 'AC-7' | 'AC-8';
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  revision: string;
  publicManifest: PublicTreeIdentity['publicManifest'];
  publicReleaseEvidence: PublicTreeIdentity['publicReleaseEvidence'];
  platform: { platform: NodeJS.Platform; arch: string; node: string };
  environment: {
    cpuCount?: string;
    memoryLimit?: string;
    cpuLimit?: string;
  };
  commands: string[];
  processTree: string;
  dependencyClosureEvidence: DependencyClosureEvidence;
  errors: Array<{ stage: string; message: string }>;
  resources?: {
    wallTimeMs: number;
    userCpuMicros: number;
    systemCpuMicros: number;
    maxRssKb: number;
  };
}

export interface EvidenceState<T extends BaseWorkflowEvidence> {
  evidence: T;
  startedAtMs: number;
  usage: NodeJS.ResourceUsage;
}

type Environment = NodeJS.ProcessEnv;
type AcceptanceValidator = (args: string[]) => string;

const ACCEPTANCE_ENVIRONMENT_KEYS = [
  'STRATCRAFT_PUBLIC_MANIFEST_PATH',
  'STRATCRAFT_PUBLIC_RELEASE_EVIDENCE_PATH',
  'STRATCRAFT_PUBLIC_MANIFEST_SHA256',
  'STRATCRAFT_SOURCE_REVISION',
] as const;

function requiredEnvironment(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for generated-public acceptance evidence`);
  return value;
}

export function validationFailureDetail(
  error: unknown,
): string {
  const failure = error as { stderr?: string | Buffer; message?: string };
  return failure.stderr?.toString().trim() || failure.message || String(error);
}

function defaultAcceptanceValidator(args: string[]): string {
  const scriptPath = resolve(__dirname, '../scripts/generated-public-evidence.mjs');
  try {
    return execFileSync(process.execPath, [scriptPath, 'acceptance', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(`Generated-public evidence validation failed: ${validationFailureDetail(error)}`);
  }
}

function parseValidatedIdentity(output: string): PublicTreeIdentity {
  let identity: unknown;
  try {
    identity = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Generated-public evidence validator returned invalid JSON: ${String(error)}`,
    );
  }
  const candidate = identity as Partial<PublicTreeIdentity>;
  const checkedEntries = candidate.dependencyClosureEvidence?.checkedEntries;
  if (
    candidate.schemaVersion !== 1
    || candidate.publicReleaseEvidence?.status !== 'passed'
    || candidate.dependencyClosureEvidence?.status !== 'passed'
    || !Number.isSafeInteger(checkedEntries)
    || (checkedEntries as number) < 0
    || typeof candidate.publicManifest?.path !== 'string'
    || typeof candidate.publicManifest?.sha256 !== 'string'
    || typeof candidate.publicReleaseEvidence.path !== 'string'
    || typeof candidate.sourceRevision !== 'string'
  ) {
    throw new Error('Generated-public evidence validator returned a malformed identity');
  }
  return candidate as PublicTreeIdentity;
}

export function loadPublicTreeIdentity(
  environment: Environment = process.env,
  validator: AcceptanceValidator = defaultAcceptanceValidator,
): PublicTreeIdentity {
  const values = Object.fromEntries(
    ACCEPTANCE_ENVIRONMENT_KEYS.map((key) => [key, requiredEnvironment(environment, key)]),
  );
  const output = validator([
    values.STRATCRAFT_PUBLIC_MANIFEST_PATH,
    values.STRATCRAFT_PUBLIC_RELEASE_EVIDENCE_PATH,
    values.STRATCRAFT_PUBLIC_MANIFEST_SHA256,
    values.STRATCRAFT_SOURCE_REVISION,
  ]);
  const identity = parseValidatedIdentity(output);
  if (identity.publicManifest.sha256 !== values.STRATCRAFT_PUBLIC_MANIFEST_SHA256) {
    throw new Error('Validated public manifest digest does not match the requested digest');
  }
  if (identity.sourceRevision !== values.STRATCRAFT_SOURCE_REVISION) {
    throw new Error('Validated source revision does not match the requested revision');
  }
  return identity;
}

export function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
}

export function commandOutput(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return [
      `diagnostic command failed with exit ${failure.status ?? 'unknown'}`,
      failure.stdout?.toString().trim(),
      failure.stderr?.toString().trim(),
      failure.message,
    ].filter(Boolean).join('\n');
  }
}

export function processTreeForPlatform(
  platform: NodeJS.Platform,
  runner: typeof commandOutput = commandOutput,
): string {
  return platform === 'win32'
    ? runner('wmic', ['process', 'get', 'ProcessId,ParentProcessId,Name'])
    : runner('ps', ['-eo', 'pid,ppid,comm,args']);
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function createBaseEvidence<T extends BaseWorkflowEvidence>(
  criterion: T['criterion'],
  commands: string[],
  additionalFields: Omit<
    T,
    keyof BaseWorkflowEvidence
  >,
): EvidenceState<T> {
  const identity = loadPublicTreeIdentity();
  const processTree = processTreeForPlatform(process.platform);
  const evidence = {
    criterion,
    status: 'running',
    startedAt: new Date().toISOString(),
    revision: identity.sourceRevision,
    publicManifest: identity.publicManifest,
    publicReleaseEvidence: identity.publicReleaseEvidence,
    platform: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    environment: {
      cpuCount: readOptional('/sys/fs/cgroup/cpu.max'),
      memoryLimit: readOptional('/sys/fs/cgroup/memory.max'),
      cpuLimit: readOptional('/sys/fs/cgroup/cpuset.cpus.effective'),
    },
    commands,
    processTree,
    dependencyClosureEvidence: identity.dependencyClosureEvidence,
    errors: [],
    ...additionalFields,
  } as unknown as T;
  return {
    startedAtMs: Date.now(),
    usage: process.resourceUsage(),
    evidence,
  };
}

export function finishEvidence<T extends BaseWorkflowEvidence>(
  state: EvidenceState<T>,
  defaultDestination: string,
  outputPath?: string,
): string {
  const current = process.resourceUsage();
  state.evidence.finishedAt = new Date().toISOString();
  state.evidence.status = state.evidence.errors.length === 0 ? 'passed' : 'failed';
  state.evidence.resources = {
    wallTimeMs: Date.now() - state.startedAtMs,
    userCpuMicros: current.userCPUTime - state.usage.userCPUTime,
    systemCpuMicros: current.systemCPUTime - state.usage.systemCPUTime,
    maxRssKb: current.maxRSS,
  };
  const destination = outputPath
    || process.env.STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH
    || defaultDestination;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(state.evidence, null, 2)}\n`, 'utf8');
  return destination;
}
