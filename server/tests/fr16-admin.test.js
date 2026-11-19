/* TS-FR-16 Administration. */
const { signIn, app, request } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const { award } = require('../src/modules/karma/service');

let R;
let maya;
let karim;
let sara;
let omar;
const uid = {};
const cleanup = []; // SQL run after the tests, in reverse order

const user = async (email) => (await query('SELECT user_id FROM users WHERE email = $1', [email])).rows[0].user_id;
const audits = async (action) =>
  (await query('SELECT target_id, reason FROM audit_log WHERE action = $1 ORDER BY audit_id', [action])).rows;

/** A post inserted directly, so its dates can be set (FR-16.2, FR-16.9). */
async function insertPost({ owner, type = 'LOST', title, createdAt = new Date(), status = 'OPEN', returnedAt = null }) {
  const found = type === 'FOUND';
  const { rows: [p] } = await query(
    `INSERT INTO posts (organization_id, owner_id, type, title, category_id, location_id, event_datetime, status,
                        returned_at, created_at, whereabouts, verification_question, verification_answer_enc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7, $10, $11, $12) RETURNING post_id`,
    [R.lau, owner, type, title, R.phone, R.nicol, createdAt, status, returnedAt,
      found ? 'FINDER' : null, found ? 'Colour?' : null, found ? 'x' : null],
  );
  cleanup.push(['DELETE FROM posts WHERE post_id = $1', [p.post_id]]);
  return p.post_id;
}

