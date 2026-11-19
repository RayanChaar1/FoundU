/* OpenID Connect 1.0 with an organization's identity provider (NFR-25.1).
   FR-18.8: testConnection checks the settings before they are switched on.
   1. The discovery document <issuer>/.well-known/openid-configuration exists and names the same issuer.
   2. The token endpoint accepts the client ID and secret (client credentials request, HTTP Basic authentication).
   A provider that authenticates the client but does not allow that grant ("unauthorized_client",
   "unsupported_grant_type", "invalid_scope") still proves that the ID and secret are right.
   FR-1.2: authorizationUrl, exchangeCode and verifyIdToken sign a user in with the authorization code flow (with PKCE),
   and the ID token is accepted only with a valid signature from the provider's published keys, the right issuer,
   audience and nonce, and before it expires. */
const crypto = require('node:crypto');

const TIMEOUT_MS = 5000;
const CLOCK_SKEW_S = 60;
const ACCEPTED_ERRORS = ['unauthorized_client', 'unsupported_grant_type', 'invalid_scope'];

class SsoError extends Error {}

const trim = (url) => url.replace(/\/+$/, '');

async function fetchJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  } catch {
    throw new SsoError(`The identity provider at ${new URL(url).host} cannot be reached.`);
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** The provider's discovery document; it must name the same issuer and both endpoints. */
async function discover(issuer) {
  const { status, body: meta } = await fetchJson(`${trim(issuer)}/.well-known/openid-configuration`);
  if (status !== 200 || !meta) throw new SsoError('No OpenID Connect configuration was found at this issuer URL.');
  if (trim(String(meta.issuer || '')) !== trim(issuer)) {
    throw new SsoError(`The provider calls itself ${meta.issuer || 'nothing'}, not ${issuer}.  Check the issuer URL.`);
  }
  if (!meta.token_endpoint || !meta.authorization_endpoint) {
    throw new SsoError('The provider configuration has no authorization or token endpoint.');
  }
  return meta;
}

const basicAuth = (clientId, clientSecret) =>
  `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;

/** Resolves with the provider's endpoints when the settings work; rejects with a SsoError that says what is wrong. */
async function testConnection({ issuer, clientId, clientSecret }) {
  const meta = await discover(issuer);
  const token = await fetchJson(meta.token_endpoint, {
    method: 'POST',
    headers: { Authorization: basicAuth(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'openid' }).toString(),
  });
  const error = token.body?.error;
  if (token.status === 200 || ACCEPTED_ERRORS.includes(error)) {
    return { authorizationEndpoint: meta.authorization_endpoint, tokenEndpoint: meta.token_endpoint };
  }
  if (token.status === 401 || error === 'invalid_client') {
    throw new SsoError('The identity provider refused the client ID or the client secret.');
  }
  throw new SsoError(`The identity provider answered ${error || `HTTP ${token.status}`} to the test sign-in.`);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A random value for state, nonce and the PKCE verifier. */
const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));

/** Where the browser goes to sign in at the provider (authorization code flow, PKCE with S256). */
function authorizationUrl(meta, { clientId, redirectUri, state, nonce, verifier, loginHint }) {
  const url = new URL(meta.authorization_endpoint);
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  };
  if (loginHint) params.login_hint = loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Exchanges the authorization code for the ID token at the token endpoint. */
async function exchangeCode(meta, { clientId, clientSecret, code, redirectUri, verifier }) {
  const token = await fetchJson(meta.token_endpoint, {
    method: 'POST',
    headers: { Authorization: basicAuth(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
  });
  if (token.status !== 200 || typeof token.body?.id_token !== 'string') {
    throw new SsoError(`The identity provider did not return an ID token (${token.body?.error || `HTTP ${token.status}`}).`);
  }
  return token.body.id_token;
}

// Accepted signature algorithms; "none" and the shared-secret HS algorithms are refused.
const ALGORITHMS = {
  RS256: { hash: 'sha256', type: 'rsa' },
  RS384: { hash: 'sha384', type: 'rsa' },
  RS512: { hash: 'sha512', type: 'rsa' },
  PS256: { hash: 'sha256', type: 'rsa', options: { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } },
  ES256: { hash: 'sha256', type: 'ec', options: { dsaEncoding: 'ieee-p1363' } },
  ES384: { hash: 'sha384', type: 'ec', options: { dsaEncoding: 'ieee-p1363' } },
};

/** The provider's public key that signed the token, from its JWKS. */
async function signingKey(meta, kid) {
  if (!meta.jwks_uri) throw new SsoError('The provider configuration has no JWKS address.');
  const { status, body } = await fetchJson(meta.jwks_uri);
  const keys = status === 200 && Array.isArray(body?.keys) ? body.keys.filter((k) => !k.use || k.use === 'sig') : [];
  const jwk = kid ? keys.find((k) => k.kid === kid) : (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) throw new SsoError('The ID token was signed with a key the provider does not publish.');
  try {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new SsoError('The provider published a key that cannot be read.');
  }
}

const decodePart = (part) => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new SsoError('The ID token is not a valid JWT.');
  }
};

/** Verifies the ID token (OpenID Connect Core 1.0, section 3.1.3.7) and returns its claims. */
async function verifyIdToken(meta, idToken, { issuer, clientId, nonce, now = Date.now() }) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new SsoError('The ID token is not a valid JWT.');
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  const alg = ALGORITHMS[header.alg];
  if (!alg) throw new SsoError(`ID tokens signed with ${header.alg || 'no algorithm'} are not accepted.`);
  const key = await signingKey(meta, header.kid);
  if (!key.asymmetricKeyType.startsWith(alg.type)) throw new SsoError('The ID token algorithm does not match its key.');
  const valid = crypto.verify(alg.hash, Buffer.from(`${parts[0]}.${parts[1]}`), { key, ...alg.options },
    Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new SsoError('The ID token signature is not valid.');

  if (trim(String(claims.iss || '')) !== trim(issuer)) throw new SsoError('The ID token was issued by another provider.');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId)) {
    throw new SsoError('The ID token was issued for another application.');
  }
  const seconds = now / 1000;
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < seconds) throw new SsoError('The ID token has expired.');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > seconds) throw new SsoError('The ID token is dated in the future.');
  if (!nonce || claims.nonce !== nonce) throw new SsoError('The ID token does not answer this sign-in request.');
  return claims;
}

module.exports = { testConnection, discover, authorizationUrl, exchangeCode, verifyIdToken, randomToken, SsoError };
