/* TS-FR-5 Smart Match. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref } = require('./fixtures');
const events = require('../src/lib/events');
const { runFor } = require('../src/modules/matching/service');
const { score, similarity } = require('../src/modules/matching/score');

const W = { category: 35, building: 25, campus: 10, date1: 20, date3: 12, date7: 5, keywords: 20 }; // Table 12
let R;
let sara;
let omar;
let lea;
let john;
let maya;
const uid = {};
const loc = {};
let acmePhone;
let acmeBuilding;

/** YYYY-MM-DD, `days` from 20 days ago (so every date stays in the past). */
const day = (days = 0) => new Date(Date.now() - (20 - days) * 864e5).toISOString().slice(0, 10);

async function publish(agent, type, { title, description = '', building = 'Nicol Hall', date = day(), categoryId = R.phone, locationId }) {
  const req = agent.post(`/api/posts/${type}`);
  const fields = { title, description, categoryId, locationId: locationId || loc[building], date };
  if (type === 'found') Object.assign(fields, { whereabouts: 'FINDER', verificationQuestion: 'Colour?', verificationAnswer: 'Black' });
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  const id = (await req.expect(201)).body.id;
  await events.settle(); // Smart Match runs right after publication (FR-2.9)
  return id;
}
const lost = (agent, o) => publish(agent, 'lost', o);
const found = (agent, o) => publish(agent, 'found', o);
const pair = async (lostId, foundId) =>
  (await query('SELECT * FROM matches WHERE lost_post_id = $1 AND found_post_id = $2', [lostId, foundId])).rows[0];
const matchNotes = async (userId) => (await query(`SELECT * FROM notifications WHERE user_id = $1 AND type = 'MATCH'`, [userId])).rows;
const matchesOf = async (agent, postId) => (await agent.get(`/api/posts/${postId}/matches`).expect(200)).body.matches;
const restore = () => query(
  `UPDATE organizations SET match_threshold = 60, possible_threshold = 40, match_weights = $2 WHERE organization_id = $1`,
  [R.lau, W],
);

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea, john, maya] = await Promise.all(
    ['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'john@acme.com', 'maya.azar@lau.edu'].map(signIn),
  );
  for (const r of (await query('SELECT user_id, email FROM users')).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
  for (const r of (await query('SELECT location_id, building FROM locations')).rows) loc[r.building] = r.location_id;
  acmePhone = (await query(`SELECT category_id FROM categories c JOIN organizations o USING (organization_id) WHERE o.name = 'Acme Corp' AND c.name = 'Phone'`)).rows[0].category_id;
  acmeBuilding = loc['Main Building'];
});
beforeEach(async () => {
  await events.settle();
  await query(`UPDATE posts SET status = 'CLOSED' WHERE status = 'OPEN'`); // every test starts without open posts
  await query(`DELETE FROM notifications WHERE type = 'MATCH'`);
  await restore();
});
afterAll(async () => {
  await events.settle();
  await restore();
  await pool.end();
});

