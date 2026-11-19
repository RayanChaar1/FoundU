/* TS-NFR-10 to TS-NFR-13 Security and privacy, checked on the whole API, and the overload answer of NFR-1.
   The route sweeps read the routes from the application itself, so a route added by any module is covered. */
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { createApp } = require('../src/app');
const { requireAuth, cookieOptions, ROLE_SETS } = require('../src/middleware/auth');
const { decrypt, hash, verifyHash } = require('../src/lib/crypto');
const { purgeAuditLog } = require('../src/modules/retention/service');
const { app, request, lastCode, signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, jpeg, today } = require('./fixtures');

const EMAILS = {
  sara: 'sara.k@lau.edu', omar: 'omar.h@lau.edu', lea: 'lea.n@lau.edu', karim: 'k.saad@lau.edu',
  maya: 'maya.azar@lau.edu', john: 'john@acme.com', pa: 'pa@foundu.app',
};
const ROLE_OF = { sara: 'USER', john: 'USER', karim: 'SECURITY', maya: 'ORG_ADMIN', pa: 'PLATFORM_ADMIN' };
const PERMITTED = { staff: 'karim', admin: 'maya', platform: 'pa' };
// Routes that answer without a session: signing in, the access request (FR-18.1), a QR tag's page (FR-12.4),
// and the read-only post history, which answers 405 to everyone (FR-3.8)
const PUBLIC = [
  'post /auth/start', 'post /auth/verify', 'post /auth/profile', 'post /auth/logout',
  'post /organizations/requests', 'get /tags/:token', 'post /tags/:token/messages',
  'delete /posts/:id/history', 'patch /posts/:id/history', 'put /posts/:id/history',
];

