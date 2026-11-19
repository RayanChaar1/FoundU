/* TS-FR-10 My Posts and Profile. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');

let R;
let sara;
let omar;
let lea;
const uid = {};

async function post(agent, type, title) {
  const req = agent.post(`/api/posts/${type}`);
  const fields = { title, categoryId: R.wallet, locationId: R.bassil, date: today() };
  if (type === 'found') Object.assign(fields, { whereabouts: 'FINDER', verificationQuestion: 'Colour?', verificationAnswer: 'Brown' });
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
}
/** A found post by Sara whose claim by Omar was approved and handed over (an approved claim, post Returned). */
async function returnedPost() {
  const id = await post(sara, 'found', 'Brown wallet B');
  const claim = (await omar.post(`/api/posts/${id}/claims`).send({ answer: 'Brown' }).expect(201)).body.claim;
  await sara.post(`/api/claims/${claim.id}/approve`).expect(200);
  const code = (await omar.get(`/api/claims/${claim.id}`)).body.claim.handoverCode;
  await sara.post(`/api/claims/${claim.id}/handover`).send({ code }).expect(200);
  return id;
}

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu'].map(signIn));
  for (const r of (await query('SELECT user_id, email FROM users')).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
});
afterAll(async () => {
  await events.settle();
  await pool.end();
});

