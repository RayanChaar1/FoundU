/* TS-FR-18 Organization management.  The DNS is replaced by a table of TXT records, and a small OpenID Connect
   provider runs on this computer, so the tests never depend on the internet. */
jest.mock('../src/modules/organizations/dns', () => {
  const records = {};
  return { records, txtRecords: async (domain) => records[domain] || [] };
});

const http = require('http');
const dns = require('../src/modules/organizations/dns');
const { signIn, app, request } = require('./helpers');
const { sent } = require('../src/lib/mailer');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const { award } = require('../src/modules/karma/service');

const CEDAR = {
  name: 'Cedar Bank',
  type: 'COMPANY',
  domains: ['cedarbank.com'],
  campuses: [{ name: 'Head Office', latitude: 33.8959, longitude: 35.4889 }],
  contactName: 'Nadine Karam',
  contactEmail: 'admin@cedarbank.com',
};

let R;
let maya;
let karim;
let sara;
let john;
let pa;
let idp;
let issuer;
const cleanup = [];

/** A minimal OpenID Connect provider: client "foundu" with the secret "right-secret". */
function startIdp() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/.well-known/openid-configuration') {
        return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` });
      }
      if (req.url === '/token' && req.method === 'POST') {
        const [id, secret] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
        if (id === 'foundu' && secret === 'right-secret') return json(200, { access_token: 'x', token_type: 'Bearer' });
        return json(401, { error: 'invalid_client' });
      }
      json(404, {});
    });
    server.listen(0, '127.0.0.1', () => {
      issuer = `http://localhost:${server.address().port}`;
      resolve(server);
    });
  });
}

beforeAll(async () => {
  R = await ref();
  [maya, karim, sara, john, pa] = await Promise.all(
    ['maya.azar@lau.edu', 'k.saad@lau.edu', 'sara.k@lau.edu', 'john@acme.com', 'pa@foundu.app'].map(signIn));
  idp = await startIdp();
});

afterAll(async () => {
  for (const [sql, params] of cleanup.reverse()) await query(sql, params);
  await query(`DELETE FROM organizations WHERE name = 'Cedar Bank'`);
  await query(`UPDATE organizations SET email_domains = '{lau.edu,lau.edu.lb}', karma_enabled = true, qr_enabled = true,
                      sso_issuer = NULL, sso_client_id = NULL, sso_secret_enc = NULL, sso_enabled = false
                WHERE organization_id = $1`, [R.lau]);
  await new Promise((r) => idp.close(r));
  await pool.end();
});

