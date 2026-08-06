/**
 * Auth Error Classification Tests
 *
 * TICKET_639: Tests error classification logic shared by SymbolSearchField and DataConfigPanel.
 * Validates that:
 * - Platform 401 ("Authentication required. Please log in.") triggers nexus:auth-required
 * - Session expired errors trigger nexus:auth-required
 * - BYOK credential errors (Alpaca "authentication failed") are classified as credential errors
 * - Generic errors fall through to serviceUnavailable
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// Extracted classification logic (mirrors SymbolSearchField + DataConfigPanel)
// =============================================================================

type ErrorCategory = 'platform_session' | 'byok_credential' | 'generic';

/**
 * Classifies an error message into one of three categories.
 * This mirrors the logic in both SymbolSearchField (line ~136) and DataConfigPanel (line ~221).
 */
function classifyAuthError(msg: string): ErrorCategory {
  const msgLower = msg.toLowerCase();

  const isAuthError =
    msg.includes('401') ||
    msgLower.includes('unauthorized') ||
    msgLower.includes('session expired') ||
    msgLower.includes('authentication failed') ||
    msgLower.includes('authentication required');

  if (!isAuthError) {
    return 'generic';
  }

  const isPlatformSessionError =
    msgLower.includes('session expired') ||
    msgLower.includes('authentication required. please log in');

  return isPlatformSessionError ? 'platform_session' : 'byok_credential';
}

// =============================================================================
// Tests
// =============================================================================

describe('Auth error classification', () => {
  // ===========================================================================
  // Platform session errors -- should trigger nexus:auth-required
  // ===========================================================================

  describe('platform session errors', () => {
    it('should classify "Authentication required. Please log in." as platform_session', () => {
      expect(classifyAuthError('Authentication required. Please log in.')).toBe('platform_session');
    });

    it('should classify session expired as platform_session', () => {
      expect(classifyAuthError('Your session expired. Please log in again.')).toBe('platform_session');
    });

    it('should classify api-request.ts standard 401 message as platform_session', () => {
      // This is the exact message from api-request.ts:97
      expect(classifyAuthError('Authentication required. Please log in.')).toBe('platform_session');
    });

    it('should classify case-insensitive session expired', () => {
      expect(classifyAuthError('SESSION EXPIRED')).toBe('platform_session');
    });
  });

  // ===========================================================================
  // BYOK credential errors -- should show credential remediation
  // ===========================================================================

  describe('BYOK credential errors', () => {
    it('should classify Alpaca auth failure as byok_credential', () => {
      expect(
        classifyAuthError('Alpaca authentication failed. Check your API key and secret in Settings > Credentials.')
      ).toBe('byok_credential');
    });

    it('should classify raw 401 status as byok_credential (not platform)', () => {
      expect(classifyAuthError('HTTP error 401')).toBe('byok_credential');
    });

    it('should classify "unauthorized" as byok_credential', () => {
      expect(classifyAuthError('Unauthorized access to data provider')).toBe('byok_credential');
    });

    it('should classify ClickHouse 401 as byok_credential', () => {
      expect(classifyAuthError('ClickHouse returned 401: Unauthorized')).toBe('byok_credential');
    });
  });

  // ===========================================================================
  // Generic errors -- should show serviceUnavailable
  // ===========================================================================

  describe('generic errors', () => {
    it('should classify network timeout as generic', () => {
      expect(classifyAuthError('Request timed out after 30000ms')).toBe('generic');
    });

    it('should classify connection refused as generic', () => {
      expect(classifyAuthError('ECONNREFUSED: Connection refused')).toBe('generic');
    });

    it('should classify 500 error as generic', () => {
      expect(classifyAuthError('Server error 500: Internal Server Error')).toBe('generic');
    });

    it('should classify empty message as generic', () => {
      expect(classifyAuthError('')).toBe('generic');
    });
  });
});
