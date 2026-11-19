/* TS-FR-14 Drop-off points. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');

let R;
let sara;
let omar;
let karim;
let maya;
let john;
const uid = {};
const loc = {};
let keys;
let libraryDesk;

const found = async (agent, extra = {}) => {
  const req = agent.post('/api/posts/found');
  const fields = {
    title: 'Black iPhone 14', categoryId: R.phone, locationId: R.nicol, date: today(),
    whereabouts: 'DROPOFF', dropoffId: R.securityOffice,
    verificationQuestion: 'What is the sticker on it?', verificationAnswer: 'A blue LAU sticker', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
};
const receive = (agent, postId, point = R.securityOffice) => agent.post(`/api/dropoffs/${point}/items`).send({ postId });
const items = async (point = R.securityOffice) => (await karim.get(`/api/dropoffs/${point}/items`).expect(200)).body;
const heldIds = async (point) => (await items(point)).held.map((i) => i.id);
/** An item handed in by Omar and recorded by Karim. */
async function held(extra) {
  const postId = await found(omar, extra);
  await receive(karim, postId).expect(200);
  return postId;
}
/** A held item with Sara's approved claim and her handover code. */
async function approvedHeld() {
  const postId = await held();
  const id = (await sara.post(`/api/posts/${postId}/claims`).send({ answer: 'Blue sticker' }).expect(201)).body.claim.id;
  await karim.post(`/api/claims/${id}/approve`).expect(200); // security officers review held items (FR-6.6)
  const code = (await sara.get(`/api/claims/${id}`).expect(200)).body.claim.handoverCode;
  return { postId, id, code };
}
const wrongCode = (code) => String((Number(code) + 1) % 10000).padStart(4, '0');
const row = async (sql, params) => (await query(sql, params)).rows[0];
const visitorPost = {
  title: 'Car keys with a red key ring', categoryId: null, locationId: null, date: null,
  verificationQuestion: 'What car brand is on the key?', verificationAnswer: 'Kia',
};

