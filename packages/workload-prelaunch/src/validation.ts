import type {
  ResolvedWorkloadParameter,
  StructuredWorkloadValidationError,
  WorkloadJsonValue,
} from '@StratCraft/types';
import type { WorkloadParameterDefinition, WorkloadParameterSpecification } from './index';
import { parseCalendarDateUtc } from './date-window';

const METADATA_KEYS = [
  'label', 'control', 'editable', 'impact', 'defaultSource', 'defaultRole', 'supportedChoices', 'validation',
  'nullable', 'visibleWhen', 'dateBounds',
] as const;

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function fieldError(
  code: string,
  parameterIds: readonly string[],
  message: string,
  remediation: string,
): StructuredWorkloadValidationError {
  return { code, parameterIds, message, remediation };
}

function conditionSatisfied(
  definition: WorkloadParameterDefinition,
  values: Readonly<Record<string, WorkloadJsonValue>>,
): boolean {
  const condition = definition.visibleWhen;
  return condition === undefined
    || condition.equals.some(candidate => canonical(candidate) === canonical(values[condition.parameterId]));
}

function validateType(
  definition: WorkloadParameterDefinition,
  parameter: ResolvedWorkloadParameter,
): StructuredWorkloadValidationError | undefined {
  const value = parameter.value;
  if (value === null && definition.nullable === true) return undefined;
  const control = definition.control ?? (definition.supportedChoices ? 'select' : 'text');
  const valid = control === 'number'
    ? typeof value === 'number'
    : control === 'multi-select' || control === 'tags'
      ? Array.isArray(value) && (control !== 'tags' || value.every(item => typeof item === 'string'))
      : control === 'date' || control === 'datetime' || control === 'text'
        ? typeof value === 'string'
        : true;
  return valid ? undefined : fieldError(
    'PARAMETER_TYPE_INVALID', [definition.id],
    `Parameter '${definition.id}' does not match its ${control} control type.`,
    'Supply a value with the type declared by the shared parameter specification.',
  );
}

