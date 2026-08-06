/**
 * Service API Types
 *
 * TICKET_425: Unified Service API Layer
 *
 * Shared response type matching existing IPC { success, data, error } pattern.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Stable machine identity preserved across the Service API boundary. */
  errorCode?: string;
}
