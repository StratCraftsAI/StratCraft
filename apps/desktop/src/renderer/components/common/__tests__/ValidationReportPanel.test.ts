/**
 * ValidationReportPanel Unit Tests
 *
 * TICKET_650 Phase 4: Tests for backend validation report display component.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ValidationReport } from '../../../../shared/types/validation-report';
import { SEMANTIC_COLORS } from '@shared/constants/colors';

vi.mock('lucide-react', () => ({
  CheckCircle2: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'check' }),
  XCircle: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'x' }),
  MinusCircle: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'minus' }),
  ShieldCheck: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'shield' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'validation.backendReport': 'Backend Validation Report',
        'validation.pass': 'Pass',
        'validation.fail': 'Fail',
        'validation.skip': 'Skipped',
        'validation.L1': 'Contract Shape',
        'validation.L2': 'Security Scan',
        'validation.L3': 'Compilation',
        'validation.L4': 'Symbol Verification',
        'validation.L5': 'Isolated Load Test',
        'validation.L6': 'Smoke Test',
      };
      return translations[key] || key;
    },
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('ValidationReportPanel', () => {
  it('renders nothing when report is null', async () => {
    const { ValidationReportPanel } = await import('../ValidationReportPanel');

    const html = renderToStaticMarkup(
      React.createElement(ValidationReportPanel, { report: null })
    );

    expect(html).toBe('');
  });

  it('renders all-pass report with green shield and per-layer rows', async () => {
    const { ValidationReportPanel } = await import('../ValidationReportPanel');

    const report: ValidationReport = {
      task_id: 'task-1',
      code_kind: 'cpp',
      status: 'ok',
      validation_layers: {
        L1: { status: 'pass' },
        L2: { status: 'pass' },
        L3: { status: 'pass', compile_time_ms: 1234 },
        L4: { status: 'pass' },
        L5: { status: 'pass' },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ValidationReportPanel, { report })
    );

    expect(html).toContain('Backend Validation Report');
    expect(html).toContain('data-icon="shield"');
    expect(html).toContain(SEMANTIC_COLORS.SUCCESS); // green color
    expect(html).toContain('Contract Shape');
    expect(html).toContain('Security Scan');
    expect(html).toContain('Compilation');
    expect(html).toContain('1234ms');
    expect(html).toContain('Pass');
  });

  it('renders failed report with red border and error details', async () => {
    const { ValidationReportPanel } = await import('../ValidationReportPanel');

    const report: ValidationReport = {
      task_id: 'task-2',
      code_kind: 'cpp',
      status: 'fail',
      failed_layer: 'L3',
      error_code: 'COMPILE_FAILED',
      validation_layers: {
        L1: { status: 'pass' },
        L2: { status: 'pass' },
        L3: { status: 'fail', errors: ['error: use of undeclared identifier'] },
        L4: { status: 'skip' },
        L5: { status: 'skip' },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ValidationReportPanel, { report })
    );

    expect(html).toContain(SEMANTIC_COLORS.ERROR); // red color for failure
    expect(html).toContain('Fail');
    expect(html).toContain('Contract Shape');
    expect(html).toContain('Compilation');
    expect(html).toContain('error: use of undeclared identifier');
    expect(html).toContain('Skipped');
    expect(html).toContain('C++ compilation failed'); // error code resolved
  });

  it('renders skipped layers correctly', async () => {
    const { ValidationReportPanel } = await import('../ValidationReportPanel');

    const report: ValidationReport = {
      task_id: 'task-3',
      code_kind: 'cpp',
      status: 'ok',
      validation_layers: {
        L1: { status: 'pass' },
        L6: { status: 'skip' },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ValidationReportPanel, { report })
    );

    expect(html).toContain('data-icon="minus"');
    expect(html).toContain('Skipped');
    expect(html).toContain('Smoke Test');
  });

  it('renders stderr excerpt when present', async () => {
    const { ValidationReportPanel } = await import('../ValidationReportPanel');

    const report: ValidationReport = {
      task_id: 'task-4',
      code_kind: 'cpp',
      status: 'fail',
      failed_layer: 'L5',
      stderr_excerpt: 'segfault at address 0x0',
      validation_layers: {
        L5: { status: 'fail', errors: ['crash detected'] },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ValidationReportPanel, { report })
    );

    expect(html).toContain('validation.stderrOutput');
    expect(html).toContain('segfault at address 0x0');
  });

  it('uses error_message when error_code is not in known mapping', async () => {
    const { ValidationReportPanel } = await import('../ValidationReportPanel');

    const report: ValidationReport = {
      task_id: 'task-5',
      code_kind: 'cpp',
      status: 'fail',
      failed_layer: 'L2',
      error_code: 'UNKNOWN_ERROR_CODE',
      error_message: 'Custom backend error message',
      validation_layers: {
        L2: { status: 'fail' },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ValidationReportPanel, { report })
    );

    expect(html).toContain('Custom backend error message');
  });
});
