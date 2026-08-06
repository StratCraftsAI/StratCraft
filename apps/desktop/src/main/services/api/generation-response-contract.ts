/** Runtime contracts for strategy-generation HTTP responses. */

import { z } from 'zod';

const backendErrorSchema = z.object({
  message: z.string().optional(),
}).loose();

export const generationResultSchema = z.object({
  status: z.string().optional(),
  task_id: z.string().optional(),
  strategy_code: z.string().optional(),
  strategyCode: z.string().optional(),
  class_name: z.string().optional(),
  error: z.union([z.string(), backendErrorSchema]).optional(),
  validation_report: z.unknown().optional(),
}).loose();

export const generationPayloadSchema = generationResultSchema.extend({
  result: generationResultSchema.optional(),
});

export const generationStartResponseSchema = generationPayloadSchema.extend({
  success: z.boolean().optional(),
  data: generationPayloadSchema.optional(),
  error_code: z.string().optional(),
});

export const generationPollResponseSchema = generationPayloadSchema.extend({
  success: z.boolean().optional(),
  data: generationPayloadSchema.optional(),
});

export type GenerationPayload = z.infer<typeof generationPayloadSchema>;

export function parseGenerationStartResponse(value: unknown): z.infer<typeof generationStartResponseSchema> {
  return generationStartResponseSchema.parse(value);
}

export function parseGenerationPollResponse(value: unknown): z.infer<typeof generationPollResponseSchema> {
  return generationPollResponseSchema.parse(value);
}

export function getGenerationErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const parsed = backendErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.message : undefined;
}
