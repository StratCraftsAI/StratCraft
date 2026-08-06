/**
 * auth-contributions tests
 *
 * TICKET_809_1 Phase 6 (TICKET_809_6).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { HOST_PLUGIN_ID } from '../../../shared/types/credential-contribution';
import { credentialRegistry } from '../credential-registry';
import {
  getAuthContributions,
  registerAuthContributions,
} from '../auth-contributions';

afterEach(() => {
  credentialRegistry.clear();
});

describe('getAuthContributions', () => {
  it('returns exactly the oauth-session contribution', () => {
    const all = getAuthContributions();
    expect(all.map(c => c.providerId)).toEqual(['oauth-session']);
  });

  it('is host-owned, domain=auth, and read-only', () => {
    const c = getAuthContributions()[0]!;
    expect(c.pluginId).toBe(HOST_PLUGIN_ID);
    expect(c.domain).toBe('auth');
    expect(c.readOnly).toBe(true);
  });

  it('declares both OAuth field keys (tokens and user) as optional', () => {
    const c = getAuthContributions()[0]!;
    expect(c.fields.map(f => f.key)).toEqual(['oauth_tokens', 'oauth_user']);
    expect(c.fields.every(f => !f.required)).toBe(true);
  });

  it('has no verifier (OAuth tokens cannot be re-verified by the user)', () => {
    const c = getAuthContributions()[0]!;
    expect(c.verify).toBeUndefined();
  });
});

describe('registerAuthContributions', () => {
  it('registers the oauth-session contribution', () => {
    registerAuthContributions();
    expect(credentialRegistry.has('oauth-session')).toBe(true);
    expect(credentialRegistry.getByDomain('auth')).toHaveLength(1);
  });

  it('is idempotent', () => {
    registerAuthContributions();
    expect(() => registerAuthContributions()).not.toThrow();
    expect(credentialRegistry.size()).toBe(1);
  });
});