describe('TS-FR-5 Smart Match', () => {
  test('TC-FR-5.1-V compared with open opposite-type posts on the same campus', async () => {
    const beirut = await found(omar, { title: 'Black iPhone 14' });
    const lostId = await lost(sara, { title: 'Black iPhone 14' });
    const compared = (await runFor(lostId)).map((c) => c.postId);
    expect(compared).toContain(beirut);
  });

  test('TC-FR-5.1-D other campus, organization, type, or status never compared', async () => {
    const beirut = await found(omar, { title: 'Black iPhone 14' });
    const byblos = await found(omar, { title: 'Black iPhone 14', building: 'Bassil Hall' });
    const acme = await found(john, { title: 'Black iPhone 14', categoryId: acmePhone, locationId: acmeBuilding });
    const closed = await found(omar, { title: 'Black iPhone 14' });
    await omar.post(`/api/posts/${closed}/close`).expect(200);
    const otherLost = await lost(lea, { title: 'Black iPhone 14' });
    const lostId = await lost(sara, { title: 'Black iPhone 14' });
    const compared = (await runFor(lostId)).map((c) => c.postId);
    expect(compared).toEqual([beirut]);
    for (const id of [byblos, acme, closed, otherLost]) expect(compared).not.toContain(id);
  });

  test('TC-FR-5.2-V scores computed as in Table 12', () => {
    const lostPost = { category_id: 1, campus_id: 1, location_id: 10, event_datetime: '2026-10-01T09:00', title: 'black iPhone 14 cracked screen', description: '' };
    const same = { ...lostPost, event_datetime: '2026-10-01T15:00' };
    expect(score(lostPost, same, W)).toBe(100); // 35 + 25 + 20 + 20
    const irwin = { ...lostPost, location_id: 11, event_datetime: '2026-10-04T12:00', title: 'black iPhone cracked case' };
    expect(similarity(lostPost, irwin)).toBe(0.5);
    expect(score(lostPost, irwin, W)).toBe(67); // 35 + 10 + 12 + 10
  });

  test('TC-FR-5.2-D excluded pairs scored 0', () => {
    const lostPost = { category_id: 1, campus_id: 1, location_id: 10, event_datetime: '2026-10-01T09:00', title: 'black iPhone 14 cracked screen' };
    expect(score(lostPost, { ...lostPost, category_id: 2 }, W)).toBe(0); // wallet
    expect(score(lostPost, { ...lostPost, event_datetime: '2026-09-29T12:00' }, W)).toBe(0); // found two days before the loss
    expect(score(lostPost, { ...lostPost, event_datetime: '2026-09-30T12:00' }, W)).toBeGreaterThan(0); // one day before is compared
  });

  test('TC-FR-5.3-V pairs scoring 60 or more recorded', async () => {
    // 35 (category) + 10 (other building) + 12 (two days apart) + keywords 3 or 4
    const l60 = await lost(sara, { title: 'zebra yellow phone case' });
    const f60 = await found(omar, { title: 'zebra purple tablet cover', building: 'Irwin Hall', date: day(2) });
    expect((await pair(l60, f60)).score).toBe(60);
    expect(await matchNotes(uid.sara)).toHaveLength(1);
    await query(`UPDATE posts SET status = 'CLOSED' WHERE post_id IN ($1, $2)`, [l60, f60]);
    const l61 = await lost(sara, { title: 'zebra yellow phone' });
    const f61 = await found(omar, { title: 'zebra purple tablet', building: 'Irwin Hall', date: day(2) });
    expect((await pair(l61, f61)).score).toBe(61);
    expect(await matchNotes(uid.sara)).toHaveLength(2);
  });

  test('TC-FR-5.3-D pair scoring 59 not recorded', async () => {
    const l = await lost(sara, { title: 'zebra yellow phone case strap' });
    const f = await found(omar, { title: 'zebra purple tablet cover charger cable', building: 'Irwin Hall', date: day(2) });
    const m = await pair(l, f);
    expect(m.score).toBe(59);
    expect(m.notified_at).toBeNull();
    expect(await matchNotes(uid.sara)).toHaveLength(0);
    expect((await matchesOf(sara, l))[0].isMatch).toBe(false); // a possible match only
  });

  test('TC-FR-5.4-V owner notified of a recorded match', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    const f = await found(omar, { title: 'zebra purple tablet' }); // 35 + 25 + 20 + 5
    expect((await pair(l, f)).score).toBe(85);
    const notes = await matchNotes(uid.sara);
    expect(notes).toHaveLength(1);
    expect(notes[0].link).toBe(`/posts/${l}`);
  });

  test('TC-FR-5.4-D no notification below the threshold or to others', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    const f = await found(omar, { title: 'walrus purple', building: 'Irwin Hall', date: day(5) }); // 35 + 10 + 5 + 0
    expect((await pair(l, f)).score).toBe(50);
    expect(await matchNotes(uid.sara)).toHaveLength(0);
    expect(await matchNotes(uid.lea)).toHaveLength(0);
  });

  test('TC-FR-5.5-V possible matches by decreasing score', async () => {
    const l = await lost(sara, { title: 'Black iPhone 14' });
    const ids = [];
    for (const s of [39, 40, 72, 90]) {
      const f = await found(omar, { title: `Phone ${s}` });
      // The default weights cannot produce scores under 45, so the four scores of the test case are set directly
      await query('UPDATE matches SET score = $3 WHERE lost_post_id = $1 AND found_post_id = $2', [l, f, s]);
      if (!(await pair(l, f))) await query('INSERT INTO matches (organization_id, lost_post_id, found_post_id, score) VALUES ($1, $2, $3, $4)', [R.lau, l, f, s]);
      ids.push(f);
    }
    expect((await matchesOf(sara, l)).map((m) => m.score)).toEqual([90, 72, 40]);
  });

  test('TC-FR-5.5-D low scores and other users\' matches hidden', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    const f = await found(omar, { title: 'zebra purple tablet' });
    await query('UPDATE matches SET score = 39 WHERE lost_post_id = $1 AND found_post_id = $2', [l, f]);
    expect(await matchesOf(sara, l)).toHaveLength(0);
    await lea.get(`/api/posts/${l}/matches`).expect(403);
  });

  test('TC-FR-5.6-V owner dismisses a suggestion', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    await found(omar, { title: 'zebra purple tablet' });
    const [m] = await matchesOf(sara, l);
    await sara.post(`/api/matches/${m.id}/dismiss`).expect(200);
    expect(await matchesOf(sara, l)).toHaveLength(0); // also after reloading
  });

  test('TC-FR-5.6-D non-owner cannot dismiss', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    await found(omar, { title: 'zebra purple tablet' });
    const [m] = await matchesOf(sara, l);
    await lea.post(`/api/matches/${m.id}/dismiss`).expect(403);
    expect(await matchesOf(sara, l)).toHaveLength(1);
  });

  test('TC-FR-5.7-V other suggestions still appear', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    await found(omar, { title: 'zebra purple tablet' });
    const [m] = await matchesOf(sara, l);
    await sara.post(`/api/matches/${m.id}/dismiss`).expect(200);
    const second = await found(omar, { title: 'walrus green', date: day(2) }); // 35 + 25 + 12 + 0 = 72
    expect((await matchesOf(sara, l)).map((x) => x.postId)).toEqual([second]);
  });

  test('TC-FR-5.7-D dismissed pair never suggested again', async () => {
    const l = await lost(sara, { title: 'zebra yellow' });
    const f = await found(omar, { title: 'zebra purple tablet' });
    const [m] = await matchesOf(sara, l);
    await sara.post(`/api/matches/${m.id}/dismiss`).expect(200);
    await omar.patch(`/api/posts/${f}`).send({ description: 'zebra yellow sticker on the back' }).expect(200);
    await events.settle();
    expect(await matchesOf(sara, l)).toHaveLength(0);
    expect((await pair(l, f)).status).toBe('DISMISSED');
  });

  test('TC-FR-5.8-V administrator changes the threshold', async () => {
    const current = (await maya.get('/api/admin/matching').expect(200)).body;
    await maya.put('/api/admin/matching').send({ ...current, matchThreshold: 70 }).expect(200);
    const l = await lost(sara, { title: 'zebra yellow' });
    await found(omar, { title: 'walrus purple', building: 'Irwin Hall' }); // 35 + 10 + 20 + 0 = 65
    expect(await matchNotes(uid.sara)).toHaveLength(0);
    const [m] = await matchesOf(sara, l);
    expect(m.score).toBe(65);
    expect(m.isMatch).toBe(false);
  });

  test('TC-FR-5.8-D invalid threshold or non-administrator refused', async () => {
    const current = (await maya.get('/api/admin/matching').expect(200)).body;
    const res = await maya.put('/api/admin/matching').send({ ...current, matchThreshold: 120 }).expect(400);
    expect(res.body.fields.matchThreshold).toMatch(/0 to 100/);
    await sara.get('/api/admin/matching').expect(403);
    await sara.put('/api/admin/matching').send(current).expect(403);
  });

  test('TC-FR-5.9-V administrator changes a weight', async () => {
    const current = (await maya.get('/api/admin/matching').expect(200)).body;
    await maya.put('/api/admin/matching').send({ ...current, weights: { ...current.weights, building: 15 } }).expect(200);
    const l = await lost(sara, { title: 'zebra yellow' });
    const f = await found(omar, { title: 'walrus purple' });
    expect((await pair(l, f)).score).toBe(70); // 35 + 15 + 20 + 0
  });

  test('TC-FR-5.9-D invalid weights refused', async () => {
    const current = (await maya.get('/api/admin/matching').expect(200)).body;
    const negative = await maya.put('/api/admin/matching').send({ ...current, weights: { ...current.weights, building: -5 } }).expect(400);
    expect(negative.body.fields['weights.building']).toMatch(/negative/);
    const over = await maya.put('/api/admin/matching').send({ ...current, weights: { ...current.weights, category: 80 } }).expect(400);
    expect(over.body.fields.weights).toMatch(/at most 100/);
  });
});