/** Every API route: method, path and whether it needs a session or a role. */
function routesOf(application) {
  const out = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        const handlers = layer.route.stack.map((s) => s.handle);
        const role = handlers.find((h) => h.roleSet)?.roleSet;
        const auth = Boolean(role) || handlers.includes(requireAuth);
        for (const method of Object.keys(layer.route.methods)) {
          for (const path of [].concat(layer.route.path)) {
            out.push({ method: method === '_all' ? 'delete' : method, path, role, auth });
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(application.router.stack);
  return out.filter((r) => r.path !== '/api/health');
}
const ROUTES = routesOf(app);
const has = (method, path) => ROUTES.some((r) => r.method === method && r.path === path);
const url = (path) => `/api${path.replace(/:(\w+)/g, (m, name) => ({ token: 'notatoken', domain: 'example.com' })[name] || '1')}`;
const call = (agent, method, path) => agent[method](path);

let R;
const as = {};
const uid = {};
let acme;

/** A found post by Omar with a photo and the verification answer "A blue LAU sticker". */
async function foundPost(title = 'Black iPhone 14') {
  const req = as.omar.post('/api/posts/found');
  const fields = {
    title, categoryId: R.phone, locationId: R.library, date: today(), whereabouts: 'FINDER',
    verificationQuestion: 'What is the sticker on it?', verificationAnswer: 'A blue LAU sticker',
  };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  req.attach('photos', await jpeg(), 'p.jpg');
  const id = (await req.expect(201)).body.id;
  const { photoIds } = (await as.omar.get(`/api/posts/${id}`).expect(200)).body.post;
  return { id, photoId: photoIds[0] };
}
/** Sara claims the post and Omar approves; returns the claim id. */
async function approvedClaim(postId) {
  const claimId = (await as.sara.post(`/api/posts/${postId}/claims`).send({ answer: 'Blue sticker' }).expect(201)).body.claim.id;
  await as.omar.post(`/api/claims/${claimId}/approve`).expect(200);
  return claimId;
}

beforeAll(async () => {
  R = await ref();
  const names = Object.keys(EMAILS);
  const agents = await Promise.all(names.map((n) => signIn(EMAILS[n])));
  names.forEach((n, i) => { as[n] = agents[i]; });
  const { rows } = await query('SELECT user_id, email FROM users WHERE email = ANY($1)', [Object.values(EMAILS)]);
  for (const n of names) uid[n] = rows.find((r) => r.email === EMAILS[n]).user_id;
  const one = async (sql) => (await query(sql)).rows[0];
  acme = {
    org: (await one(`SELECT organization_id AS id FROM organizations WHERE name LIKE 'Acme%'`)).id,
  };
  acme.category = (await query('SELECT category_id AS id FROM categories WHERE organization_id = $1 LIMIT 1', [acme.org])).rows[0].id;
  acme.location = (await query(
    'SELECT l.location_id AS id FROM locations l JOIN campuses c ON c.campus_id = l.campus_id WHERE c.organization_id = $1 LIMIT 1', [acme.org])).rows[0].id;
});

afterAll(() => pool.end());

describe('NFR-12.1 every action is authorized on the server', () => {
  test('the sweep sees the whole API', () => {
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES.filter((r) => r.role).length).toBeGreaterThan(0);
  });

  test('only the listed routes answer without a session', () => {
    const open = ROUTES.filter((r) => !r.auth).map((r) => `${r.method} ${r.path}`);
    expect(open.filter((r) => !PUBLIC.includes(r))).toEqual([]);
  });

  test('TC-NFR-12.1-D: every other route answers 401 without a session', async () => {
    const failures = [];
    for (const r of ROUTES.filter((x) => x.auth)) {
      const res = await call(request(app), r.method, url(r.path));
      if (res.status !== 401) failures.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  test('TC-NFR-12.1-D: every staff, administrator and platform route answers 403 to the roles it does not allow', async () => {
    const failures = [];
    let checked = 0;
    for (const r of ROUTES.filter((x) => x.role)) {
      for (const [name, role] of Object.entries(ROLE_OF)) {
        if (ROLE_SETS[r.role].includes(role)) continue;
        checked += 1;
        const res = await call(as[name], r.method, url(r.path));
        if (res.status !== 403) failures.push(`${name} ${r.method} ${r.path} -> ${res.status}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  test('TC-NFR-12.1-V: every page-level read answers 200 to a role it allows', async () => {
    // The query a page sends with the two reads that need one
    const params = { '/admin/report.csv': { from: '2026-01-01', to: today() } };
    if (has('post', '/tags')) {
      const tag = (await as.sara.post('/api/tags').field('label', 'Keys').expect(201)).body;
      params['/tags/sheet'] = { ids: String(tag.id) };
    }
    const failures = [];
    for (const r of ROUTES.filter((x) => x.auth && x.method === 'get' && !x.path.includes(':'))) {
      const agent = as[r.role ? PERMITTED[r.role] : 'sara'];
      const res = await agent.get(`/api${r.path}`).query(params[r.path] || {});
      if (res.status !== 200) failures.push(`${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  test('TC-NFR-12.1-D: a forged or tampered session token is refused, and a role written into it is ignored', async () => {
    const forged = jwt.sign({ sub: uid.maya }, 'not-the-secret', { expiresIn: '30m' });
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: uid.maya })).toString('base64url');
    for (const token of [forged, `${header}.${body}.`, 'garbage']) {
      await request(app).get('/api/auth/me').set('Cookie', `foundu_session=${token}`).expect(401);
    }
    // Even a correctly signed token cannot raise a role: the role is read from the database on every request
    const signed = jwt.sign({ sub: uid.sara, role: 'ORG_ADMIN' }, config.jwtSecret, { expiresIn: '30m' });
    const adminRoute = ROUTES.find((r) => r.role === 'admin' && r.method === 'get' && !r.path.includes(':'));
    await request(app).get(`/api${adminRoute.path}`).set('Cookie', `foundu_session=${signed}`).expect(403);
  });
});

describe('NFR-12.2 no data is visible across organizations', () => {
  test('TC-NFR-12.2-V / TC-NFR-12.2-D: John (Acme) gets 404 for every LAU record; Sara (LAU) gets them', async () => {
    const { id, photoId } = await foundPost('Grey laptop sleeve');
    const claimId = await approvedClaim(id);
    const records = [
      ['get', `/posts/${id}`], ['get', `/photos/${photoId}`], ['get', `/posts/${id}/claims`],
      ['get', `/posts/${id}/matches`], ['get', `/posts/${id}/history`], ['get', `/claims/${claimId}`],
      ['get', `/posts/${id}/contacts`], ['get', `/conversations/${claimId}`], ['get', `/users/${uid.sara}`],
      ['get', `/campuses/${R.beirut}/map`], ['get', `/campuses/${R.beirut}/hotspots`],
    ];
    const template = (path) => path.replace(/\/\d+/g, '/:id');
    const failures = [];
    for (const [method, path] of records.filter(([m, p]) => has(m, template(p)))) {
      const res = await as.john[method](`/api${path}`);
      if (res.status !== 404) failures.push(`john ${method} ${path} -> ${res.status}`);
    }
    const writes = [['patch', `/posts/${id}`, { title: 'Mine now' }], ['post', `/posts/${id}/claims`, { answer: 'Blue sticker' }], ['post', `/posts/${id}/close`, {}]];
    for (const [method, path, body] of writes) {
      const res = await as.john[method](`/api${path}`).send(body);
      if (res.status !== 404) failures.push(`john ${method} ${path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
    await as.sara.get(`/api/posts/${id}`).expect(200);
    await as.sara.get(`/api/photos/${photoId}`).expect(200);
    await as.sara.get(`/api/claims/${claimId}`).expect(200);
  });

  test('TC-NFR-12.2-D: a forged organization parameter is ignored', async () => {
    const feed = await as.john.get(`/api/posts?organizationId=${R.lau}&organization_id=${R.lau}`).expect(200);
    const lauIds = (await query('SELECT post_id FROM posts WHERE organization_id = $1', [R.lau])).rows.map((r) => r.post_id);
    expect(feed.body.items.filter((p) => lauIds.includes(p.id))).toEqual([]);

    const req = as.john.post('/api/posts/lost');
    const fields = { title: 'Blue umbrella', categoryId: acme.category, locationId: acme.location, date: today(), organizationId: R.lau, organization_id: R.lau };
    for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
    const created = (await req.expect(201)).body.id;
    const { rows: [p] } = await query('SELECT organization_id FROM posts WHERE post_id = $1', [created]);
    expect(p.organization_id).toBe(acme.org);

    // A LAU category or building cannot be used from Acme either
    const cross = as.john.post('/api/posts/lost');
    for (const [k, v] of Object.entries({ title: 'Blue umbrella', categoryId: R.phone, locationId: R.nicol, date: today() })) cross.field(k, String(v));
    expect((await cross).status).toBe(400);
  });
});

describe('NFR-13.1 no email address is shown to other users', () => {
  test('TC-NFR-13.1-V / TC-NFR-13.1-D: no response that shows other users contains an email address but the reader\'s own', async () => {
    const { id } = await foundPost('Silver bracelet');
    const claimId = await approvedClaim(id);
    if (has('post', '/conversations/:id/messages')) {
      await as.sara.post(`/api/conversations/${claimId}/messages`).send({ body: 'Hello, it is mine.' }).expect(201);
    }
    const pages = [
      '/posts', `/posts/${id}`, `/posts/${id}/claims`, `/posts/${id}/contacts`, `/posts/${id}/matches`, `/posts/${id}/history`,
      '/claims', `/claims/${claimId}`, '/conversations', `/conversations/${claimId}`, `/users/${uid.omar}`, `/users/${uid.sara}`,
      '/leaderboard', '/me/activity', '/notifications', '/reference', '/dropoffs', `/campuses/${R.beirut}/map`, '/tags',
    ].filter((p) => has('get', p.replace(/\/\d+/g, '/:id')));
    const found = [];
    let read = 0;
    for (const viewer of ['sara', 'omar', 'lea']) {
      for (const page of pages) {
        const res = await as[viewer].get(`/api${page}`);
        if (res.status !== 200) continue;
        read += 1;
        const emails = JSON.stringify(res.body).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || [];
        for (const e of emails.filter((x) => x.toLowerCase() !== EMAILS[viewer])) found.push(`${viewer} ${page}: ${e}`);
      }
    }
    expect(read).toBeGreaterThanOrEqual(15);
    expect(found).toEqual([]);
  });
});

describe('NFR-10 stored secrets', () => {
  test('TC-NFR-10.1-V / TC-NFR-10.1-D: verification answers are stored encrypted with AES-256-GCM', async () => {
    const a = await foundPost('Red scarf');
    const b = await foundPost('Red scarf');
    const { rows } = await query('SELECT verification_answer_enc AS enc FROM posts WHERE post_id = ANY($1) ORDER BY post_id', [[a.id, b.id]]);
    for (const { enc } of rows) {
      expect(enc).not.toMatch(/blue|sticker/i);
      expect(decrypt(enc)).toBe('A blue LAU sticker');
    }
    expect(rows[0].enc).not.toBe(rows[1].enc); // a new random IV each time: equal answers cannot be spotted
  });

  test('TC-NFR-10.2-V / TC-NFR-10.2-D: sign-in and handover codes are stored as salted argon2id hashes', async () => {
    await request(app).post('/api/auth/start').send({ email: EMAILS.lea }).expect(200);
    const code = lastCode(EMAILS.lea);
    const { rows: [otp] } = await query('SELECT code_hash FROM otp_codes WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1', [EMAILS.lea]);
    await query('DELETE FROM otp_codes WHERE lower(email) = $1', [EMAILS.lea]);
    expect(otp.code_hash).toMatch(/^\$argon2id\$/);
    expect(otp.code_hash).not.toContain(code);
    expect(await verifyHash(otp.code_hash, code)).toBe(true);

    const claims = [await approvedClaim((await foundPost('Watch')).id), await approvedClaim((await foundPost('Watch')).id)];
    const { rows } = await query('SELECT handover_code_hash AS h FROM claims WHERE claim_id = ANY($1)', [claims]);
    for (const { h } of rows) expect(h).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[\w+/]{16,}\$[\w+/]+$/);
    // Salted: the same code never gives the same hash
    expect(await hash('4821')).not.toBe(await hash('4821'));
  });
});

describe('NFR-11 attacks', () => {
  test('TC-NFR-11.2-V / TC-NFR-11.2-D: 100 requests per minute are answered, the 101st gets 429, other users are not affected', async () => {
    const before = config.rateLimitPerMinute;
    config.rateLimitPerMinute = 100;
    const limited = createApp();
    config.rateLimitPerMinute = before;
    const cookie = (name) => `foundu_session=${jwt.sign({ sub: uid[name] }, config.jwtSecret, { expiresIn: '30m' })}`;
    const statuses = [];
    for (let i = 0; i < 100; i += 10) {
      const batch = await Promise.all(Array.from({ length: 10 }, () => request(limited).get('/api/posts').set('Cookie', cookie('sara'))));
      statuses.push(...batch.map((r) => r.status));
    }
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    const over = await request(limited).get('/api/posts').set('Cookie', cookie('sara'));
    expect(over.status).toBe(429);
    expect(over.body.error).toMatch(/Too many requests/);
    await request(limited).get('/api/posts').set('Cookie', cookie('omar')).expect(200);
  });

  test('TC-NFR-11.1-D: SQL injection and script text are stored and returned as plain text', async () => {
    const title = `' OR '1'='1'; DROP TABLE posts; -- <script>alert(1)</script>`;
    const req = as.omar.post('/api/posts/lost');
    for (const [k, v] of Object.entries({ title, categoryId: R.wallet, locationId: R.nicol, date: today() })) req.field(k, String(v));
    const id = (await req.expect(201)).body.id;
    const res = await as.omar.get(`/api/posts/${id}`).expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.post.title).toBe(title);
    for (const q of [`' OR 1=1 --`, `'); DELETE FROM posts; --`, `<script>`]) {
      expect(Array.isArray((await as.lea.get('/api/posts').query({ q }).expect(200)).body.items)).toBe(true);
    }
    // LIKE wildcards are escaped: "%" finds only titles that contain "%"
    const percent = await as.lea.get('/api/posts').query({ q: '%' }).expect(200);
    expect(percent.body.items.every((p) => p.title.includes('%'))).toBe(true);
    // TC-NFR-2-D: an over-long query gets a clear message instead of a slow search
    const long = await as.lea.get('/api/posts').query({ q: 'wallet '.repeat(30) }).expect(400);
    expect(long.body.fields.q).toBe('Search with at most 100 characters.');
    expect((await query('SELECT count(*)::int AS n FROM posts')).rows[0].n).toBeGreaterThan(0);
  });

  test('TC-NFR-11.1-D: security headers are sent and requests over 100 kB are refused', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    await request(app).post('/api/auth/start').send({ email: 'x'.repeat(200 * 1024) }).expect(413);
  });

  test('TC-NFR-11.1-D: the session cookie is HTTP-only and SameSite, and Secure in production', async () => {
    const agent = request(app);
    await agent.post('/api/auth/start').send({ email: EMAILS.lea }).expect(200);
    const res = await agent.post('/api/auth/verify').send({ email: EMAILS.lea, code: lastCode(EMAILS.lea) }).expect(200);
    await query('DELETE FROM otp_codes WHERE lower(email) = $1', [EMAILS.lea]);
    const session = res.headers['set-cookie'].find((c) => c.startsWith('foundu_session='));
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Max-Age=1800/);

    const env = process.env.NODE_ENV;
    config.isTest = false;
    process.env.NODE_ENV = 'production';
    const production = cookieOptions();
    config.isTest = true;
    process.env.NODE_ENV = env;
    expect(production).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true });
  });
});

describe('NFR-1 overload', () => {
  test('TC-NFR-1-D: beyond the requests it can handle at once, the server answers 503 with a retry message, then recovers', async () => {
    const before = config.maxInFlight;
    config.maxInFlight = 2;
    const busy = createApp();
    config.maxInFlight = before;
    const cookie = `foundu_session=${jwt.sign({ sub: uid.lea }, config.jwtSecret, { expiresIn: '30m' })}`;
    const server = busy.listen(0);
    const at = `http://127.0.0.1:${server.address().port}/api/posts`;
    try {
      const burst = await Promise.all(Array.from({ length: 30 }, async () => {
        const res = await fetch(at, { headers: { cookie } });
        return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() };
      }));
      const refused = burst.filter((r) => r.status === 503);
      expect(burst.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(2);
      expect(refused.length).toBeGreaterThan(0);
      expect(burst.every((r) => [200, 503].includes(r.status))).toBe(true);
      expect(refused[0].body.error).toBe('FoundU is very busy.  Try again in a few seconds.');
      expect(refused[0].retryAfter).toBe('5');
      expect((await fetch(at, { headers: { cookie } })).status).toBe(200); // recovers once the load drops
    } finally {
      server.close();
    }
  });
});

describe('NFR-12.3 audit log retention', () => {
  test('TC-NFR-12.3-V / TC-NFR-12.3-D: entries are kept one year, then deleted, and cannot be deleted earlier', async () => {
    const entry = async (months) => (await query(
      `INSERT INTO audit_log (organization_id, action, target_type, reason, created_at)
       VALUES ($1, 'TEST', 'POST', $2, now() - make_interval(months => $3)) RETURNING audit_id`,
      [R.lau, `${months} months old`, months],
    )).rows[0].audit_id;
    const recent = await entry(11);
    const old = await entry(13);
    expect(await purgeAuditLog()).toBeGreaterThanOrEqual(1);
    const left = (await query('SELECT audit_id FROM audit_log WHERE audit_id = ANY($1)', [[recent, old]])).rows.map((r) => r.audit_id);
    expect(left).toEqual([recent]);
    // Through the API, no entry can be deleted at all (405 where the audit page exists)
    const res = await as.maya.delete(`/api/audit/${recent}`);
    expect([404, 405]).toContain(res.status);
    if (has('get', '/audit')) expect(res.status).toBe(405);
    expect((await query('SELECT 1 FROM audit_log WHERE audit_id = $1', [recent])).rowCount).toBe(1);
  });
});