describe('TS-FR-18 Organization management', () => {
  test('TC-FR-18.1-V access request saved', async () => {
    const res = await request(app).post('/api/organizations/requests').send(CEDAR).expect(201);
    expect(res.body).toMatchObject({ name: 'Cedar Bank', status: 'PENDING', dnsRecord: expect.stringMatching(/^foundu-verify=/) });
    const mail = sent.filter((m) => m.to === 'admin@cedarbank.com').pop();
    expect(mail.text).toContain(res.body.dnsRecord);
    const { rows } = await query('SELECT name FROM campuses WHERE organization_id = $1', [res.body.id]);
    expect(rows).toEqual([{ name: 'Head Office' }]);
  });

  test('TC-FR-18.1-D incomplete or invalid request refused', async () => {
    const noDomains = await request(app).post('/api/organizations/requests')
      .send({ ...CEDAR, name: 'Cedar Two', domains: [] }).expect(400);
    expect(noDomains.body.fields.domains).toBe('Enter at least one email domain.');
    const lau = await request(app).post('/api/organizations/requests')
      .send({ ...CEDAR, name: 'Fake LAU', domains: ['lau.edu'], contactEmail: 'x@lau.edu' }).expect(409);
    expect(lau.body.error).toBe('lau.edu is already in use by another organization.');
    await request(app).post('/api/organizations/requests')
      .send({ ...CEDAR, name: 'Gmail Club', domains: ['gmail.com'], contactEmail: 'x@gmail.com' }).expect(400);
    const contact = await request(app).post('/api/organizations/requests')
      .send({ ...CEDAR, name: 'Cedar Two', domains: ['cedartwo.com'] }).expect(400); // contact not at the domain
    expect(contact.body.fields.contactEmail).toBe('Use an address at cedartwo.com.');
  });

  test('TC-FR-18.2-D activation without verification refused', async () => {
    const { rows: [cedar] } = await query(`SELECT organization_id AS id FROM organizations WHERE name = 'Cedar Bank'`);
    const res = await pa.post(`/api/platform/organizations/${cedar.id}/activate`).expect(409);
    expect(res.body.error).toMatch(/^The domain is not verified: cedarbank.com has no TXT record foundu-verify=/);
    await maya.post(`/api/platform/organizations/${cedar.id}/activate`).expect(403); // an organization administrator
    await request(app).post('/api/auth/start').send({ email: 'admin@cedarbank.com' }).expect(403); // still pending
    expect((await query('SELECT status FROM organizations WHERE organization_id = $1', [cedar.id])).rows[0].status).toBe('PENDING');
  });

  test('TC-FR-18.2-V activation after domain verification', async () => {
    const list = (await pa.get('/api/platform/organizations?status=PENDING').expect(200)).body.organizations;
    const cedar = list.find((o) => o.name === 'Cedar Bank');
    dns.records['cedarbank.com'] = ['v=spf1 -all', cedar.dnsRecord];
    expect((await pa.get(`/api/platform/organizations/${cedar.id}/dns`).expect(200)).body.checks)
      .toEqual([{ domain: 'cedarbank.com', verified: true }]);
    expect((await pa.post(`/api/platform/organizations/${cedar.id}/activate`).expect(200)).body.status).toBe('ACTIVE');

    const nadine = await signIn('admin@cedarbank.com'); // the contact is the first administrator
    expect((await nadine.get('/api/auth/me').expect(200)).body.user).toMatchObject({ role: 'ORG_ADMIN', organizationId: cedar.id });
    const { rows } = await query(`SELECT actor_id FROM audit_log WHERE action = 'ORG_ACTIVATED' AND target_id = $1`, [cedar.id]);
    expect(rows).toHaveLength(1);
    await pa.post(`/api/platform/organizations/${cedar.id}/activate`).expect(409); // only once
  });

  test('TC-FR-18.3-V every record carries its organization', async () => {
    const { rows } = await query(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'organization_id'
          AND table_name IN ('campuses', 'locations', 'categories', 'posts', 'dropoff_points', 'reports')`,
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.is_nullable === 'NO')).toBe(true);
    const orphans = await query(`SELECT count(*)::int AS n FROM users WHERE organization_id IS NULL AND role <> 'PLATFORM_ADMIN'`);
    expect(orphans.rows[0].n).toBe(0);
  });

  test('TC-FR-18.3-D record without an organization refused', async () => {
    await expect(query(
      `INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime, whereabouts)
       VALUES (NULL, NULL, 'LOST', 'Black iPhone 14', 'Test', $1, $2, now(), 'OWNER')`, [R.phone, R.nicol],
    )).rejects.toMatchObject({ code: '23502' }); // NOT NULL
  });

  test('TC-FR-18.4-V users see their own organization\'s posts', async () => {
    const { rows: [p] } = await query(
      `INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime)
       VALUES ($1, (SELECT user_id FROM users WHERE email = 'omar.h@lau.edu'), 'LOST', 'Black iPhone 14 org test',
               'Black case', $2, $3, $4) RETURNING post_id`, [R.lau, R.phone, R.nicol, today()]);
    cleanup.push(['DELETE FROM posts WHERE post_id = $1', [p.post_id]]);
    await sara.get(`/api/posts/${p.post_id}`).expect(200);
    const found = (await sara.get('/api/posts?q=iPhone org test').expect(200)).body.items;
    expect(found.some((x) => x.id === p.post_id)).toBe(true);
  });

  test('TC-FR-18.4-D other organizations\' posts invisible', async () => {
    const { rows: [p] } = await query(`SELECT post_id FROM posts WHERE title = 'Black iPhone 14 org test'`);
    await john.get(`/api/posts/${p.post_id}`).expect(404);
    const found = (await john.get('/api/posts?q=iPhone org test').expect(200)).body.items;
    expect(found).toEqual([]);
  });

  test('TC-FR-18.5-V organization data managed', async () => {
    // email domains (FR-18.5); the new one carries the organization's TXT record
    const { dnsRecord } = (await maya.get('/api/org/domains').expect(200)).body;
    dns.records['alumni.lau.edu'] = [dnsRecord];
    const added = (await maya.post('/api/org/domains').send({ domain: 'Alumni.LAU.edu' }).expect(201)).body.domains;
    expect(added.map((d) => d.domain)).toEqual(['lau.edu', 'lau.edu.lb', 'alumni.lau.edu']);
    const removed = (await maya.delete('/api/org/domains/alumni.lau.edu').expect(200)).body.domains;
    expect(removed.map((d) => d.domain)).toEqual(['lau.edu', 'lau.edu.lb']);
    // campus, building, drop-off point and category through the administration page (FR-16)
    const campus = await maya.post('/api/campuses').send({ name: 'Test Campus', latitude: 33.9, longitude: 35.5 }).expect(201);
    cleanup.push(['DELETE FROM campuses WHERE campus_id = $1', [campus.body.id]]);
    const bld = await maya.post('/api/buildings').send({ campusId: campus.body.id, name: 'Test Hall', latitude: 33.9, longitude: 35.5 }).expect(201);
    cleanup.push(['DELETE FROM locations WHERE location_id = $1', [bld.body.id]]);
    const point = await maya.post('/api/dropoffs').send({
      name: 'Test Desk', locationId: bld.body.id, opensAt: '09:00', closesAt: '17:00', contactNumber: '01-000000',
    }).expect(201);
    cleanup.push(['DELETE FROM dropoff_points WHERE dropoff_id = $1', [point.body.dropoff.id]]);
    const cat = await maya.post('/api/categories').send({ name: 'Test category' }).expect(201);
    cleanup.push(['DELETE FROM categories WHERE category_id = $1', [cat.body.id]]);
    await maya.delete(`/api/dropoffs/${point.body.dropoff.id}`).expect(204);
    await maya.delete(`/api/categories/${cat.body.id}`).expect(204);
  });

  test('TC-FR-18.5-D another organization\'s data cannot be managed', async () => {
    const { rows: [acme] } = await query(`SELECT location_id FROM locations WHERE building = 'Main Building'`);
    await maya.patch(`/api/buildings/${acme.location_id}`)
      .send({ campusId: R.beirut, name: 'Taken', latitude: 33.9, longitude: 35.5 }).expect(404);
    const inUse = await maya.delete('/api/org/domains/lau.edu').expect(409); // members sign in with it
    expect(inUse.body.error).toMatch(/members? sign in with lau\.edu, so it cannot be removed\.$/);
    await maya.post('/api/org/domains').send({ domain: 'cedarbank.com' }).expect(400); // no LAU record there
    await maya.post('/api/org/domains').send({ domain: 'gmail.com' }).expect(400);
    await karim.get('/api/org/domains').expect(403);
  });

  test('TC-FR-18.6-V karma switched off and on', async () => {
    const saraId = (await query(`SELECT user_id FROM users WHERE email = 'sara.k@lau.edu'`)).rows[0].user_id;
    expect((await maya.patch('/api/org/settings').send({ karmaEnabled: false }).expect(200)).body.karmaEnabled).toBe(false);
    expect(await award(saraId, 'RETURN')).toBeNull(); // no points while off
    await sara.get('/api/leaderboard').expect(404);
    expect((await sara.get('/api/auth/me').expect(200)).body.user.karmaEnabled).toBe(false);

    await maya.patch('/api/org/settings').send({ karmaEnabled: true }).expect(200);
    const back = await award(saraId, 'RETURN');
    cleanup.push(['DELETE FROM karma_events WHERE user_id = $1 AND reason = \'RETURN\' AND created_at > now() - interval \'1 hour\'', [saraId]]);
    cleanup.push(['UPDATE users SET karma_points = greatest(0, karma_points - 10) WHERE user_id = $1', [saraId]]);
    expect(back.balance).toBeGreaterThanOrEqual(10);
    await sara.get('/api/leaderboard').expect(200);
    const { rows } = await query(`SELECT reason FROM audit_log WHERE action = 'SETTINGS_CHANGED' AND organization_id = $1
                                   ORDER BY audit_id DESC LIMIT 2`, [R.lau]);
    expect(rows.map((r) => r.reason)).toEqual(['Karma points enabled', 'Karma points disabled']);
  });

  test('TC-FR-18.6-D switch limited to the organization\'s administrator', async () => {
    await karim.patch('/api/org/settings').send({ karmaEnabled: false }).expect(403);
    await maya.patch('/api/org/settings').send({ karmaEnabled: 'no' }).expect(400);
    expect((await maya.get('/api/org/settings').expect(200)).body.karmaEnabled).toBe(true);
  });

  test('TC-FR-18.7-V QR tags switched off and on', async () => {
    await maya.patch('/api/org/settings').send({ qrEnabled: false }).expect(200);
    expect((await sara.get('/api/auth/me').expect(200)).body.user.qrEnabled).toBe(false);
    await maya.patch('/api/org/settings').send({ qrEnabled: true }).expect(200);
    expect((await sara.get('/api/auth/me').expect(200)).body.user.qrEnabled).toBe(true);
  });

  test('TC-FR-18.7-D switch limited to the organization\'s administrator', async () => {
    await sara.patch('/api/org/settings').send({ qrEnabled: false }).expect(403);
    expect((await maya.get('/api/org/settings').expect(200)).body.qrEnabled).toBe(true);
  });

  test('TC-FR-18.8-V identity provider connected', async () => {
    const res = await maya.put('/api/org/sso').send({ issuer, clientId: 'foundu', clientSecret: 'right-secret' }).expect(200);
    expect(res.body).toMatchObject({ issuer, clientId: 'foundu', hasSecret: true, enabled: true,
      redirectUri: 'http://localhost:5173/api/auth/sso/callback' });
    const { rows: [o] } = await query('SELECT sso_secret_enc FROM organizations WHERE organization_id = $1', [R.lau]);
    expect(o.sso_secret_enc).not.toContain('right-secret'); // encrypted
    // saving again without the secret keeps the stored one
    await maya.put('/api/org/sso').send({ issuer, clientId: 'foundu' }).expect(200);
    await maya.delete('/api/org/sso').expect(200);
  });

  test('TC-FR-18.8-D wrong settings detected', async () => {
    const wrong = await maya.put('/api/org/sso').send({ issuer, clientId: 'foundu', clientSecret: 'wrong' }).expect(400);
    expect(wrong.body.error).toBe('The test sign-in failed: The identity provider refused the client ID or the client secret.  Nothing was changed.');
    expect((await maya.get('/api/org/sso').expect(200)).body).toMatchObject({ issuer: null, enabled: false });
    const lost = await maya.put('/api/org/sso').send({ issuer: `${issuer}/nowhere`, clientId: 'foundu', clientSecret: 'right-secret' }).expect(400);
    expect(lost.body.error).toMatch(/No OpenID Connect configuration was found/);
    const plain = await maya.put('/api/org/sso').send({ issuer: 'http://login.example.com', clientId: 'foundu', clientSecret: 'x' }).expect(400);
    expect(plain.body.fields.issuer).toBe('The issuer URL starts with https://.');
    const empty = await maya.put('/api/org/sso').send({ issuer: '', clientId: '', clientSecret: '' }).expect(400);
    expect(Object.keys(empty.body.fields).sort()).toEqual(['clientId', 'issuer']);
    await karim.put('/api/org/sso').send({ issuer, clientId: 'foundu', clientSecret: 'right-secret' }).expect(403);
  });
});
