/**
 * Policy-free result contract shared by public and optional MCP handlers.
 */
export interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  errorCategory?:
    | 'authentication'
    | 'validation'
    | 'storage'
    | 'schema'
    | 'network'
    | 'process'
    | 'internal';
}
