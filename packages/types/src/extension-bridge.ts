import { z } from 'zod';

export const EXTENSION_BRIDGE_CONTRACT_VERSION = '1.0.0' as const;

const extensionIdentifierSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
);

const extensionJsonValueSchema: z.ZodType<ExtensionJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(extensionJsonValueSchema),
  z.record(z.string(), extensionJsonValueSchema),
]));

export type ExtensionJsonValue =
  | string
  | number
  | boolean
  | null
  | ExtensionJsonValue[]
  | { [key: string]: ExtensionJsonValue };

export const extensionCapabilityRequestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BRIDGE_CONTRACT_VERSION),
  extensionId: extensionIdentifierSchema,
  command: extensionIdentifierSchema,
}).strict();

export const extensionInvocationSchema = z.object({
  contractVersion: z.literal(EXTENSION_BRIDGE_CONTRACT_VERSION),
  extensionId: extensionIdentifierSchema,
  requestId: extensionIdentifierSchema,
  command: extensionIdentifierSchema,
  input: z.record(z.string(), extensionJsonValueSchema),
}).strict();

export const extensionSubscriptionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BRIDGE_CONTRACT_VERSION),
  extensionId: extensionIdentifierSchema,
  event: extensionIdentifierSchema,
}).strict();

export const extensionEventSchema = z.object({
  contractVersion: z.literal(EXTENSION_BRIDGE_CONTRACT_VERSION),
  extensionId: extensionIdentifierSchema,
  event: extensionIdentifierSchema,
  payload: extensionJsonValueSchema,
}).strict();

export type ExtensionCapabilityRequest = z.infer<typeof extensionCapabilityRequestSchema>;
export type ExtensionInvocation = z.infer<typeof extensionInvocationSchema>;
export type ExtensionSubscription = z.infer<typeof extensionSubscriptionSchema>;
export type ExtensionEvent = z.infer<typeof extensionEventSchema>;
