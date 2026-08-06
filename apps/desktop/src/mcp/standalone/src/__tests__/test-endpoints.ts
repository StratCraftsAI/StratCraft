/**
 * Shared endpoint fixtures for MCP standalone tests.
 *
 * Tests that merely need "some base URL" to exercise request construction must
 * use these values rather than the production domain. Hard-coding the real
 * endpoint couples every URL assertion to deployment configuration and copies
 * an internal service domain into publicly released source.
 *
 * `.test` is a reserved TLD (RFC 2606) and can never resolve, so a fixture that
 * accidentally escapes mocking fails loudly instead of reaching a real host.
 *
 * Tests whose subject IS the resolved default (for example the no-env-var
 * branch of `resolveNonaServer`) must instead assert against
 * `DESKTOP_API_BASE_URL` from `@StratCraft/types`, because there the constant
 * is the behavior under test.
 */

/** Base URL fixture for nona_server request-construction tests. */
export const NONA_TEST_BASE_URL = 'https://nona.test';

/** Auth-server base URL fixture for target-validation tests. */
export const AUTH_TEST_BASE_URL = 'https://auth.nona.test';
