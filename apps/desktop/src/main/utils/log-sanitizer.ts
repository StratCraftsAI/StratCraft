/**
 * PII Sanitization for Log Files (TICKET_573)
 *
 * Dual-layer approach:
 * - Layer 1: JSON field-based sanitization (sensitive field names -> [REDACTED])
 * - Layer 2: Regex text sanitization (email, bearer, API key, IP, home dir)
 */

import os from 'os';

// ============================================================================
// Constants
// ============================================================================

const REDACTED = '[REDACTED]';

/** JSON field names that contain sensitive data */
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'api_secret',
  'authorization',
  'cookie',
  'session_id',
  'credit_card',
  'ssn',
  'private_key',
  'master_password',
]);

/** Regex patterns for text-based PII detection */
const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: 'Bearer [TOKEN_REDACTED]',
  },
  {
    name: 'api_key_param',
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)[\s]*[=:]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi,
    replacement: 'api_key=[KEY_REDACTED]',
  },
  {
    name: 'ipv4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    replacement: '[IP_REDACTED]',
  },
];

// ============================================================================
// Types
// ============================================================================

export interface SanitizationResult {
  sanitized: string;
  redactions: string[];
}

// ============================================================================
// Layer 1: JSON Field Sanitization
// ============================================================================

function sanitizeJsonFields(line: string): SanitizationResult {
  const redactions: string[] = [];

  try {
    const obj = JSON.parse(line);
    const sanitized = sanitizeObject(obj, redactions);
    return { sanitized: JSON.stringify(sanitized), redactions };
  } catch {
    // Not valid JSON, return as-is for Layer 2 processing
    return { sanitized: line, redactions };
  }
}

function sanitizeObject(obj: unknown, redactions: string[]): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, redactions));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = REDACTED;
      redactions.push(`field:${key}`);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value, redactions);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// Layer 2: Regex Text Sanitization
// ============================================================================

function sanitizeTextPatterns(line: string): SanitizationResult {
  const redactions: string[] = [];
  let result = line;

  // Home directory replacement
  const homeDir = os.homedir();
  if (result.includes(homeDir)) {
    result = result.split(homeDir).join('[HOME_DIR]');
    redactions.push('home_directory');
  }

  // Apply regex patterns
  for (const { name, pattern, replacement } of PII_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
      redactions.push(name);
    }
  }

  return { sanitized: result, redactions };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Sanitize a single log line using dual-layer approach.
 * Layer 1: JSON field-based sanitization (if line is valid JSON)
 * Layer 2: Regex text sanitization (always applied)
 */
export function sanitizeLogLine(line: string): SanitizationResult {
  // Layer 1: Try JSON field sanitization
  const jsonResult = sanitizeJsonFields(line);

  // Layer 2: Apply text pattern sanitization
  const textResult = sanitizeTextPatterns(jsonResult.sanitized);

  return {
    sanitized: textResult.sanitized,
    redactions: [...jsonResult.redactions, ...textResult.redactions],
  };
}

/**
 * Sanitize full log file content line by line.
 * Returns sanitized content and aggregated redaction info.
 */
export function sanitizeLogContent(content: string): {
  sanitized: string;
  results: SanitizationResult[];
} {
  const lines = content.split('\n');
  const results: SanitizationResult[] = [];

  const sanitizedLines = lines.map(line => {
    if (!line.trim()) return line;
    const result = sanitizeLogLine(line);
    if (result.redactions.length > 0) {
      results.push(result);
    }
    return result.sanitized;
  });

  return {
    sanitized: sanitizedLines.join('\n'),
    results,
  };
}

// ============================================================================
// Human-readable labels for redaction types
// ============================================================================

const REDACTION_LABELS: Record<string, string> = {
  email: 'Email addresses',
  bearer_token: 'Bearer tokens',
  api_key_param: 'API key parameters',
  ipv4: 'IP addresses',
  home_directory: 'Home directory paths',
};

const REDACTION_TOKENS: Record<string, string> = {
  email: '[EMAIL_REDACTED]',
  bearer_token: '[TOKEN_REDACTED]',
  api_key_param: '[KEY_REDACTED]',
  ipv4: '[IP_REDACTED]',
  home_directory: '[HOME_DIR]',
};

/**
 * Generate a summary report of all sanitization actions.
 * Includes a user-readable header followed by technical detail.
 */
export function generateSanitizationReport(results: SanitizationResult[]): string {
  if (results.length === 0) {
    return 'Diagnostic Package - Privacy Report\n====================================\nNo sensitive information was detected. 0 lines modified.\n';
  }

  const redactionCounts: Record<string, number> = {};
  for (const result of results) {
    for (const redaction of result.redactions) {
      redactionCounts[redaction] = (redactionCounts[redaction] || 0) + 1;
    }
  }

  const totalRedactions = Object.values(redactionCounts).reduce((sum, c) => sum + c, 0);

  // User-readable header
  const lines = [
    'Diagnostic Package - Privacy Report',
    '====================================',
    '',
    `Summary: ${totalRedactions} sensitive items redacted across ${results.length} lines.`,
    '',
    'What was redacted:',
  ];

  for (const [type, count] of Object.entries(redactionCounts).sort((a, b) => b[1] - a[1])) {
    const label = REDACTION_LABELS[type] || type;
    const token = REDACTION_TOKENS[type] || '[REDACTED]';
    lines.push(`  - ${label}: ${count} (replaced with ${token})`);
  }

  // Technical separator
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Technical Detail:');
  lines.push(`Total lines modified: ${results.length}`);
  lines.push('');
  lines.push('Redaction summary:');

  for (const [type, count] of Object.entries(redactionCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${type}: ${count}`);
  }

  return lines.join('\n') + '\n';
}
