/**
 * TICKET_927_1_4_F -- Tier-0 ISO 4217 currency enum.
 *
 * Mirrors 927_1_B's `currency.hpp` enum string-for-string so the wire
 * format across the executor / IPC bridge is a plain ISO code. Shared
 * between the identity-FX v1 (927_4_1) and the historical-FX v2 (this
 * ticket) implementations of `FxRateProvider`.
 *
 * Additive only: removing a value is a breaking change that touches
 * every persisted `firm_base_ccy` / `book_quote_ccy` row.
 */

export const CURRENCIES = [
  'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'CHF', 'CAD', 'AUD',
  'CNY', 'KRW', 'SGD', 'NZD',
] as const;

export type Currency = typeof CURRENCIES[number];

export function isCurrency(v: unknown): v is Currency {
  return typeof v === 'string'
    && (CURRENCIES as readonly string[]).includes(v);
}
