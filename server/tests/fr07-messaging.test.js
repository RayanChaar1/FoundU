/* TS-FR-7 Private Messaging. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');

let R;
let sara;
let omar;
let lea;
let karim;
let maya;

async function found(agent) {
  const req = agent.post('/api/posts/found');
  const fields = { title: 'Black iPhone 14', categoryId: R.phone, locationId: R.library, date: today(), whereabouts: 'FINDER',
    verificationQuestion: 'What is the sticker on it?', verificationAnswer: 'A blue LAU sticker' };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
}
/** Sara's claim on a new post by `finder`, approved; returns the claim id (= conversation id) and Sara's code. */
async function conversationWith(finder = omar) {
  const postId = await found(finder);
  const claim = (await sara.post(`/api/posts/${postId}/claims`).send({ answer: 'Blue sticker' }).expect(201)).body.claim;
  await finder.post(`/api/claims/${claim.id}/approve`).expect(200);
  const code = (await sara.get(`/api/claims/${claim.id}`)).body.claim.handoverCode;
  return { id: claim.id, postId, code };
}
const say = (agent, id, body) => agent.post(`/api/conversations/${id}/messages`).send({ body });

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea, karim, maya] = await Promise.all(
    ['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'k.saad@lau.edu', 'maya.azar@lau.edu'].map(signIn),
  );
});
afterAll(async () => {
  await events.settle();
  await pool.end();
});

describe('TS-FR-7 Private Messaging', () => {
  test('TC-FR-7.1-V one conversation per approved claim', async () => {
    const a = await conversationWith(omar);
    const b = await conversationWith(karim);
    const ids = (await sara.get('/api/conversations').expect(200)).body.conversations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  test('TC-FR-7.1-D no duplicate conversation', async () => {
    const { id } = await conversationWith();
    await omar.post(`/api/claims/${id}/approve`).expect(409);
    const ids = (await sara.get('/api/conversations')).body.conversations.map((c) => c.id);
    expect(ids.filter((x) => x === id)).toHaveLength(1);
  });

  test('TC-FR-7.2-V participants and investigating administrator can read', async () => {
    const { id } = await conversationWith();
    const msg = (await say(omar, id, 'Rude message').expect(201)).body.message;
    await sara.get(`/api/conversations/${id}`).expect(200);
    await omar.get(`/api/conversations/${id}`).expect(200);
    await sara.post(`/api/messages/${msg.id}/report`).send({ reason: 'INAPPROPRIATE' }).expect(201);
    const seen = await maya.get(`/api/conversations/${id}`).expect(200);
    expect(seen.body.conversation.messages.map((m) => m.body)).toContain('Rude message');
    const log = await query(`SELECT 1 FROM audit_log WHERE action = 'CONVERSATION_READ' AND target_id = $1`, [id]);
    expect(log.rowCount).toBe(1); // the access is logged
  });

  test('TC-FR-7.2-D other users cannot read', async () => {
    const { id } = await conversationWith();
    await lea.get(`/api/conversations/${id}`).expect(403);
    await maya.get(`/api/conversations/${id}`).expect(403); // no report to investigate
  });

  test('TC-FR-7.3-V message up to 1,000 characters sent', async () => {
    const { id } = await conversationWith();
    const res = await say(sara, id, 'x'.repeat(1000)).expect(201);
    expect(res.body.message.body).toHaveLength(1000);
    // FR-8.1: the other participant is notified of the message
    const notes = await query(`SELECT n.* FROM notifications n JOIN users u USING (user_id) WHERE u.email = 'omar.h@lau.edu' AND n.type = 'MESSAGE' AND n.claim_id = $1`, [id]);
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].link).toBe(`/conversations/${id}`);
  });

  test('TC-FR-7.3-D over-long or empty message refused', async () => {
    const { id } = await conversationWith();
    const long = await say(sara, id, 'x'.repeat(1001)).expect(400);
    expect(long.body.fields.body).toMatch(/1,000/);
    await say(sara, id, '   ').expect(400);
  });

  test('TC-FR-7.4-V messages displayed on the next poll', async () => {
    const { id } = await conversationWith();
    const first = (await omar.get(`/api/conversations/${id}`)).body.conversation.messages;
    const last = first.length ? first[first.length - 1].id : 0;
    for (let i = 1; i <= 10; i += 1) await say(sara, id, `Test ${i}`).expect(201);
    const polled = (await omar.get(`/api/conversations/${id}`).query({ after: last })).body.conversation.messages;
    expect(polled.map((m) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `Test ${i + 1}`));
  });

  test('TC-FR-7.4-D message sent while offline delivered on reconnection', async () => {
    const { id } = await conversationWith();
    await say(sara, id, 'Before').expect(201);
    const seen = (await omar.get(`/api/conversations/${id}`)).body.conversation.messages;
    const last = seen[seen.length - 1].id;
    await say(sara, id, 'While you were offline').expect(201); // Omar is not polling
    const after = (await omar.get(`/api/conversations/${id}`).query({ after: last })).body.conversation.messages;
    expect(after.map((m) => m.body)).toEqual(['While you were offline']);
  });

  test('TC-FR-7.5-V display names and badges shown', async () => {
    const { id } = await conversationWith();
    const { participants } = (await sara.get(`/api/conversations/${id}`)).body.conversation;
    expect(participants.map((p) => p.displayName)).toEqual(['Sara K.', 'Omar H.']);
    for (const p of participants) expect(Array.isArray(p.badges)).toBe(true);
  });

  test('TC-FR-7.5-D no contact details exposed', async () => {
    const { id } = await conversationWith();
    await say(omar, id, 'Hello').expect(201);
    const raw = JSON.stringify((await sara.get(`/api/conversations/${id}`)).body) + JSON.stringify((await sara.get('/api/conversations')).body);
    expect(raw).not.toMatch(/@/); // no email address
    expect(raw).not.toMatch(/"(email|phone)\w*"\s*:/i); // no contact fields
  });

  test('TC-FR-7.6-V messaging allowed while the post is Claimed', async () => {
    const { id } = await conversationWith();
    await say(sara, id, 'When can we meet?').expect(201);
  });

  test('TC-FR-7.6-D messaging refused after Returned; history stays readable', async () => {
    const { id, code } = await conversationWith();
    await say(sara, id, 'See you at noon').expect(201);
    await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(200);
    await say(sara, id, 'Thank you!').expect(409);
    const conv = (await sara.get(`/api/conversations/${id}`).expect(200)).body.conversation;
    expect(conv.readOnly).toBe(true);
    expect(conv.messages.map((m) => m.body)).toContain('See you at noon');
  });

  test('TC-FR-7.7-V participant reports a message', async () => {
    const { id } = await conversationWith();
    const msg = (await say(omar, id, 'Inappropriate content').expect(201)).body.message;
    await sara.post(`/api/messages/${msg.id}/report`).send({ reason: 'INAPPROPRIATE' }).expect(201);
    const queue = await query(`SELECT * FROM reports WHERE message_id = $1 AND status = 'OPEN'`, [msg.id]);
    expect(queue.rows).toHaveLength(1); // in the moderation queue of the organization (FR-15.4)
    expect(queue.rows[0].organization_id).toBe(R.lau);
  });

  test('TC-FR-7.7-D non-participant cannot report', async () => {
    const { id } = await conversationWith();
    const msg = (await say(omar, id, 'Hello').expect(201)).body.message;
    await lea.post(`/api/messages/${msg.id}/report`).send({ reason: 'SPAM' }).expect(403);
  });
});
