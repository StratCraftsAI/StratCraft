/**
 * MarketplacePage Auth Gate - Source Pin Tests
 *
 * TICKET_893: Verifies the auth gate pattern in MarketplacePage.tsx.
 * Unauthenticated users must see the AccessGate CTA instead of the plugin listing,
 * and zero marketplace API calls must fire.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  resolve(__dirname, '..', 'MarketplacePage.tsx'),
  'utf-8',
);

describe('MarketplacePage auth gate (TICKET_893)', () => {
  it('imports AccessGate from 077 shared components', () => {
    expect(src).toContain("import { AccessGate } from '@plugins/strategy-builder-nexus/components/ui/AccessGate'");
  });

  it('imports useIsAuthenticated hook', () => {
    expect(src).toContain("import { useIsAuthenticated } from '@/hooks/useAuth'");
  });

  it('calls useIsAuthenticated at component top level', () => {
    expect(src).toContain('const isAuthenticated = useIsAuthenticated()');
  });

  it('renders AccessGate with marketplace-auth-gate testId when not authenticated', () => {
    expect(src).toContain("testId=\"marketplace-auth-gate\"");
  });

  it('dispatches nexus:auth-required with open-login action from CTA', () => {
    expect(src).toContain("window.dispatchEvent(new CustomEvent('nexus:auth-required', { detail: { action: 'open-login' } }))");
  });

  it('uses i18n keys from marketplace namespace for gate text', () => {
    expect(src).toContain("t('authGate.title'");
    expect(src).toContain("t('authGate.description'");
    expect(src).toContain("t('authGate.cta'");
  });

  it('guards registry fetch with isAuthenticated', () => {
    expect(src).toContain('if (!isAuthenticated) return;');
  });

  it('renders BreadcrumbBar with title in auth gate state', () => {
    const gateBlock = src.slice(
      src.indexOf('// TICKET_893: Auth gate'),
      src.indexOf('// TICKET_893: Auth gate') + 500,
    );
    expect(gateBlock).toContain('BreadcrumbBar');
    expect(gateBlock).toContain('AccessGate');
  });

  it('uses LogIn icon for CTA', () => {
    expect(src).toContain("import { LogIn,");
    expect(src).toContain('ctaIcon={LogIn}');
  });
});
