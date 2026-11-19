/* TS-FR-15 Reporting and moderation. */
const { signIn, app, request } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');
const { REMOVED_MESSAGE } = require('../src/modules/moderation/service');

let R;
let sara;
let omar;
let lea;
let karim;
let maya;
let nour;
const uid = {};

const found = async (agent = omar, title = 'Black iPhone 14') => {
  const req = agent.post('/api/posts/found');
  const fields = {
    title, categoryId: R.phone, locationId: R.library, date: today(),
    whereabouts: 'FINDER', verificationQuestion: 'Sticker?', verificationAnswer: 'Blue',
  };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
};
/** A message from Omar in the conversation of Sara's approved claim on his post (FR-7.1). */
async function messageFromOmar() {
  const postId = await found();
  const claimId = (await sara.post(`/api/posts/${postId}/claims`).send({ answer: 'Blue' }).expect(201)).body.claim.id;
  await omar.post(`/api/claims/${claimId}/approve`).expect(200);
  const { rows } = await query('INSERT INTO messages (claim_id, sender_id, body) VALUES ($1, $2, $3) RETURNING message_id',
    [claimId, uid.omar, 'Send me 50 dollars first']);
  return rows[0].message_id;
}
const report = (agent, body) => agent.post('/api/reports').send(body);
const reportId = async (agent, body) => (await report(agent, body).expect(201)).body.id;
const act = (agent, id, body) => agent.post(`/api/moderation/reports/${id}`).send(body);
const row = async (sql, params) => (await query(sql, params)).rows[0];
const notes = async (userId) =>
  (await query(`SELECT content FROM notifications WHERE user_id = $1 AND type = 'MODERATION' ORDER BY notification_id`, [userId])).rows.map((r) => r.content);

