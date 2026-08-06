/**
 * OHLCV parquet schema -- standalone export, zero runtime deps
 * (no Electron, no logger, no app singleton).
 *
 * Extracted from parquet-cache-service.ts so the TICKET_813 golden-
 * parquet regenerator script
 * (`scripts/regen-ohlcv-golden-parquet.ts`) can import the schema
 * without dragging the full ParquetCacheService class (which
 * depends on Electron's `app.getPath`).
 *
 * The schema constant is the single source of truth: both the
 * production writer (parquet-cache-service.ts) and the golden
 * regenerator import THIS module. Any change to the schema MUST
 * propagate to the regenerator's output, which the
 * `--check` CI gate validates by re-running the regenerator and
 * diffing the result against the checked-in golden fixture.
 *
 * The wire-format contract (timestamp = INT64 Unix seconds, OHLCV =
 * DOUBLE) is documented at length in parquet-cache-service.ts's
 * schema-block comment; do not duplicate the documentation here.
 */

import * as parquet from '@dsnp/parquetjs';

export const OHLCV_SCHEMA = new parquet.ParquetSchema({
  timestamp: { type: 'INT64' },
  open: { type: 'DOUBLE' },
  high: { type: 'DOUBLE' },
  low: { type: 'DOUBLE' },
  close: { type: 'DOUBLE' },
  volume: { type: 'DOUBLE' },
});
