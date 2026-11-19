/* A development OpenID Connect 1.0 provider for the laptop demo and the tests of FR-1.2 and NFR-25.1.
   It plays the part of an organization's identity provider (for example Microsoft Entra ID): a sign-in page,
   the authorization code flow with PKCE, ID tokens signed with RS256, and a JWKS endpoint.  Not for production.

   Demo:  npm run idp --workspace server     (listens on http://localhost:4001)
   Then, as the LAU administrator, connect it in Admin › Organization › Single sign-on:
     issuer http://localhost:4001, client ID foundu, client secret dev-secret.
   Any address of the organization signs in with the password demo-password. */
const http = require('node:http');
const crypto = require('node:crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** "sara.k@lau.edu" -> "Sara K" */
const nameFrom = (email) => email.split('@')[0].split(/[._-]+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}

/**
 * Creates the provider.  Call start() to listen; it resolves with the issuer URL.
 * Options: clientId, clientSecret, password, port (0 picks a free port).
 */
function createIdp({ clientId = 'foundu', clientSecret = 'dev-secret', password = 'demo-password', port = 0 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `dev-${crypto.randomBytes(4).toString('hex')}`;
  const codes = new Map(); // one-use authorization codes
  let issuer;
  let tamper = null; // tests: replaces the next ID token (forged signature, wrong audience...)

  /** Signs an ID token.  Tests pass their own claims or key to forge a token. */
  function sign(claims, { key = privateKey, keyId = kid } = {}) {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId }));
    const payload = b64url(JSON.stringify(claims));
    const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), key);
    return `${header}.${payload}.${b64url(signature)}`;
  }

  function page(res, q, error) {
    const hidden = ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge', 'code_challenge_method', 'scope']
      .map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join('');
    res.writeHead(error ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Organization sign-in</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f6;font:16px system-ui,sans-serif;color:#1b1f2a}
form{background:#fff;padding:28px;border-radius:12px;width:min(360px,calc(100vw - 32px));box-sizing:border-box;box-shadow:0 2px 12px #0002}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#555;font-size:14px}label{display:block;font-weight:600;margin:12px 0 4px}
input[type=email],input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #bbb;border-radius:8px;font:inherit}
button{margin-top:16px;padding:10px 14px;border-radius:8px;border:0;font:inherit;font-weight:600;cursor:pointer}
.go{background:#0f6cbd;color:#fff;width:100%}.cancel{background:none;color:#0f6cbd;width:100%;margin-top:6px}
.err{background:#fde7e9;color:#a4262c;padding:10px;border-radius:8px;font-size:14px}</style></head><body>
<form method="post" action="/authorize">${hidden}
<h1>Sign in to your organization</h1><p>Development identity provider for FoundU.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(q.get('email') || q.get('login_hint'))}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button class="go" name="action" value="signin">Sign in</button>
<button class="cancel" name="action" value="cancel" formnovalidate>Cancel</button>
</form></body></html>`);
  }

  const back = (res, redirectUri, params) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    res.writeHead(302, { Location: url.toString() });
    res.end();
  };

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  async function handle(req, res) {
    const url = new URL(req.url, issuer);
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    }
    if (req.method === 'GET' && url.pathname === '/jwks') {
      return json(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    }
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== clientId || !q.get('redirect_uri') || q.get('response_type') !== 'code') {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Unknown client or invalid request.');
      }
      return page(res, q);
    }
    if (req.method === 'POST' && url.pathname === '/authorize') {
      const f = await readBody(req);
      if (f.get('client_id') !== clientId || !f.get('redirect_uri')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Unknown client.');
      }
      if (f.get('action') === 'cancel') return back(res, f.get('redirect_uri'), { error: 'access_denied', state: f.get('state') });
      const email = String(f.get('email') || '').trim().toLowerCase();
      if (!email.includes('@') || f.get('password') !== password) return page(res, f, 'Wrong email or password.');
      const code = b64url(crypto.randomBytes(24));
      codes.set(code, {
        email, nonce: f.get('nonce'), redirectUri: f.get('redirect_uri'),
        challenge: f.get('code_challenge'), method: f.get('code_challenge_method'), expires: Date.now() + 60_000,
      });
      return back(res, f.get('redirect_uri'), { code, state: f.get('state') });
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      const [id, secret] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString()
        .split(':').map(decodeURIComponent);
      if (id !== clientId || secret !== clientSecret) return json(res, 401, { error: 'invalid_client' });
      const f = await readBody(req);
      if (f.get('grant_type') !== 'authorization_code') return json(res, 400, { error: 'unauthorized_client' });
      const grant = codes.get(f.get('code'));
      codes.delete(f.get('code')); // a code works once
      if (!grant || grant.expires < Date.now() || grant.redirectUri !== f.get('redirect_uri')) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      const verifier = f.get('code_verifier') || '';
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      if (grant.method !== 'S256' || challenge !== grant.challenge) return json(res, 400, { error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: issuer,
        sub: crypto.createHash('sha256').update(grant.email).digest('hex').slice(0, 24),
        aud: clientId,
        iat: now,
        exp: now + 300,
        nonce: grant.nonce,
        email: grant.email,
        email_verified: true,
        name: nameFrom(grant.email),
      };
      const idToken = tamper ? tamper(claims) : sign(claims);
      tamper = null;
      return json(res, 200, { access_token: b64url(crypto.randomBytes(24)), token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    json(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => json(res, 500, { error: 'server_error' }));
  });

  return {
    sign,
    /** Tests only: the next token request returns fn(claims) as the ID token. */
    tamperNext: (fn) => { tamper = fn; },
    get issuer() { return issuer; },
    clientId,
    clientSecret,
    start: () => new Promise((resolve) => {
      server.listen(port, '127.0.0.1', () => {
        issuer = `http://localhost:${server.address().port}`;
        resolve(issuer);
      });
    }),
    stop: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { createIdp };

if (require.main === module) {
  const idp = createIdp({ port: Number(process.env.IDP_PORT || 4001) });
  idp.start().then((issuer) => {
    console.log(`Development identity provider at ${issuer}`);
    console.log('Connect it in Admin › Organization › Single sign-on: client ID foundu, client secret dev-secret.');
    console.log('Sign in with any address of the organization and the password demo-password.');
  });
}