beforeAll(async () => {
  R = await ref();
  for (const e of ['maya.azar@lau.edu', 'k.saad@lau.edu', 'sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'john@acme.com']) {
    uid[e.split(/[.@]/)[0]] = await user(e);
  }
  [maya, karim, sara, omar] = await Promise.all(
    ['maya.azar@lau.edu', 'k.saad@lau.edu', 'sara.k@lau.edu', 'omar.h@lau.edu'].map(signIn));
});

afterAll(async () => {
  for (const [sql, params] of cleanup.reverse()) await query(sql, params);
  await query(`UPDATE users SET role = 'USER', status = 'ACTIVE' WHERE user_id = $1`, [uid.lea]);
  await pool.end();
});

describe('TS-FR-16 Administration', () => {
  test('TC-FR-16.1-V administrator finds users', async () => {
    const { rows: [j] } = await query(
      `INSERT INTO users (organization_id, email, full_name, display_name, campus_id)
       VALUES ($1, 'john.malik@lau.edu', 'John Malik', 'John M.', $2) RETURNING user_id`, [R.lau, R.beirut]);
    cleanup.push(['DELETE FROM users WHERE user_id = $1', [j.user_id]]);
    const res = await maya.get('/api/users?q=john').expect(200);
    expect(res.body.users.map((u) => u.email)).toEqual(['john.malik@lau.edu']);
    expect(res.body.users[0]).toMatchObject({ fullName: 'John Malik', role: 'USER', status: 'ACTIVE', campus: 'Beirut' });
  });

  test("TC-FR-16.1-D other organizations' users never returned", async () => {
    const res = await maya.get('/api/users?q=john').expect(200);
    expect(res.body.users.some((u) => u.email === 'john@acme.com')).toBe(false);
    await maya.get(`/api/users/${uid.john}/activity`).expect(404);
    await sara.get('/api/users?q=john').expect(403);
  });

  test('TC-FR-16.2-V user activity viewed', async () => {
    const lost = await insertPost({ owner: uid.omar, title: 'Grey hoodie' });
    const found = await insertPost({ owner: uid.sara, type: 'FOUND', title: 'Blue umbrella' });
    const { rows: [c] } = await query(
      `INSERT INTO claims (post_id, claimant_id, answer_text) VALUES ($1, $2, 'Blue') RETURNING claim_id`, [found, uid.omar]);
    await query(`INSERT INTO reports (organization_id, reporter_id, post_id, reason) VALUES ($1, $2, $3, 'SPAM')`,
      [R.lau, uid.omar, found]);
    const res = await maya.get(`/api/users/${uid.omar}/activity`).expect(200);
    expect(res.body.user.fullName).toBe('Omar Haddad');
    expect(res.body.posts).toEqual(expect.arrayContaining([expect.objectContaining({ id: lost, title: 'Grey hoodie', createdAt: expect.any(String) })]));
    expect(res.body.claims).toEqual(expect.arrayContaining([expect.objectContaining({ id: c.claim_id, postId: found, createdAt: expect.any(String) })]));
    expect(res.body.reportsMade).toEqual(expect.arrayContaining([expect.objectContaining({ postId: found, reason: 'SPAM' })]));
    const ofSara = await maya.get(`/api/users/${uid.sara}/activity`).expect(200);
    expect(ofSara.body.reportsReceived).toEqual(expect.arrayContaining([expect.objectContaining({ postId: found })]));
  });

  test('TC-FR-16.2-D non-administrator refused', async () => {
    await karim.get(`/api/users/${uid.omar}/activity`).expect(403);
    await request(app).get(`/api/users/${uid.omar}/activity`).expect(401);
  });

  test('TC-FR-16.3-V administrator assigns a role', async () => {
    const res = await maya.patch(`/api/users/${uid.lea}/role`).send({ role: 'SECURITY' }).expect(200);
    expect(res.body.user.role).toBe('SECURITY');
    const lea = await signIn('lea.n@lau.edu');
    await lea.get(`/api/dropoffs/${R.securityOffice}/items`).expect(200); // drop-off management (FR-14)
    expect((await audits('ROLE_CHANGED')).at(-1)).toEqual({ target_id: uid.lea, reason: 'USER to SECURITY' });
    await maya.patch(`/api/users/${uid.lea}/role`).send({ role: 'USER' }).expect(200);
    await lea.get(`/api/dropoffs/${R.securityOffice}/items`).expect(403);
  });

  test('TC-FR-16.3-D invalid role assignments refused', async () => {
    const res = await maya.patch(`/api/users/${uid.lea}/role`).send({ role: 'PLATFORM_ADMIN' }).expect(400);
    expect(res.body.error).toBe('Platform Administrator is not an organization role.');
    await karim.patch(`/api/users/${uid.lea}/role`).send({ role: 'SECURITY' }).expect(403);
    await maya.patch(`/api/users/${uid.maya}/role`).send({ role: 'USER' }).expect(409); // own role
    await maya.patch(`/api/users/${uid.john}/role`).send({ role: 'SECURITY' }).expect(404); // another organization
    expect((await query('SELECT role FROM users WHERE user_id = $1', [uid.lea])).rows[0].role).toBe('USER');
  });

  test('TC-FR-16.4-V account suspended', async () => {
    const lea = await signIn('lea.n@lau.edu');
    const res = await maya.post(`/api/users/${uid.lea}/suspend`).send({ reason: 'Repeated false claims' }).expect(200);
    expect(res.body.user.status).toBe('SUSPENDED');
    expect((await audits('USER_SUSPENDED')).at(-1)).toEqual({ target_id: uid.lea, reason: 'Repeated false claims' });
    await lea.get('/api/auth/me').expect(401); // session ended
  });

  test('TC-FR-16.4-D suspended account cannot use FoundU', async () => {
    const res = await request(app).post('/api/auth/start').send({ email: 'lea.n@lau.edu' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This account is suspended.');
    await maya.post(`/api/users/${uid.lea}/suspend`).send({ reason: '' }).expect(400); // a reason is required
    await maya.post(`/api/users/${uid.maya}/suspend`).send({ reason: 'Test' }).expect(409); // own account
  });

  test('TC-FR-16.5-V account reinstated', async () => {
    const res = await maya.post(`/api/users/${uid.lea}/reinstate`).expect(200);
    expect(res.body.user.status).toBe('ACTIVE');
    const lea = await signIn('lea.n@lau.edu');
    await lea.get('/api/auth/me').expect(200);
  });

  test('TC-FR-16.5-D reinstating an active account has no effect', async () => {
    const res = await maya.post(`/api/users/${uid.omar}/reinstate`).expect(409);
    expect(res.body.error).toBe('Account is not suspended.');
  });

  test('TC-FR-16.6-V categories, campuses, and buildings managed', async () => {
    const cat = await maya.post('/api/categories').send({ name: 'Sports equipment' }).expect(201);
    cleanup.push(['DELETE FROM categories WHERE category_id = $1', [cat.body.id]]);
    const bld = await maya.post('/api/buildings')
      .send({ campusId: R.beirut, name: 'Test Pavilion', latitude: 33.893, longitude: 35.478 }).expect(201);
    cleanup.push(['DELETE FROM locations WHERE location_id = $1', [bld.body.id]]);
    const reference = (await sara.get('/api/reference').expect(200)).body;
    expect(reference.categories.map((c) => c.name)).toContain('Sports equipment');
    expect(reference.buildings).toContainEqual(
      { id: bld.body.id, campusId: R.beirut, name: 'Test Pavilion', latitude: 33.893, longitude: 35.478 });
    await maya.patch(`/api/buildings/${bld.body.id}`)
      .send({ campusId: R.beirut, name: 'Test Pavilion', latitude: 33.8931, longitude: 35.4781 }).expect(204);
    await maya.delete(`/api/buildings/${bld.body.id}`).expect(204);
    await maya.delete(`/api/categories/${cat.body.id}`).expect(204);
    expect((await audits('BUILDING_UPDATED')).at(-1).reason).toBe('Test Pavilion');
  });

  test('TC-FR-16.6-D invalid or in-use reference data refused', async () => {
    const res = await maya.post('/api/buildings').send({ campusId: R.beirut, name: 'Nowhere', latitude: 200, longitude: 35.4 }).expect(400);
    expect(res.body.fields.latitude).toBe('The latitude is between -90 and 90.');
    await insertPost({ owner: uid.omar, title: 'Black phone' });
    const phone = await maya.delete(`/api/categories/${R.phone}`).expect(409);
    expect(phone.body.error).toMatch(/^Phone is used by \d+ posts?/);
    await maya.delete(`/api/buildings/${R.nicol}`).expect(409); // posts and a drop-off point use it
    await maya.delete(`/api/campuses/${R.beirut}`).expect(409); // it has buildings
    await maya.post('/api/categories').send({ name: 'Phone' }).expect(409); // duplicate
    await karim.post('/api/categories').send({ name: 'Tools' }).expect(403);
  });

  test('TC-FR-16.7-V drop-off points managed', async () => {
    const added = await maya.post('/api/dropoffs').send({
      name: 'Library Desk 2', locationId: R.library, opensAt: '09:00', closesAt: '18:00', contactNumber: '01-786456 ext. 1999',
    }).expect(201);
    const pid = added.body.dropoff.id;
    cleanup.push(['DELETE FROM dropoff_points WHERE dropoff_id = $1', [pid]]);
    await maya.patch(`/api/dropoffs/${pid}`).send({
      name: 'Library Desk 2', locationId: R.library, opensAt: '08:00', closesAt: '20:00', contactNumber: '01-786456 ext. 1999',
    }).expect(204);
    let list = (await sara.get('/api/dropoffs').expect(200)).body.dropoffs;
    expect(list.find((d) => d.id === pid).openingHours).toBe('08:00 to 20:00');
    await maya.delete(`/api/dropoffs/${pid}`).expect(204);
    list = (await sara.get('/api/dropoffs').expect(200)).body.dropoffs;
    expect(list.some((d) => d.id === pid)).toBe(false);
    expect((await audits('DROPOFF_REMOVED')).at(-1)).toEqual({ target_id: pid, reason: 'Library Desk 2' });
  });

  test('TC-FR-16.7-D point holding items not removed', async () => {
    const postId = await insertPost({ owner: uid.omar, type: 'FOUND', title: 'Keys with a red tag' });
    await karim.post(`/api/dropoffs/${R.securityOffice}/items`).send({ postId }).expect(200);
    const res = await maya.delete(`/api/dropoffs/${R.securityOffice}`).expect(409);
    expect(res.body.error).toMatch(/holds \d+ items?\./);
    await maya.patch(`/api/dropoffs/${R.securityOffice}`).send({
      name: 'Security Office, Nicol Hall', locationId: R.nicol, opensAt: '17:00', closesAt: '08:00', contactNumber: '1',
    }).expect(400);
    await karim.delete(`/api/dropoffs/${R.securityOffice}`).expect(403);
  });

  test('TC-FR-16.8-V parameters configured', async () => {
    const before = (await maya.get('/api/admin/settings').expect(200)).body;
    expect(before).toMatchObject({ retentionMonths: 12, karmaRules: { RETURN: 10, DROPOFF: 5, HELPFUL_REPORT: 2, FRAUD: -20 } });
    try {
      await maya.put('/api/admin/settings').send({ ...before, karmaRules: { ...before.karmaRules, RETURN: 12 } }).expect(200);
      const start = (await query('SELECT karma_points FROM users WHERE user_id = $1', [uid.sara])).rows[0].karma_points;
      const { balance } = await award(uid.sara, 'RETURN');
      expect(balance - start).toBe(12);
      expect((await audits('SETTINGS_CHANGED')).at(-1).reason).toBe('Return points 10 to 12');
    } finally {
      await maya.put('/api/admin/settings').send(before).expect(200); // parameters restored
      await query(`DELETE FROM karma_events WHERE user_id = $1`, [uid.sara]);
      await query(`DELETE FROM user_badges WHERE user_id = $1`, [uid.sara]);
      await query(`DELETE FROM notifications WHERE user_id = $1 AND type = 'BADGE'`, [uid.sara]);
      await query('UPDATE users SET karma_points = 0 WHERE user_id = $1', [uid.sara]);
    }
  });

  test('TC-FR-16.8-D out-of-range parameters refused', async () => {
    const before = (await maya.get('/api/admin/settings').expect(200)).body;
    const res = await maya.put('/api/admin/settings').send({ ...before, retentionMonths: 0 }).expect(400);
    expect(res.body.fields.retentionMonths).toBe('The retention period is between 1 and 60 months.');
    await maya.put('/api/admin/settings').send({ ...before, karmaRules: { ...before.karmaRules, FRAUD: 5 } }).expect(400);
    await sara.put('/api/admin/settings').send(before).expect(403);
    expect((await maya.get('/api/admin/settings')).body).toEqual(before);
  });

  test('TC-FR-16.9-V CSV export for a date range', async () => {
    for (const d of ['2025-09-10', '2025-09-28']) await insertPost({ owner: uid.omar, title: `September ${d}`, createdAt: new Date(`${d}T10:00:00`) });
    for (const d of ['02', '09', '15', '20']) {
      await insertPost({ owner: uid.omar, title: `Returned 10-${d}`, createdAt: new Date(`2025-10-${d}T10:00:00`),
        status: 'RETURNED', returnedAt: new Date(`2025-10-${d}T16:00:00`) });
    }
    await insertPost({ owner: uid.omar, title: '=HYPERLINK("x"), "quoted"', createdAt: new Date('2025-10-31T22:00:00') });
    const res = await maya.get('/api/admin/report.csv?from=2025-10-01&to=2025-10-31').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="foundu-posts-2025-10-01-to-2025-10-31.csv"');
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Post,Type,Title,Category,Campus,Building,Posted on,Status,Returned,Returned on');
    expect(lines).toHaveLength(6); // five October posts, no September post
    expect(lines.filter((l) => l.includes(',Returned,Yes,'))).toHaveLength(4);
    expect(res.text).not.toContain('September');
    expect(lines[5]).toContain(`"'=HYPERLINK(""x""), ""quoted"""`); // never read as a formula
  });

  test('TC-FR-16.9-D invalid range or non-administrator refused', async () => {
    const res = await maya.get('/api/admin/report.csv?from=2025-10-31&to=2025-10-01').expect(400);
    expect(res.body.error).toBe('The end date is before the start date.');
    await maya.get('/api/admin/report.csv?from=2025-10-01').expect(400);
    await sara.get(`/api/admin/report.csv?from=2025-10-01&to=${today()}`).expect(403);
  });
});