/** Complete reusable specification validation for a resolved parameter document. */
export function validateWorkloadParameters(
  specification: WorkloadParameterSpecification,
  parameters: readonly ResolvedWorkloadParameter[],
): readonly StructuredWorkloadValidationError[] {
  const errors: StructuredWorkloadValidationError[] = [];
  const definitions = new Map(specification.parameters.map(definition => [definition.id, definition]));
  const groups = new Map<string, ResolvedWorkloadParameter[]>();
  for (const parameter of parameters) groups.set(parameter.id, [...(groups.get(parameter.id) ?? []), parameter]);

  for (const id of [...groups.keys()].filter(id => !definitions.has(id)).sort()) {
    errors.push(fieldError('UNKNOWN_PARAMETER', [id], `Unknown workload parameter '${id}'.`, 'Remove the unsupported parameter and resolve a new review.'));
  }
  const specificationOrder = new Map(specification.parameters.map((definition, index) => [definition.id, index]));
  const duplicateIds = [...groups.entries()].filter(([, entries]) => entries.length > 1).map(([id]) => id)
    .sort((left, right) => (specificationOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (specificationOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
  for (const id of duplicateIds) {
    errors.push(fieldError('DUPLICATE_PARAMETER', [id], `Parameter '${id}' appears more than once.`, 'Submit exactly one resolved value for each parameter ID.'));
  }

  const values = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.value]));
  for (const definition of specification.parameters) {
    const entries = groups.get(definition.id) ?? [];
    const visible = conditionSatisfied(definition, values);
    if (!visible && entries.length > 0) {
      errors.push(fieldError('HIDDEN_PARAMETER_PRESENT', [definition.id], `Hidden parameter '${definition.id}' is unexpectedly present.`, 'Remove values whose visibility condition is not active.'));
      continue;
    }
    if (visible && definition.required && entries.length === 0) {
      errors.push(fieldError('REQUIRED_PARAMETER_MISSING', [definition.id], `Required parameter '${definition.id}' is missing.`, 'Supply the required value and resolve a new review.'));
      continue;
    }
    if (entries.length === 0) continue;
    const parameter = entries[0];
    const expectedMetadata: Record<(typeof METADATA_KEYS)[number], unknown> = {
      label: definition.label,
      control: definition.control ?? (definition.supportedChoices ? 'select' : 'text'),
      editable: definition.editable,
      impact: definition.impact,
      defaultSource: parameter.provenance === 'default' || parameter.provenance === 'derived'
        ? definition.defaultSource
        : undefined,
      defaultRole: parameter.provenance === 'derived' ? definition.defaultRole : undefined,
      supportedChoices: definition.supportedChoices,
      validation: definition.validation,
      nullable: definition.nullable,
      visibleWhen: definition.visibleWhen,
      dateBounds: definition.dateBounds,
    };
    const mismatched = METADATA_KEYS.filter(key => canonical(parameter[key]) !== canonical(expectedMetadata[key]));
    if (mismatched.length > 0) {
      errors.push(fieldError('PARAMETER_METADATA_MISMATCH', [definition.id], `Parameter '${definition.id}' metadata disagrees with the shared specification: ${mismatched.join(', ')}.`, 'Resolve a fresh review from the shared workload owner.'));
    }
    const invalidType = validateType(definition, parameter);
    if (invalidType !== undefined) {
      errors.push(invalidType);
      continue;
    }
    const value = parameter.value;
    if (value === null && definition.nullable === true) continue;
    if (definition.required && (
      (typeof value === 'string' && value.trim().length === 0)
      || (Array.isArray(value) && value.length === 0)
      || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)
    )) errors.push(fieldError('PARAMETER_VALUE_EMPTY', [definition.id], `Required parameter '${definition.id}' is empty.`, 'Supply at least one value.'));

    if (definition.supportedChoices !== undefined) {
      const candidates = Array.isArray(value) ? value : [value];
      if (candidates.some(candidate => !definition.supportedChoices?.some(choice => canonical(choice) === canonical(candidate)))) {
        errors.push(fieldError('PARAMETER_CHOICE_UNSUPPORTED', [definition.id], `Parameter '${definition.id}' contains an unsupported choice.`, 'Choose only values published by the shared specification.'));
      }
    }
    if (typeof value === 'number') {
      const limits = definition.validation;
      if (!Number.isFinite(value)) {
        errors.push(fieldError('PARAMETER_NUMBER_NON_FINITE', [definition.id], `Parameter '${definition.id}' must be finite.`, 'Supply a finite numeric value.'));
      } else {
        if (limits?.minimum !== undefined && value < limits.minimum) errors.push(fieldError('PARAMETER_NUMBER_BELOW_MINIMUM', [definition.id], `Parameter '${definition.id}' is below ${limits.minimum}.`, `Use a value greater than or equal to ${limits.minimum}.`));
        if (limits?.maximum !== undefined && value > limits.maximum) errors.push(fieldError('PARAMETER_NUMBER_ABOVE_MAXIMUM', [definition.id], `Parameter '${definition.id}' is above ${limits.maximum}.`, `Use a value less than or equal to ${limits.maximum}.`));
        if (limits?.step !== undefined) {
          const base = limits.minimum ?? 0;
          const quotient = (value - base) / limits.step;
          if (Math.abs(quotient - Math.round(quotient)) > 1e-9) errors.push(fieldError('PARAMETER_NUMBER_STEP_INVALID', [definition.id], `Parameter '${definition.id}' does not align to step ${limits.step}.`, `Use increments of ${limits.step} from ${base}.`));
        }
      }
    }
    if ((definition.control === 'date' || definition.control === 'datetime') && typeof value === 'string') {
      try {
        parseCalendarDateUtc(value, definition.id);
        if (definition.dateBounds?.minimumDate !== undefined && value < definition.dateBounds.minimumDate) errors.push(fieldError('PARAMETER_DATE_BELOW_MINIMUM', [definition.id], `Parameter '${definition.id}' is before ${definition.dateBounds.minimumDate}.`, 'Choose a date inside the authoritative coverage window.'));
        if (definition.dateBounds?.maximumDate !== undefined && value > definition.dateBounds.maximumDate) errors.push(fieldError('PARAMETER_DATE_ABOVE_MAXIMUM', [definition.id], `Parameter '${definition.id}' is after ${definition.dateBounds.maximumDate}.`, 'Choose a date inside the authoritative coverage window.'));
      } catch (reason) {
        errors.push(fieldError('PARAMETER_DATE_INVALID', [definition.id], reason instanceof Error ? reason.message : String(reason), 'Supply a real calendar date in YYYY-MM-DD form.'));
      }
    }
  }
  return errors;
}
