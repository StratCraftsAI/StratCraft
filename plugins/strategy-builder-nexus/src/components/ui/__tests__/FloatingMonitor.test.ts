/**
 * FloatingMonitor Source-Pin Tests
 *
 * TICKET_077_28 / TICKET_897: Validates the generic FloatingMonitor component
 * structure, props interface, expanded/collapsed rendering branches, gauge bar,
 * counter variants, action button, and drag support.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  FloatingMonitorProps,
  FloatingMonitorGauge,
  FloatingMonitorCounter,
  FloatingMonitorAction,
} from '../FloatingMonitor';

const src = readFileSync(
  resolve(__dirname, '..', 'FloatingMonitor.tsx'),
  'utf-8',
);

describe('FloatingMonitor props interface (TICKET_077_28)', () => {
  it('accepts minimal required props', () => {
    const minimal: FloatingMonitorProps = {
      title: 'Progress',
      visible: true,
      progress: 0.5,
      progressLabel: '5/10',
    };
    expect(minimal.visible).toBe(true);
    expect(minimal.gauges).toBeUndefined();
    expect(minimal.counters).toBeUndefined();
    expect(minimal.action).toBeUndefined();
  });

  it('accepts full props with gauges, counters, and action', () => {
    const gauge: FloatingMonitorGauge = {
      id: 'cpu',
      label: 'CPU',
      value: 68,
      displayValue: '68%',
    };
    const counter: FloatingMonitorCounter = {
      id: 'succeeded',
      label: 'Succeeded',
      value: 10,
      variant: 'success',
    };
    const action: FloatingMonitorAction = {
      label: 'Stop',
      onClick: vi.fn(),
      variant: 'danger',
      disabled: false,
    };
    const full: FloatingMonitorProps = {
      title: 'Sweep Progress',
      visible: true,
      expanded: true,
      onExpandedChange: vi.fn(),
      onDismiss: vi.fn(),
      progress: 0.5,
      progressLabel: '12/663 arms',
      statusLine: '~18 min remaining',
      detailLines: ['Phase: Model Fit'],
      gauges: [gauge],
      counters: [counter],
      action,
      pillLabel: '12/663 (~18 min)',
      complete: false,
      className: 'custom',
      testId: 'test-monitor',
    };
    expect(full.gauges).toHaveLength(1);
    expect(full.counters).toHaveLength(1);
    expect(full.action?.variant).toBe('danger');
  });
});

describe('FloatingMonitor rendering branches (TICKET_897)', () => {
  it('returns null when not visible', () => {
    expect(src).toMatch(/if \(!visible\) return null/);
  });

  it('renders collapsed pill when not expanded', () => {
    expect(src).toMatch(/if \(!isExpanded\)/);
    expect(src).toMatch(/testId \? `\$\{testId\}-pill`/);
  });

  it('pill shows spinner or check icon based on complete', () => {
    expect(src).toMatch(/complete \?[\s\S]*?<CheckIcon/);
    expect(src).toMatch(/<SpinnerIcon[\s\S]*?animate-spin/);
  });

  it('pill shows pillLabel falling back to progressLabel', () => {
    expect(src).toMatch(/pillLabel \?\? progressLabel/);
  });

  it('pill has stop button when action is present and not disabled', () => {
    expect(src).toMatch(/action && !action\.disabled/);
    expect(src).toMatch(/<StopIcon/);
  });

  it('expanded panel has title bar with collapse and dismiss buttons', () => {
    expect(src).toMatch(/handleToggle/);
    expect(src).toMatch(/<MinimizeIcon/);
    expect(src).toMatch(/onDismiss &&/);
    expect(src).toMatch(/<CloseIcon/);
  });

  it('progress bar uses block-segment fill pattern', () => {
    expect(src).toMatch(/repeating-linear-gradient\(90deg/);
  });

  it('progress bar clamps to 0-1 range', () => {
    expect(src).toMatch(/Math\.min\(1, Math\.max\(0, progress\)\)/);
  });

  it('renders gauges with color thresholds', () => {
    expect(src).toMatch(/gauge\.value > 90/);
    expect(src).toMatch(/bg-red-500/);
    expect(src).toMatch(/gauge\.value > 70/);
    expect(src).toMatch(/bg-color-terminal-accent-gold/);
    expect(src).toMatch(/bg-color-terminal-accent-teal/);
  });

  it('renders counters with variant styling', () => {
    expect(src).toMatch(/counterColor/);
    expect(src).toMatch(/text-green-400/);
    expect(src).toMatch(/text-red-400/);
  });

  it('action button supports danger variant and disabled state', () => {
    expect(src).toMatch(/action\.variant === 'danger'/);
    expect(src).toMatch(/border-red-500/);
    expect(src).toMatch(/action\.disabled/);
    expect(src).toMatch(/cursor-not-allowed/);
  });
});

describe('FloatingMonitor drag support (TICKET_897)', () => {
  it('tracks drag state via pointer events on title bar', () => {
    expect(src).toMatch(/onPointerDown/);
    expect(src).toMatch(/onPointerMove/);
    expect(src).toMatch(/onPointerUp/);
    expect(src).toMatch(/setPointerCapture/);
  });

  it('applies drag offset via CSS transform', () => {
    expect(src).toMatch(/transform: `translate\(\$\{offset\.x\}px, \$\{offset\.y\}px\)`/);
  });

  it('resets drag offset when hidden', () => {
    expect(src).toMatch(/if \(!visible\) setOffset\(\{ x: 0, y: 0 \}\)/);
  });

  it('ignores drag when clicking a button', () => {
    expect(src).toMatch(/closest\('button'\)/);
  });
});

describe('FloatingMonitor controlled/uncontrolled mode (TICKET_077_28)', () => {
  it('supports controlled expanded state', () => {
    expect(src).toMatch(/controlledExpanded/);
    expect(src).toMatch(/isControlled \? controlledExpanded : internalExpanded/);
  });

  it('calls onExpandedChange on toggle', () => {
    expect(src).toMatch(/onExpandedChange\?\.\(next\)/);
  });
});
