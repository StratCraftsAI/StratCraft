import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SEMANTIC_COLORS } from '@shared/constants/colors';

vi.mock('lucide-react', () => ({
  CheckCircle2: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'check' }),
  Loader2: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'loader' }),
  RotateCcw: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'retry' }),
  XCircle: ({ className }: { className?: string }) =>
    React.createElement('span', { className, 'data-icon': 'x' }),
}));

describe('CompilationStatusBadge', () => {
  it('renders nothing for idle status', async () => {
    const { CompilationStatusBadge } = await import('../CompilationStatusBadge');

    const html = renderToStaticMarkup(
      React.createElement(CompilationStatusBadge, { status: 'idle' })
    );

    expect(html).toBe('');
  });

  it('renders compiling state with spinner styling', async () => {
    const { CompilationStatusBadge } = await import('../CompilationStatusBadge');

    const html = renderToStaticMarkup(
      React.createElement(CompilationStatusBadge, { status: 'compiling' })
    );

    // TICKET_786_2: component uses t('compilation.compiling') -- unmocked i18n returns the key
    expect(html).toContain('compilation.compiling');
    expect(html).toContain('data-icon="loader"');
    expect(html).toContain('animate-spin');
    expect(html).toContain('text-color-terminal-accent-primary');
  });

  it('renders success state', async () => {
    const { CompilationStatusBadge } = await import('../CompilationStatusBadge');

    const html = renderToStaticMarkup(
      React.createElement(CompilationStatusBadge, { status: 'success' })
    );

    // TICKET_786_2: component uses t('compilation.compiled') -- unmocked i18n returns the key
    expect(html).toContain('compilation.compiled');
    expect(html).toContain('data-icon="check"');
    expect(html).toContain(SEMANTIC_COLORS.SUCCESS);
  });

  it('renders expandable compiler output with line numbers and retry action', async () => {
    const { CompilationStatusBadge } = await import('../CompilationStatusBadge');

    const html = renderToStaticMarkup(
      React.createElement(CompilationStatusBadge, {
        status: 'error',
        error: 'strategy.cpp:42:5: error: use of undeclared identifier',
        onRetry: vi.fn(),
      })
    );

    // TICKET_786_3: component uses t('compilation.failed') / t('compilation.retry') -- unmocked i18n returns the key
    expect(html).toContain('compilation.failed');
    expect(html).toContain('001 | strategy.cpp:42:5: error: use of undeclared identifier');
    expect(html).toContain('compilation.retry');
    expect(html).toContain('font-mono');
    expect(html).toContain('backdrop-blur-md');
  });
});
