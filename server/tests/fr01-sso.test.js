/* TC-FR-1.2 and TC-NFR-25.1: single sign-on through the organization's OpenID Connect identity provider.
   The development provider in dev/idp.js plays LAU's provider; the browser's steps are made with fetch. */
const crypto = require('node:crypto');
const { app, request } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { encrypt } = require('../src/lib/crypto');
const { sent } = require('../src/lib/mailer');
const oidc = require('../src/modules/organizations/oidc');
const { createIdp } = require('../dev/idp');
const { ref } = require('./fixtures');

const CLIENT = 'http://localhost:5173';
let R;
let idp;
let issuer;

beforeAll(async () => {
  R = await ref();
  idp = createIdp({ clientId: 'foundu', clientSecret: 'dev-secret', password: 'demo-password' });
  issuer = await idp.start();
  await query(
    `UPDATE organizations SET sso_issuer = $2, sso_client_id = 'foundu', sso_secret_enc = $3, sso_enabled = true, sso_checked_at = now()
      WHERE organization_id = $1`,
    [R.lau, issuer, encrypt('dev-secret')]);
});

afterAll(async () => {
  await query(`UPDATE organizations SET sso_issuer = NULL, sso_client_id = NULL, sso_secret_enc = NULL, sso_enabled = false,
                      sso_checked_at = NULL WHERE organization_id = $1`, [R.lau]);
  await query(`DELETE FROM users WHERE email = 'new.sso@lau.edu'`);
  await idp.stop();
  await pool.end();
});

/** Steps 1 and 2: the user enters their address, then chooses "Sign in with LAU"; returns the provider's sign-in address. */
async function goToProvider(agent, email) {
  const start = await agent.post('/api/auth/start').send({ email }).expect(200);
  expect(start.body).toEqual({ sso: true, organization: 'Lebanese American University' });
  const go = await agent.get('/api/auth/sso/start').expect(302);
  return new URL(go.headers.location);
}

/** The user fills the provider's sign-in page; returns the provider's answer (a redirect back to FoundU, or the page). */
async function atProvider(authorize, { email, password = 'demo-password', action = 'signin' }) {
  const form = new URLSearchParams({ email, password, action });
  for (const k of ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge', 'code_challenge_method', 'scope']) {
    form.set(k, authorize.searchParams.get(k) || '');
  }
  return fetch(`${issuer}/authorize`, { method: 'POST', body: form, redirect: 'manual' });
}

/** Follows the provider's redirect to FoundU's callback with the same browser (agent). */
async function callback(agent, providerAnswer) {
  const back = new URL(providerAnswer.headers.get('location'));
  return agent.get(`${back.pathname}${back.search}`).expect(302);
}