beforeAll(async () => {
  R = await ref();
  [sara, omar, karim, maya, john] = await Promise.all(
    ['sara.k@lau.edu', 'omar.h@lau.edu', 'k.saad@lau.edu', 'maya.azar@lau.edu', 'john@acme.com'].map(signIn),
  );
  for (const r of (await query('SELECT user_id, email FROM users')).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
  for (const r of (await query('SELECT location_id, building FROM locations')).rows) loc[r.building] = r.location_id;
  keys = (await row('SELECT category_id FROM categories WHERE organization_id = $1 AND name = $2', [R.lau, 'Keys'])).category_id;
  libraryDesk = (await row(`SELECT dropoff_id FROM dropoff_points WHERE name LIKE 'Library Desk%'`)).dropoff_id;
  Object.assign(visitorPost, { categoryId: keys, locationId: R.nicol, date: today() });
});
afterAll(async () => {
  await events.settle();
  await pool.end();
});

describe('TS-FR-14 Drop-off points', () => {
  test('TC-FR-14.1-V official points listed', async () => {
    const { dropoffs } = (await sara.get('/api/dropoffs').expect(200)).body;
    expect(dropoffs.map((d) => d.name)).toEqual(expect.arrayContaining(['Security Office, Nicol Hall', 'Library Desk, Riyad Nassar Library']));
  });

  test('TC-FR-14.1-D deleted or other organizations\' points not listed', async () => {
    const acme = await row(
      `INSERT INTO dropoff_points (organization_id, location_id, name, opening_hours, contact_number)
       SELECT organization_id, location_id, 'Acme Reception', '09:00 to 18:00', '01-111111' FROM locations
        WHERE building = 'Main Building' RETURNING dropoff_id`,
    );
    await query('UPDATE dropoff_points SET is_active = false WHERE dropoff_id = $1', [libraryDesk]);
    try {
      const names = (await sara.get('/api/dropoffs').expect(200)).body.dropoffs.map((d) => d.name);
      expect(names).toContain('Security Office, Nicol Hall');
      expect(names).not.toContain('Library Desk, Riyad Nassar Library');
      expect(names).not.toContain('Acme Reception');
      expect((await john.get('/api/dropoffs').expect(200)).body.dropoffs.map((d) => d.name)).toEqual(['Acme Reception']);
    } finally {
      await query('UPDATE dropoff_points SET is_active = true WHERE dropoff_id = $1', [libraryDesk]);
      await query('DELETE FROM dropoff_points WHERE dropoff_id = $1', [acme.dropoff_id]);
    }
  });

  test('TC-FR-14.2-V point saved with all attributes', async () => {
    const res = await maya.post('/api/dropoffs').send({
      name: 'Security Office, Irwin Hall', locationId: loc['Irwin Hall'], opensAt: '08:00', closesAt: '17:00', contactNumber: '01-786456 ext. 1333',
    }).expect(201);
    try {
      expect(res.body.dropoff).toMatchObject({
        name: 'Security Office, Irwin Hall', campus: 'Beirut', building: 'Irwin Hall', openingHours: '08:00 to 17:00', contactNumber: '01-786456 ext. 1333',
      });
      expect(await row(`SELECT * FROM audit_log WHERE action = 'DROPOFF_CREATED' AND target_id = $1`, [res.body.dropoff.id]))
        .toMatchObject({ actor_id: uid.maya });
    } finally {
      await query('DELETE FROM dropoff_points WHERE dropoff_id = $1', [res.body.dropoff.id]);
    }
  });

  test('TC-FR-14.2-D point with missing or invalid attributes refused', async () => {
    const point = { name: 'Security Office', locationId: R.nicol, opensAt: '08:00', closesAt: '17:00', contactNumber: 'ext. 1111' };
    const noName = await maya.post('/api/dropoffs').send({ ...point, name: '' }).expect(400);
    expect(noName.body.fields.name).toBe('Enter the name of the point.');
    const reversed = await maya.post('/api/dropoffs').send({ ...point, opensAt: '17:00', closesAt: '08:00' }).expect(400);
    expect(reversed.body.fields.closesAt).toBe('The closing time is after the opening time.');
    await sara.post('/api/dropoffs').send(point).expect(403);
  });

  test('TC-FR-14.3-V officer records the received item', async () => {
    const postId = await found(omar);
    expect(await heldIds()).not.toContain(postId);
    const res = await receive(karim, postId).expect(200);
    expect(res.body.held.map((i) => i.id)).toContain(postId);
    const { post } = (await sara.get(`/api/posts/${postId}`).expect(200)).body;
    expect(post.dropoff.name).toBe('Security Office, Nicol Hall');
    expect(await row('SELECT received_by FROM posts WHERE post_id = $1', [postId])).toEqual({ received_by: uid.k });
  });

  test('TC-FR-14.3-D non-officer, unknown post, or other campus refused', async () => {
    const postId = await found(omar);
    await receive(sara, postId).expect(403);
    await receive(karim, 99999).expect(404);
    await receive(karim, postId).expect(200);
    await receive(karim, postId).expect(409); // already held
    const byblos = await found(omar, { locationId: R.bassil, whereabouts: 'FINDER' });
    expect((await receive(karim, byblos).expect(400)).body.error).toBe('This item was found on another campus.');
    const req = omar.post('/api/posts/found');
    const fields = {
      title: 'Wallet', categoryId: R.wallet, locationId: R.bassil, date: today(), whereabouts: 'DROPOFF', dropoffId: R.securityOffice,
      verificationQuestion: 'Colour?', verificationAnswer: 'Brown',
    };
    for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
    expect((await req.expect(400)).body.fields.dropoffId).toBe('Choose a drop-off point on the campus where the item was found.');
  });

  test('TC-FR-14.4-V officer posts for a visitor', async () => {
    const res = await karim.post(`/api/dropoffs/${R.securityOffice}/posts`).send(visitorPost).expect(201);
    const post = await row('SELECT * FROM posts WHERE post_id = $1', [res.body.id]);
    expect(post).toMatchObject({ owner_id: uid.k, type: 'FOUND', status: 'OPEN', whereabouts: 'DROPOFF', dropoff_id: R.securityOffice });
    expect(post.received_at).not.toBeNull();
    expect(await heldIds()).toContain(res.body.id);
  });

  test('TC-FR-14.4-D registered user cannot post on behalf of others', async () => {
    const id = await found(sara, { whereabouts: 'FINDER', authorId: uid.omar, ownerId: uid.omar });
    expect((await row('SELECT owner_id FROM posts WHERE post_id = $1', [id])).owner_id).toBe(uid.sara);
    await sara.post(`/api/dropoffs/${R.securityOffice}/posts`).send(visitorPost).expect(403);
  });

  test('TC-FR-14.5-V release after the ID check', async () => {
    const { id, code } = await approvedHeld();
    const res = await karim.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code), idChecked: true }).expect(400);
    expect(res.body.details.attemptsLeft).toBe(4); // the ID check passed, so the release went on to the code
    expect((await karim.get(`/api/claims/${id}`).expect(200)).body.claim).toMatchObject({ atDropoff: true, canConfirm: true });
  });

  test('TC-FR-14.5-D release blocked without the ID check', async () => {
    const { id, code } = await approvedHeld();
    const res = await karim.post(`/api/claims/${id}/handover`).send({ code }).expect(400);
    expect(res.body.fields.idChecked).toMatch(/ID card/);
    expect(await row('SELECT status, failed_attempts FROM claims WHERE claim_id = $1', [id])).toEqual({ status: 'APPROVED', failed_attempts: 0 });
    await omar.post(`/api/claims/${id}/handover`).send({ code, idChecked: true }).expect(403); // the finder no longer has the item
  });

  test('TC-FR-14.6-V correct code releases the item', async () => {
    const { postId, id, code } = await approvedHeld();
    const res = await karim.post(`/api/claims/${id}/handover`).send({ code, idChecked: true }).expect(200);
    expect(res.body.claim.status).toBe('COMPLETED');
    expect(await row('SELECT status FROM posts WHERE post_id = $1', [postId])).toEqual({ status: 'RETURNED' });
    expect(await row('SELECT id_checked_by FROM claims WHERE claim_id = $1', [id])).toEqual({ id_checked_by: uid.k });
  });

  test('TC-FR-14.6-D wrong or missing code blocks the release', async () => {
    const { postId, id, code } = await approvedHeld();
    await karim.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code), idChecked: true }).expect(400);
    const empty = await karim.post(`/api/claims/${id}/handover`).send({ code: '', idChecked: true }).expect(400);
    expect(empty.body.fields.code).toBe('Enter the 4-digit code.');
    expect(await row('SELECT status FROM posts WHERE post_id = $1', [postId])).toEqual({ status: 'CLAIMED' });
  });

  test('TC-FR-14.7-V held items listed', async () => {
    const ids = [await held(), await held(), await held()];
    expect(await heldIds()).toEqual(expect.arrayContaining(ids));
  });

  test('TC-FR-14.7-D released items and other points excluded', async () => {
    const { postId, id, code } = await approvedHeld();
    await karim.post(`/api/claims/${id}/handover`).send({ code, idChecked: true }).expect(200);
    const atLibrary = await found(omar, { locationId: R.library, dropoffId: libraryDesk });
    await receive(karim, atLibrary, libraryDesk).expect(200);
    const list = await heldIds();
    expect(list).not.toContain(postId);
    expect(list).not.toContain(atLibrary);
    expect(await heldIds(libraryDesk)).toContain(atLibrary);
    await sara.get(`/api/dropoffs/${R.securityOffice}/items`).expect(403);
  });
});
