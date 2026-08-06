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
}