describe('TS-FR-10 My Posts and Profile', () => {
  test('TC-FR-10.1-V dashboard lists activity with statuses', async () => {
    const a = await post(sara, 'lost', 'Activity lost wallet');
    const b = await post(sara, 'found', 'Activity found wallet');
    const omarPost = await post(omar, 'found', 'Activity Omar wallet');
    const claim = (await sara.post(`/api/posts/${omarPost}/claims`).send({ answer: 'Brown' }).expect(201)).body.claim;
    await omar.post(`/api/claims/${claim.id}/approve`).expect(200); // opens a conversation
    const { posts, claims, conversations } = (await sara.get('/api/me/activity').expect(200)).body;
    expect(posts.filter((p) => [a, b].includes(p.id)).map((p) => p.status)).toEqual(['OPEN', 'OPEN']);
    expect(claims.find((c) => c.id === claim.id).status).toBe('APPROVED');
    const conv = conversations.find((c) => c.id === claim.id);
    expect(conv.otherName).toBe('Omar H.');
    expect(conv.open).toBe(true);
  });

  test('TC-FR-10.1-D dashboard shows only the user\'s own activity', async () => {
    await post(sara, 'lost', 'Only Sara wallet');
    const { posts, claims, conversations } = (await lea.get('/api/me/activity').expect(200)).body;
    expect(posts.map((p) => p.title)).not.toContain('Only Sara wallet');
    const sarasClaims = (await query('SELECT claim_id FROM claims WHERE claimant_id = $1', [uid.sara])).rows.map((r) => r.claim_id);
    for (const c of [...claims, ...conversations]) expect(sarasClaims).not.toContain(c.id);
  });

  test('TC-FR-10.2-V owner edits an open post', async () => {
    const id = await post(sara, 'lost', 'Black iPhone 14');
    const res = await sara.patch(`/api/posts/${id}`).send({ title: 'Black iPhone 14 Pro', description: 'Blue case' }).expect(200);
    expect(res.body.title || (await sara.get(`/api/posts/${id}`)).body.post.title).toBe('Black iPhone 14 Pro');
  });

  test('TC-FR-10.2-D type change, other users\' posts, and closed posts refused', async () => {
    const id = await post(sara, 'lost', 'Edit refusals');
    await sara.patch(`/api/posts/${id}`).send({ type: 'FOUND' }).expect(400);
    const omarPost = await post(omar, 'lost', 'Omar post');
    await sara.patch(`/api/posts/${omarPost}`).send({ title: 'Mine now' }).expect(403);
    await sara.post(`/api/posts/${id}/close`).expect(200);
    await sara.patch(`/api/posts/${id}`).send({ title: 'After closing' }).expect(409);
  });

  test('TC-FR-10.3-V edits listed in the history', async () => {
    const id = await post(sara, 'lost', 'History wallet');
    await sara.patch(`/api/posts/${id}`).send({ title: 'History wallet 2' }).expect(200);
    await sara.patch(`/api/posts/${id}`).send({ description: 'Brown leather' }).expect(200);
    const body = (await sara.get(`/api/posts/${id}/history`).expect(200)).body;
    const history = body.history || body;
    expect(history).toHaveLength(2);
    const changes = history.map((h) => h.changes);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: { from: 'History wallet', to: 'History wallet 2' } }),
      expect.objectContaining({ description: { from: '', to: 'Brown leather' } }),
    ]));
    for (const h of history) expect(h.editedAt || h.edited_at).toBeTruthy();
  });

  test('TC-FR-10.3-D history cannot be altered', async () => {
    const id = await post(sara, 'lost', 'Locked history');
    await sara.patch(`/api/posts/${id}`).send({ title: 'Locked history 2' }).expect(200);
    const res = await sara.delete(`/api/posts/${id}/history/1`);
    expect([403, 405]).toContain(res.status);
    await sara.delete(`/api/posts/${id}/history`).expect(405);
    const body = (await sara.get(`/api/posts/${id}/history`)).body;
    expect(body.history || body).toHaveLength(1);
  });

  test('TC-FR-10.4-V post without an approved claim deleted', async () => {
    const id = await post(sara, 'found', 'Brown wallet A');
    await sara.delete(`/api/posts/${id}`).expect(204);
    expect((await query('SELECT 1 FROM posts WHERE post_id = $1', [id])).rowCount).toBe(0);
  });

  test('TC-FR-10.4-D post with an approved claim not deleted', async () => {
    const id = await returnedPost();
    const res = await sara.delete(`/api/posts/${id}`).expect(409);
    expect(res.body.error).toMatch(/approved claim.*Close it instead/);
  });

  test('TC-FR-10.5-V post with an approved claim closed', async () => {
    const id = await returnedPost();
    await sara.post(`/api/posts/${id}/close`).expect(200);
    expect((await query('SELECT status FROM posts WHERE post_id = $1', [id])).rows[0].status).toBe('CLOSED');
  });

  test('TC-FR-10.5-D close not offered to other users', async () => {
    const id = await returnedPost();
    await lea.post(`/api/posts/${id}/close`).expect(403);
  });

  test('TC-FR-10.6-V profile shows name, campus, points, badges', async () => {
    await query('UPDATE users SET karma_points = 15 WHERE user_id = $1', [uid.omar]);
    await query(`INSERT INTO user_badges (user_id, badge_id) SELECT $1, badge_id FROM badges WHERE code = 'FIRST_FIND' ON CONFLICT DO NOTHING`, [uid.omar]);
    try {
      const { profile } = (await sara.get(`/api/users/${uid.omar}`).expect(200)).body;
      expect(profile.displayName).toBe('Omar H.');
      expect(profile.campus).toBeTruthy();
      expect(profile.karmaPoints).toBe(15);
      expect(profile.badges.map((b) => b.name)).toContain('First Find');
    } finally {
      // other test files expect Omar without points or badges
      await query('UPDATE users SET karma_points = 0 WHERE user_id = $1', [uid.omar]);
      await query('DELETE FROM user_badges WHERE user_id = $1', [uid.omar]);
    }
  });

  test('TC-FR-10.6-D hidden or suspended profiles handled', async () => {
    const { rows } = await query(
      `INSERT INTO users (organization_id, email, full_name, display_name, role, status)
       VALUES ($1, 'gone@lau.edu', 'Gone User', 'Gone U.', 'USER', 'DELETED') RETURNING user_id`,
      [R.lau],
    );
    const res = await sara.get(`/api/users/${rows[0].user_id}`).expect(404);
    expect(res.body.error).toBe('Profile not available.');
    const acme = (await query(`SELECT user_id FROM users WHERE email = 'john@acme.com'`)).rows[0].user_id;
    await sara.get(`/api/users/${acme}`).expect(404); // another organization (FR-18.4)
  });

  test('TC-FR-10.7-V profile shows public information only', async () => {
    const { profile } = (await sara.get(`/api/users/${uid.omar}`).expect(200)).body;
    expect(Object.keys(profile).sort()).toEqual(['badges', 'campus', 'displayName', 'id', 'isMe', 'itemsReturned', 'karmaPoints', 'memberSince']);
  });

  test('TC-FR-10.7-D email address never exposed', async () => {
    const res = await sara.get(`/api/users/${uid.omar}`).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/omar\.h@lau\.edu|@/);
  });
});
