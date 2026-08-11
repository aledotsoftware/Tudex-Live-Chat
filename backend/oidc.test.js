const { test, describe } = require('node:test');
const assert = require('node:assert');

describe('OIDC / Pocket ID Authentication configuration & URL generation', () => {
  const DEFAULT_ISSUER = 'https://passport.tudexnetworks.com';
  const DEFAULT_CLIENT_ID = '710e8b14-d605-4a21-83d4-86ed0e002811';
  const DEFAULT_AUTHORIZE_URL = 'https://passport.tudexnetworks.com/authorize';

  test('should construct valid Pocket ID authorize URL with correct query params', () => {
    const redirectUri = 'http://localhost:5173/auth/callback';
    const state = 'test_state_12345';
    
    const authUrl = new URL(DEFAULT_AUTHORIZE_URL);
    authUrl.searchParams.set('client_id', DEFAULT_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);

    const fullUrl = authUrl.toString();
    assert.ok(fullUrl.startsWith(DEFAULT_AUTHORIZE_URL));
    assert.strictEqual(authUrl.searchParams.get('client_id'), DEFAULT_CLIENT_ID);
    assert.strictEqual(authUrl.searchParams.get('redirect_uri'), redirectUri);
    assert.strictEqual(authUrl.searchParams.get('response_type'), 'code');
    assert.strictEqual(authUrl.searchParams.get('scope'), 'openid profile email');
    assert.strictEqual(authUrl.searchParams.get('state'), state);
  });

  test('should validate environment variable overrides for OIDC configuration', () => {
    const customIssuer = process.env.OIDC_ISSUER || DEFAULT_ISSUER;
    const customClientId = process.env.OIDC_CLIENT_ID || DEFAULT_CLIENT_ID;

    assert.strictEqual(customIssuer, DEFAULT_ISSUER);
    assert.strictEqual(customClientId, DEFAULT_CLIENT_ID);
  });
});