describe('FR-1.2 single sign-on', () => {
  test('TC-FR-1.2-V: Sara signs in at the LAU provider and returns to FoundU signed in', async () => {
    const agent = request.agent(app);
    const before = sent.length;
    const authorize = await goToProvider(agent, 'sara.k@lau.edu');
    expect(sent.length).toBe(before); // no one-time code is emailed when single sign-on is available (FR-1.3)
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${issuer}/authorize`);
    expect(authorize.searchParams.get('login_hint')).toBe('sara.k@lau.edu');

    const page = await fetch(authorize, { redirect: 'manual' });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Sign in to your organization'); // the provider's own sign-in page

    const answer = await atProvider(authorize, { email: 'sara.k@lau.edu' });
    expect(answer.status).toBe(302);
    const done = await callback(agent, answer);
    expect(done.headers.location).toBe(`${CLIENT}/`); // the feed
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.email).toBe('sara.k@lau.edu');
  });

  test('TC-FR-1.2-V: a first sign-in through the provider asks for the campus, with the name filled in', async () => {
    const agent = request.agent(app);
    const authorize = await goToProvider(agent, 'new.sso@lau.edu');
    const done = await callback(agent, await atProvider(authorize, { email: 'new.sso@lau.edu' }));
    expect(done.headers.location).toBe(`${CLIENT}/signin?step=profile`);
    await agent.get('/api/auth/me').expect(401); // no session before the profile exists (FR-1.6)
    const pending = await agent.get('/api/auth/pending').expect(200);
    expect(pending.body).toMatchObject({ email: 'new.sso@lau.edu', fullName: 'New Sso' });
    const beirut = pending.body.campuses.find((c) => c.name === 'Beirut');
    await agent.post('/api/auth/profile').send({ fullName: 'New Sso', campusId: beirut.campus_id }).expect(201);
    expect((await agent.get('/api/auth/me').expect(200)).body.user.email).toBe('new.sso@lau.edu');
  });

  test('TC-FR-1.2-D: a wrong password or a cancelled sign-in at the provider creates no session', async () => {
    const agent = request.agent(app);
    const authorize = await goToProvider(agent, 'sara.k@lau.edu');
    const refused = await atProvider(authorize, { email: 'sara.k@lau.edu', password: 'wrong-password' });
    expect(refused.status).toBe(401); // the provider refuses and stays on its page
    expect(await refused.text()).toContain('Wrong email or password.');

    const cancelled = await callback(agent, await atProvider(authorize, { email: 'sara.k@lau.edu', action: 'cancel' }));
    expect(cancelled.headers.location).toBe(`${CLIENT}/signin?sso=denied`);
    await agent.get('/api/auth/me').expect(401);
  });

  test('TC-FR-1.2-D: a callback with a forged identity token is rejected and creates no session', async () => {
    const agent = request.agent(app);
    const authorize = await goToProvider(agent, 'sara.k@lau.edu');
    const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    idp.tamperNext((claims) => idp.sign(claims, { key: otherKey })); // same claims, signed with another key
    const done = await callback(agent, await atProvider(authorize, { email: 'sara.k@lau.edu' }));
    expect(done.headers.location).toBe(`${CLIENT}/signin?sso=invalid`);
    await agent.get('/api/auth/me').expect(401);
  });

  test('TC-FR-1.2-D: a replayed or foreign callback is refused (state checked once, per browser)', async () => {
    const victim = request.agent(app);
    const attacker = request.agent(app);
    const authorize = await goToProvider(attacker, 'sara.k@lau.edu');
    const answer = await atProvider(authorize, { email: 'sara.k@lau.edu' });
    const back = new URL(answer.headers.get('location'));
    await goToProvider(victim, 'k.saad@lau.edu');
    const foreign = await victim.get(`${back.pathname}${back.search}`).expect(302); // another browser's code and state
    expect(foreign.headers.location).toBe(`${CLIENT}/signin?sso=invalid`);
    await victim.get('/api/auth/me').expect(401);

    await attacker.get(`${back.pathname}${back.search}`).expect(302);
    await attacker.get('/api/auth/me').expect(200);
    await attacker.post('/api/auth/logout').expect(200);
    const replay = await attacker.get(`${back.pathname}${back.search}`).expect(302); // the same callback again
    expect(replay.headers.location).toBe(`${CLIENT}/signin?sso=expired`);
    await attacker.get('/api/auth/me').expect(401);
  });

  test('TC-FR-1.2-D: the provider cannot sign in an address of another organization', async () => {
    const agent = request.agent(app);
    const authorize = await goToProvider(agent, 'sara.k@lau.edu');
    const done = await callback(agent, await atProvider(authorize, { email: 'john@acme.com' }));
    expect(done.headers.location).toBe(`${CLIENT}/signin?sso=other-org`);
    await agent.get('/api/auth/me').expect(401);
  });

  test('TC-FR-1.2-D: the code sign-in stays for organizations without a provider, and SSO needs a started sign-in', async () => {
    const res = await request(app).post('/api/auth/start').send({ email: 'john@acme.com' }).expect(200);
    expect(res.body).toEqual({ sent: true, organization: expect.stringMatching(/^Acme/) });
    const lost = await request(app).get('/api/auth/sso/start').expect(302);
    expect(lost.headers.location).toBe(`${CLIENT}/signin?sso=expired`);
    await request(app).get('/api/auth/pending').expect(401);
  });
});

describe('NFR-25.1 OpenID Connect 1.0', () => {
  test('TC-NFR-25.1-V: authorization code flow with PKCE, and an RS256 ID token checked against the JWKS', async () => {
    const agent = request.agent(app);
    const authorize = await goToProvider(agent, 'sara.k@lau.edu');
    const p = authorize.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('foundu');
    expect(p.get('scope').split(' ')).toEqual(expect.arrayContaining(['openid', 'email']));
    expect(p.get('redirect_uri')).toBe(`${CLIENT}/api/auth/sso/callback`);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toMatch(/^[\w-]{20,}$/);
    expect(p.get('nonce')).toMatch(/^[\w-]{20,}$/);

    let token;
    idp.tamperNext((claims) => { token = idp.sign(claims); return token; });
    await callback(agent, await atProvider(authorize, { email: 'sara.k@lau.edu' }));
    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    const meta = await oidc.discover(issuer);
    const claims = await oidc.verifyIdToken(meta, token, { issuer, clientId: 'foundu', nonce: p.get('nonce') });
    expect(claims).toMatchObject({ iss: issuer, aud: 'foundu', email: 'sara.k@lau.edu' });
    await agent.get('/api/auth/me').expect(200);
  });

  test('TC-NFR-25.1-D: an ID token with a wrong audience, issuer, nonce, expiry or algorithm is rejected', async () => {
    const agent = request.agent(app);
    const authorize = await goToProvider(agent, 'sara.k@lau.edu');
    idp.tamperNext((claims) => idp.sign({ ...claims, aud: 'another-app' }));
    const done = await callback(agent, await atProvider(authorize, { email: 'sara.k@lau.edu' }));
    expect(done.headers.location).toBe(`${CLIENT}/signin?sso=invalid`);
    await agent.get('/api/auth/me').expect(401);

    const meta = await oidc.discover(issuer);
    const now = Math.floor(Date.now() / 1000);
    const good = { iss: issuer, sub: 'x', aud: 'foundu', iat: now, exp: now + 300, nonce: 'n-1', email: 'sara.k@lau.edu' };
    const check = (token) => oidc.verifyIdToken(meta, token, { issuer, clientId: 'foundu', nonce: 'n-1' });
    await expect(check(idp.sign(good))).resolves.toMatchObject({ email: 'sara.k@lau.edu' });
    await expect(check(idp.sign({ ...good, aud: 'another-app' }))).rejects.toThrow('issued for another application');
    await expect(check(idp.sign({ ...good, aud: ['foundu', 'another-app'] }))).rejects.toThrow('issued for another application');
    await expect(check(idp.sign({ ...good, iss: 'https://evil.example' }))).rejects.toThrow('issued by another provider');
    await expect(check(idp.sign({ ...good, nonce: 'n-2' }))).rejects.toThrow('does not answer this sign-in');
    await expect(check(idp.sign({ ...good, exp: now - 120 }))).rejects.toThrow('has expired');
    await expect(check(idp.sign(good, { keyId: 'unknown-key' }))).rejects.toThrow('a key the provider does not publish');
    const [, body] = idp.sign(good).split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${body}.`;
    await expect(check(none)).rejects.toThrow('signed with none are not accepted');
    const hs = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${body}.c2ln`;
    await expect(check(hs)).rejects.toThrow('signed with HS256 are not accepted');
  });
});
