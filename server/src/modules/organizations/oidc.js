/* FR-18.8: checks the OpenID Connect settings of an organization's identity provider before they are switched on.
   1. The discovery document <issuer>/.well-known/openid-configuration exists and names the same issuer.
   2. The token endpoint accepts the client ID and secret (client credentials request, HTTP Basic authentication).
   A provider that authenticates the client but does not allow that grant ("unauthorized_client",
   "unsupported_grant_type", "invalid_scope") still proves that the ID and secret are right. */
const TIMEOUT_MS = 5000;
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

/** Resolves with the provider's endpoints when the settings work; rejects with a SsoError that says what is wrong. */
async function testConnection({ issuer, clientId, clientSecret }) {
  const { status, body: meta } = await fetchJson(`${trim(issuer)}/.well-known/openid-configuration`);
  if (status !== 200 || !meta) throw new SsoError('No OpenID Connect configuration was found at this issuer URL.');
  if (trim(String(meta.issuer || '')) !== trim(issuer)) {
    throw new SsoError(`The provider calls itself ${meta.issuer || 'nothing'}, not ${issuer}.  Check the issuer URL.`);
  }
  if (!meta.token_endpoint || !meta.authorization_endpoint) {
    throw new SsoError('The provider configuration has no authorization or token endpoint.');
  }

  const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
  const token = await fetchJson(meta.token_endpoint, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
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

module.exports = { testConnection, SsoError };
