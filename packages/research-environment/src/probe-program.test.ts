/** TICKET_1335 AC24: structural safety gates for the embedded HistData probe. */

import { describe, expect, it } from 'vitest';

import { PROBE_PROGRAM } from './probe-program';

describe('HistData readiness program', () => {
  it('uses the public bounded parser-to-Parquet boundary with temporary output', () => {
    expect(PROBE_PROGRAM).toContain(
      'from histdata_supplementary.parser import parse_ascii_m1',
    );
    expect(PROBE_PROGRAM).toContain(
      'from histdata_supplementary.converter import write_parquet',
    );
    expect(PROBE_PROGRAM).toContain('with tempfile.TemporaryDirectory(');
    expect(PROBE_PROGRAM).toContain('table.column_names != expected_columns');
    expect(PROBE_PROGRAM).toContain('timestamp_type != "timestamp[ms]"');
  });

  it('does not import or invoke the downloader or a network client', () => {
    expect(PROBE_PROGRAM).not.toContain('histdata_supplementary.downloader');
    expect(PROBE_PROGRAM).not.toContain('histdata.com');
    expect(PROBE_PROGRAM).not.toMatch(/\b(?:requests|urllib|httpx|socket)\b/);
  });
});
