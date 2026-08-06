/**
 * Public plugin-facing signal-fusion contract and process-local registry.
 *
 * This module owns only extension registration, dispatch lookup, and structural
 * validation. Commercial fusion implementations register through this contract
 * but remain outside the public host.
 */

export interface SignalFusionInput {
  factor_id: string;
  timestamps: number[];
  scores: Float64Array;
  ic?: number;
  icStd?: number;
  decaySlope?: number | null;
}

export interface FusionSignalMeta {
  factor_id: string;
  ic: number | undefined;
  icStd: number | undefined;
  decaySlope: number | null | undefined;
  scores: Float64Array;
}

export interface FusionWeightResult {
  weights: Record<string, number>;
  method: string;
  diagnostics?: Record<string, unknown>;
}

export interface ISignalFusion {
  readonly id: string;
  readonly displayName: string;

  computeWeights(
    inputs: SignalFusionInput[],
    warnings: string[],
    kellyFraction?: number,
  ): Record<string, number>;

  canRun(inputs: SignalFusionInput[]): boolean;
}

const registry = new Map<string, ISignalFusion>();
const pluginFusionIds = new Set<string>();

const RESERVED_HOST_FUSION_IDS: ReadonlySet<string> = new Set([
  'equal_weight',
  'ic_weighted',
  'regression',
  'ic_signed',
  'pca',
  'handcraft',
  'hrp',
  'optimal',
  'kelly',
  'ensemble',
  'hierarchical',
  'lstm',
]);

export function registerFusion(fusion: ISignalFusion): void {
  registry.set(fusion.id, fusion);
}

export function getFusion(id: string): ISignalFusion | undefined {
  return registry.get(id);
}

export function getAllFusions(): ReadonlyMap<string, ISignalFusion> {
  return registry;
}

export function hasFusion(id: string): boolean {
  return registry.has(id);
}

const PLUGIN_FUSION_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

export function validateFusionWeights(
  weights: Record<string, number>,
): { valid: boolean; reason?: string } {
  const keys = Object.keys(weights);
  if (keys.length === 0) return { valid: false, reason: 'empty weights' };
  let absSum = 0;
  for (const key of keys) {
    const weight = weights[key];
    if (!Number.isFinite(weight)) {
      return {
        valid: false,
        reason: `non-finite weight for '${key}': ${weight}`,
      };
    }
    absSum += Math.abs(weight);
  }
  if (absSum === 0) return { valid: false, reason: 'all weights are zero' };
  return { valid: true };
}

export function registerPluginFusion(fusion: ISignalFusion): void {
  if (RESERVED_HOST_FUSION_IDS.has(fusion.id)) {
    throw new Error(
      `registerPluginFusion: cannot override built-in method '${fusion.id}'`,
    );
  }
  if (!PLUGIN_FUSION_ID_PATTERN.test(fusion.id)) {
    throw new Error(
      `registerPluginFusion: id '${fusion.id}' must match ${PLUGIN_FUSION_ID_PATTERN} ` +
      `(lowercase alphanumeric + dots/hyphens/underscores, starting with a letter)`,
    );
  }
  if (typeof fusion.displayName !== 'string' || fusion.displayName.length === 0) {
    throw new Error(
      'registerPluginFusion: displayName must be a non-empty string',
    );
  }
  if (typeof fusion.computeWeights !== 'function') {
    throw new Error(
      `registerPluginFusion: '${fusion.id}' must implement computeWeights()`,
    );
  }
  if (typeof fusion.canRun !== 'function') {
    throw new Error(
      `registerPluginFusion: '${fusion.id}' must implement canRun()`,
    );
  }
  registry.set(fusion.id, fusion);
  pluginFusionIds.add(fusion.id);
}

export function unregisterPluginFusion(id: string): boolean {
  if (RESERVED_HOST_FUSION_IDS.has(id)) {
    throw new Error(
      `unregisterPluginFusion: cannot unregister built-in method '${id}'`,
    );
  }
  pluginFusionIds.delete(id);
  return registry.delete(id);
}

export function isPluginFusion(id: string): boolean {
  return pluginFusionIds.has(id);
}

export function getPluginFusionIds(): ReadonlySet<string> {
  return pluginFusionIds;
}