beforeAll(async () => {
  R = await ref();
  await query(
    `INSERT INTO users (organization_id, email, full_name, display_name, campus_id) VALUES ($1, 'nour.t@lau.edu', 'Nour Tabet', 'Nour T.', $2)`,
    [R.lau, R.beirut],
  );
  [sara, omar, lea, karim, maya, nour] = await Promise.all(
    ['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'k.saad@lau.edu', 'maya.azar@lau.edu', 'nour.t@lau.edu'].map(signIn),
  );
  for (const r of (await query('SELECT user_id, email FROM users')).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
});
afterAll(async () => {
  await events.settle();
  await query(`DELETE FROM users WHERE email = 'nour.t@lau.edu'`);
  await pool.end();
});

describe('TS-FR-15 Reporting and moderation', () => {
  test('TC-FR-15.1-V post and message reported', async () => {
    const postId = await found();
    const messageId = await messageFromOmar();
    const a = await reportId(sara, { postId, reason: 'SPAM' });
    const b = await reportId(sara, { messageId, reason: 'INAPPROPRIATE' });
    expect(await row('SELECT post_id, reason FROM reports WHERE report_id = $1', [a])).toEqual({ post_id: postId, reason: 'SPAM' });
    expect(await row('SELECT message_id, reason FROM reports WHERE report_id = $1', [b])).toEqual({ message_id: messageId, reason: 'INAPPROPRIATE' });
  });

  test('TC-FR-15.1-D anonymous or self reports refused', async () => {
    const postId = await found();
    await request(app).post('/api/reports').send({ postId, reason: 'SPAM' }).expect(401);
    expect((await report(omar, { postId, reason: 'SPAM' }).expect(403)).body.error).toBe('You cannot report your own post.');
  });

  test('TC-FR-15.2-V reason chosen from the list', async () => {
    const id = await reportId(sara, { postId: await found(), reason: 'PERSONAL_DATA', details: 'The photo shows a student ID number' });
    expect(await row('SELECT reason, status FROM reports WHERE report_id = $1', [id])).toEqual({ reason: 'PERSONAL_DATA', status: 'OPEN' });
  });

  test('TC-FR-15.2-D missing or unknown reason refused', async () => {
    const postId = await found();
    expect((await report(sara, { postId }).expect(400)).body.fields.reason).toBe('Choose a reason from the list.');
    await report(sara, { postId, reason: 'boring' }).expect(400);
  });

  test('TC-FR-15.3-V post hidden after three different reporters', async () => {
    const postId = await found();
    await reportId(sara, { postId, reason: 'SPAM' });
    await reportId(lea, { postId, reason: 'FRAUD' });
    expect((await report(nour, { postId, reason: 'SPAM' }).expect(201)).body.hidden).toBe(true);
    expect((await row('SELECT is_hidden FROM posts WHERE post_id = $1', [postId])).is_hidden).toBe(true);
    await sara.get(`/api/posts/${postId}`).expect(404); // hidden until reviewed
    await karim.get(`/api/posts/${postId}`).expect(200); // moderators still see it
    expect((await notes(uid.omar)).at(-1)).toMatch(/hidden because several users reported it/);
  });

  test('TC-FR-15.3-D repeated reports by one user do not hide', async () => {
    const postId = await found();
    await reportId(sara, { postId, reason: 'SPAM' });
    expect((await report(sara, { postId, reason: 'SPAM' }).expect(409)).body.error).toBe('You already reported this post.');
    await report(sara, { postId, reason: 'FRAUD' }).expect(409);
    expect(await row('SELECT count(*)::int AS n FROM reports WHERE post_id = $1', [postId])).toEqual({ n: 1 });
    await lea.get(`/api/posts/${postId}`).expect(200);
  });

  test('TC-FR-15.4-V moderators see the queue', async () => {
    const a = await reportId(sara, { postId: await found(), reason: 'SPAM' });
    const b = await reportId(lea, { postId: await found(), reason: 'OTHER' });
    const ids = (await karim.get('/api/moderation/reports').expect(200)).body.reports.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
  });

  test('TC-FR-15.4-D registered users cannot see the queue', async () => {
    await sara.get('/api/moderation/reports').expect(403);
  });

  test('TC-FR-15.5-V each moderator action takes effect', async () => {
    const posts = [await found(), await found(), await found(), await found()];
    const [dismiss, hide, remove, warn] = await Promise.all(posts.map((postId) => reportId(sara, { postId, reason: 'SPAM' })));
    await act(karim, dismiss, { action: 'DISMISS', reason: '' }).expect(200);
    await act(karim, hide, { action: 'HIDE', reason: 'Misleading photo' }).expect(200);
    await act(karim, remove, { action: 'REMOVE', reason: 'Advertisement' }).expect(200);
    await act(karim, warn, { action: 'WARN', reason: 'Keep descriptions factual' }).expect(200);
    expect(await row('SELECT status, action FROM reports WHERE report_id = $1', [dismiss])).toEqual({ status: 'DISMISSED', action: 'DISMISS' });
    expect((await row('SELECT is_hidden FROM posts WHERE post_id = $1', [posts[1]])).is_hidden).toBe(true);
    expect((await row('SELECT status FROM posts WHERE post_id = $1', [posts[2]])).status).toBe('REMOVED');
    expect((await notes(uid.omar)).at(-1)).toMatch(/warned you about your post .*Keep descriptions factual/);
    const messageId = await messageFromOmar();
    await act(karim, await reportId(sara, { messageId, reason: 'FRAUD' }), { action: 'REMOVE', reason: 'Asked for money' }).expect(200);
    expect((await row('SELECT body FROM messages WHERE message_id = $1', [messageId])).body).toBe(REMOVED_MESSAGE);
  });

  test('TC-FR-15.5-D invalid actions refused', async () => {
    const id = await reportId(sara, { postId: await found(), reason: 'SPAM' });
    expect((await act(karim, id, { action: 'ban_forever', reason: 'x' }).expect(400)).body.fields.action).toMatch(/dismiss, hide, remove, or warn/);
    await act(karim, id, { action: 'DISMISS', reason: '' }).expect(200);
    expect((await act(karim, id, { action: 'HIDE', reason: 'Again' }).expect(409)).body.error).toBe('This report was already handled.');
  });

  test('TC-FR-15.6-V author told the action and reason', async () => {
    const postId = await found(omar, 'Free iPhones, DM me');
    await act(karim, await reportId(sara, { postId, reason: 'FRAUD' }), { action: 'REMOVE', reason: 'Fraudulent post', fraud: true }).expect(200);
    expect((await notes(uid.omar)).at(-1)).toBe(
      'A moderator took action on your post "Free iPhones, DM me": it was removed.  Reason: Fraudulent post',
    );
  });

  test('TC-FR-15.6-D removal without a reason refused', async () => {
    const postId = await found();
    const id = await reportId(sara, { postId, reason: 'FRAUD' });
    expect((await act(karim, id, { action: 'REMOVE', reason: '  ' }).expect(400)).body.fields.reason).toBe('Give the reason for this action.');
    expect((await row('SELECT status FROM posts WHERE post_id = $1', [postId])).status).toBe('OPEN');
  });

  test('TC-FR-15.7-V actions logged with author, time, reason', async () => {
    const a = await reportId(sara, { postId: await found(), reason: 'SPAM' });
    const b = await reportId(sara, { postId: await found(), reason: 'SPAM' });
    await act(karim, a, { action: 'HIDE', reason: 'Audit one' }).expect(200);
    await act(karim, b, { action: 'WARN', reason: 'Audit two' }).expect(200);
    const { entries } = (await maya.get('/api/audit').expect(200)).body;
    for (const reason of ['Audit one', 'Audit two']) {
      expect(entries).toContainEqual(expect.objectContaining({ reason, actor: 'Karim S.', createdAt: expect.any(String) }));
    }
  });

  test('TC-FR-15.7-D audit log cannot be altered', async () => {
    const { entries } = (await maya.get('/api/audit').expect(200)).body;
    const [first] = entries;
    await maya.delete(`/api/audit/${first.id}`).expect(405);
    await maya.patch(`/api/audit/${first.id}`).send({ reason: 'changed' }).expect(405);
    await karim.delete(`/api/audit/${first.id}`).expect(403);
    expect(await row('SELECT reason FROM audit_log WHERE audit_id = $1', [first.id])).toEqual({ reason: first.reason });
  });
});
