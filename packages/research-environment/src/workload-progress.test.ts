import { describe, expect, it } from 'vitest';

import { parsePixiProgressLine, parseProbeProgressLine } from './workload-progress';

describe('research-environment workload progress', () => {
  it.each([
    ['Resolving dependencies...', 'Resolving dependencies'],
    ['Downloading packages (3/12)', 'Downloading packages (3/12)'],
    ['Fetching 2/8', 'Downloading packages (2/8)'],
    ['Installing packages 7/7', 'Installing packages (7/7)'],
    ['Linking packages', 'Installing packages'],
  ])('normalises pixi line %j', (line, summary) => {
    expect(parsePixiProgressLine(line)?.summary).toBe(summary);
  });

  it('strips terminal colour and computes bounded fractions', () => {
    expect(parsePixiProgressLine('\u001b[32mDownloading 3/12\u001b[0m')).toEqual({
      summary: 'Downloading packages (3/12)', fraction: 0.25,
    });
    expect(parsePixiProgressLine('Downloading 9/0')?.fraction).toBeNull();
  });

  it('ignores unrelated pixi output', () => {
    expect(parsePixiProgressLine('environment is already up to date')).toBeNull();
  });

  it('parses only valid framed capability progress', () => {
    expect(parseProbeProgressLine('<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>3:5:gpquant')).toEqual({
      summary: 'Verifying capabilities (3/5): gpquant', fraction: 0.6,
    });
    expect(parseProbeProgressLine('noise')).toBeNull();
    expect(parseProbeProgressLine('<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>1:5')).toBeNull();
    expect(parseProbeProgressLine('<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>0:5:duckdb')).toBeNull();
    expect(parseProbeProgressLine('<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>6:5:pysr')).toBeNull();
    expect(parseProbeProgressLine('<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>x:5:pysr')).toBeNull();
  });
});
