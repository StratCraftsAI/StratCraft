/**
 * Credit Status Types
 *
 * TICKET_519: Subscription Plan & Credit Display
 * Centralized type definitions for credit/subscription status.
 */

/**
 * Raw response from Python tunnel: GET /api/v1/user/credit-status
 * Backend returns flat snake_case JSON (no wrapper).
 */
export interface CreditStatusRawResponse {
  has_credit: boolean;
  remaining: number;
  total_recharged?: number;
  total_consumed?: number;
  updated_at?: string; // ISO8601
  reset_date?: string; // ISO8601
}

/**
 * Normalized camelCase credit status used by renderer.
 * Fields not yet provided by backend are optional.
 */
export interface CreditStatus {
  hasCredit: boolean;
  remaining: number;
  totalRecharged?: number;
  totalConsumed?: number;
  updatedAt?: string; // ISO8601
  resetDate?: string; // ISO8601
}
