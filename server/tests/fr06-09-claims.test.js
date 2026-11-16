/* TS-FR-6 Claims and Ownership Verification, TS-FR-9 Item Status and Handover. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const { canTransition } = require('../src/lib/postStatus');
const { closeReturnedPosts } = require('../src/modules/claims/service');
const { sendPendingEmails } = require('../src/modules/notifications/service');
const { sent } = require('../src/lib/mailer');

let R;
let sara;
let omar;
let lea;
let karim;
const uid = {};

const found = async (agent, extra = {}) => {
  const req = agent.post('/api/posts/found');
  const fields = {
    title: 'Black iPhone 14', categoryId: R.phone, locationId: R.library, date: today(),
    whereabouts: 'FINDER', verificationQuestion: 'What is the sticker on it?', verificationAnswer: 'A blue LAU sticker', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  return (await req.expect(201)).body.id;
};
const lost = async (agent) => {
  const req = agent.post('/api/posts/lost');
  for (const [k, v] of Object.entries({ title: 'Black iPhone', categoryId: R.phone, locationId: R.nicol, date: today() })) req.field(k, String(v));
  return (await req.expect(201)).body.id;
};
const claim = (agent, postId, body = { answer: 'Blue sticker' }) => agent.post(`/api/posts/${postId}/claims`).send(body);
const claimId = async (agent, postId, body) => (await claim(agent, postId, body).expect(201)).body.claim.id;
const postStatus = async (id) => (await query('SELECT status FROM posts WHERE post_id = $1', [id])).rows[0].status;
const notes = async (userId, type, claimIdValue) =>
  (await query('SELECT * FROM notifications WHERE user_id = $1 AND type = $2 AND ($3::int IS NULL OR claim_id = $3)', [userId, type, claimIdValue ?? null])).rows;
/** An approved claim by Sara on a new post by Omar; returns the ids and Sara's handover code. */
async function approved(extra) {
  const postId = await found(omar, extra);
  const id = await claimId(sara, postId);
  await omar.post(`/api/claims/${id}/approve`).expect(200);
  const code = (await sara.get(`/api/claims/${id}`).expect(200)).body.claim.handoverCode;
  return { postId, id, code };
}
const wrongCode = (code) => String((Number(code) + 1) % 10000).padStart(4, '0');

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea, karim] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu', 'k.saad@lau.edu'].map(signIn));
  const { rows } = await query(`SELECT user_id, email FROM users WHERE email LIKE '%@lau.edu'`);
  for (const r of rows) uid[r.email.split('.')[0]] = r.user_id;
});
afterAll(async () => {
  await require('../src/lib/events').settle(); // let Smart Match finish before closing the pool
  await pool.end();
});

describe('TS-FR-6 Claims and Ownership Verification', () => {
  test('TC-FR-6.1-V claim submitted with an answer', async () => {
    const postId = await found(omar);
    const res = await claim(sara, postId, { answer: 'A blue LAU sticker' }).expect(201);
    expect(res.body.claim.status).toBe('PENDING');
  });

  test('TC-FR-6.1-D claim without an answer or on a closed post refused', async () => {
    const postId = await found(omar);
    const empty = await claim(sara, postId, { answer: '  ' }).expect(400);
    expect(empty.body.fields.answer).toMatch(/answer/i);
    await omar.post(`/api/posts/${postId}/close`).expect(200);
    const closed = await claim(sara, postId).expect(409);
    expect(closed.body.error).toMatch(/not open/);
  });

  test('TC-FR-6.2-V claim with and without a description accepted; the reviewer sees it', async () => {
    const [a, b] = [await found(omar), await found(omar)];
    await claim(sara, a).expect(201);
    const id = await claimId(sara, b, { answer: 'Blue sticker', description: 'Small scratch on the back' });
    const seen = await omar.get(`/api/claims/${id}`).expect(200);
    expect(seen.body.claim.description).toBe('Small scratch on the back');
  });

  test('TC-FR-6.2-D over-long description refused', async () => {
    const res = await claim(sara, await found(omar), { answer: 'Blue', description: 'x'.repeat(1001) }).expect(400);
    expect(res.body.fields.description).toMatch(/1,000/);
  });

  test('TC-FR-6.3-V other users can claim the post', async () => {
    await claim(sara, await found(omar)).expect(201);
  });

  test('TC-FR-6.3-D author cannot claim own post', async () => {
    await claim(omar, await found(omar)).expect(403);
  });

  test('TC-FR-6.4-V new claim after a rejected one accepted', async () => {
    const postId = await found(omar);
    const first = await claimId(sara, postId);
    await omar.post(`/api/claims/${first}/reject`).send({ reason: 'Wrong answer' }).expect(200);
    await claim(sara, postId).expect(201);
  });

  test('TC-FR-6.4-D second pending claim refused', async () => {
    const postId = await found(omar);
    await claim(sara, postId).expect(201);
    const res = await claim(sara, postId, { answer: 'Blue sticker' }).expect(409);
    expect(res.body.error).toMatch(/already have a pending claim/);
  });

  test('TC-FR-6.5-V finder notified of each claim', async () => {
    const postId = await found(omar);
    const a = await claimId(sara, postId);
    const b = await claimId(lea, postId);
    expect(await notes(uid.omar, 'CLAIM_RECEIVED', a)).toHaveLength(1);
    expect(await notes(uid.omar, 'CLAIM_RECEIVED', b)).toHaveLength(1);
  });

  test('TC-FR-6.5-D no notification for a refused claim', async () => {
    const postId = await found(omar);
    await claim(sara, postId).expect(201);
    const before = (await notes(uid.omar, 'CLAIM_RECEIVED')).length;
    await claim(sara, postId).expect(409);
    expect(await notes(uid.omar, 'CLAIM_RECEIVED')).toHaveLength(before);
  });

  test('TC-FR-6.6-V drop-off staff notified of a claim on a held item', async () => {
    const postId = await found(omar, { whereabouts: 'DROPOFF', dropoffId: R.securityOffice });
    const id = await claimId(sara, postId, { answer: 'A blue LAU sticker' });
    expect(await notes(uid.k, 'CLAIM_RECEIVED', id)).toHaveLength(1);
  });

  test('TC-FR-6.6-D drop-off staff not notified for items kept by finders', async () => {
    const id = await claimId(sara, await found(omar));
    expect(await notes(uid.k, 'CLAIM_RECEIVED', id)).toHaveLength(0);
  });

  test('TC-FR-6.7-V reviewer sees both answers', async () => {
    const id = await claimId(sara, await found(omar));
    const { claim: c } = (await omar.get(`/api/claims/${id}`).expect(200)).body;
    expect(c.answer).toBe('Blue sticker');
    expect(c.expectedAnswer).toBe('A blue LAU sticker');
  });

  test('TC-FR-6.7-D non-reviewers cannot see the expected answer', async () => {
    const id = await claimId(sara, await found(omar));
    await lea.get(`/api/claims/${id}`).expect(403);
    const own = (await sara.get(`/api/claims/${id}`).expect(200)).body.claim;
    expect(own.answer).toBe('Blue sticker');
    expect(own.expectedAnswer).toBeUndefined();
  });

  test('TC-FR-6.8-V reviewer approves one claim and rejects another', async () => {
    const a = await claimId(sara, await found(omar));
    const b = await claimId(sara, await found(omar));
    expect((await omar.post(`/api/claims/${a}/approve`).expect(200)).body.claim.status).toBe('APPROVED');
    expect((await omar.post(`/api/claims/${b}/reject`).send({ reason: 'Wrong answer' }).expect(200)).body.claim.status).toBe('REJECTED');
  });

  test('TC-FR-6.8-D others cannot decide; decided claims are final', async () => {
    const id = await claimId(sara, await found(omar));
    await lea.post(`/api/claims/${id}/approve`).expect(403);
    await omar.post(`/api/claims/${id}/reject`).send({ reason: 'Wrong answer' }).expect(200);
    const res = await omar.post(`/api/claims/${id}/approve`).expect(409);
    expect(res.body.error).toMatch(/already been decided/);
  });

  test('TC-FR-6.9-V rejection with a reason; the claimant sees it', async () => {
    const id = await claimId(sara, await found(omar));
    await omar.post(`/api/claims/${id}/reject`).send({ reason: 'The sticker is red, not blue' }).expect(200);
    expect((await sara.get(`/api/claims/${id}`)).body.claim.rejectionReason).toBe('The sticker is red, not blue');
  });

  test('TC-FR-6.9-D rejection without a reason refused', async () => {
    const id = await claimId(sara, await found(omar));
    await omar.post(`/api/claims/${id}/reject`).send({}).expect(400);
    await omar.post(`/api/claims/${id}/reject`).send({ reason: '   ' }).expect(400);
    expect((await sara.get(`/api/claims/${id}`)).body.claim.status).toBe('PENDING');
  });

  test('TC-FR-6.10-V approval sets the post to Claimed and removes it from the open feed', async () => {
    const postId = await found(omar, { title: 'Unique claimed iPhone' });
    const id = await claimId(sara, postId);
    await omar.post(`/api/claims/${id}/approve`).expect(200);
    expect(await postStatus(postId)).toBe('CLAIMED');
    const feed = await lea.get('/api/posts').query({ q: 'Unique claimed iPhone' }).expect(200);
    expect(feed.body.items.map((i) => i.id)).not.toContain(postId);
  });

  test('TC-FR-6.10-D rejection leaves the post Open', async () => {
    const postId = await found(omar);
    const id = await claimId(sara, postId);
    await omar.post(`/api/claims/${id}/reject`).send({ reason: 'Wrong answer' }).expect(200);
    expect(await postStatus(postId)).toBe('OPEN');
  });

  test('TC-FR-6.11-V competing claims rejected with notification', async () => {
    const postId = await found(omar);
    const s = await claimId(sara, postId);
    const l = await claimId(lea, postId);
    await omar.post(`/api/claims/${s}/approve`).expect(200);
    expect((await lea.get(`/api/claims/${l}`)).body.claim.status).toBe('REJECTED');
    expect(await notes(uid.lea, 'CLAIM_REJECTED', l)).toHaveLength(1);
  });

  test('TC-FR-6.11-D claims on other posts unaffected', async () => {
    const [p1, p2] = [await found(omar), await found(omar)];
    const s = await claimId(sara, p1);
    await claimId(lea, p1);
    const other = await claimId(lea, p2);
    await omar.post(`/api/claims/${s}/approve`).expect(200);
    expect((await lea.get(`/api/claims/${other}`)).body.claim.status).toBe('PENDING');
  });

  test('TC-FR-6.12-V conversation opened on approval', async () => {
    const postId = await found(omar);
    const id = await claimId(sara, postId);
    await omar.post(`/api/claims/${id}/approve`).expect(200);
    for (const agent of [sara, omar]) {
      const mine = (await agent.get('/api/claims').expect(200)).body.claims.filter((c) => c.hasConversation && c.postId === postId);
      expect(mine).toHaveLength(1);
    }
  });

  test('TC-FR-6.12-D no conversation for rejected or pending claims', async () => {
    const postId = await found(omar);
    const pending = await claimId(sara, postId);
    const rejected = await claimId(lea, postId);
    await omar.post(`/api/claims/${rejected}/reject`).send({ reason: 'Wrong answer' }).expect(200);
    expect((await sara.get(`/api/claims/${pending}`)).body.claim.hasConversation).toBe(false);
    expect((await lea.get(`/api/claims/${rejected}`)).body.claim.hasConversation).toBe(false);
  });

  test('TC-FR-6.13-V "I may have found this" message sent', async () => {
    const postId = await lost(sara);
    await omar.post(`/api/posts/${postId}/contact`).send({ message: 'I found a black iPhone near Nicol Hall' }).expect(201);
    const contacts = (await sara.get(`/api/posts/${postId}/contacts`).expect(200)).body.contacts;
    expect(contacts[0].body).toBe('I found a black iPhone near Nicol Hall');
    expect((await notes(uid.sara, 'CONTACT')).some((n) => n.content.includes('near Nicol Hall'))).toBe(true);
  });

  test('TC-FR-6.13-D message to own post or empty message refused', async () => {
    const postId = await lost(sara);
    await sara.post(`/api/posts/${postId}/contact`).send({ message: 'Hello' }).expect(403);
    await omar.post(`/api/posts/${postId}/contact`).send({ message: '' }).expect(400);
  });

  describe('flagging repeated rejections', () => {
    const DAY = 24 * 60 * 60 * 1000;
    /** Rejected claims by Lea decided `daysAgo` days ago, as if the clock had moved forward. */
    async function pastRejections(...daysAgo) {
      for (const d of daysAgo) {
        const postId = await found(omar);
        await query(
          `INSERT INTO claims (post_id, claimant_id, answer_text, status, rejection_reason, decided_at)
           VALUES ($1, $2, 'Old answer', 'REJECTED', 'Wrong answer', $3)`,
          [postId, uid.lea, new Date(Date.now() - d * DAY)],
        );
      }
    }
    const flagged = async () => (await query('SELECT flagged_for_review FROM users WHERE user_id = $1', [uid.lea])).rows[0].flagged_for_review;
    const rejectNow = async () => {
      const id = await claimId(lea, await found(omar));
      await omar.post(`/api/claims/${id}/reject`).send({ reason: 'Wrong answer' }).expect(200);
    };
    beforeEach(() => query(`UPDATE claims SET status = 'WITHDRAWN', rejection_reason = NULL WHERE claimant_id = $1 AND status = 'REJECTED'`, [uid.lea]));
    afterAll(() => query('UPDATE users SET flagged_for_review = false WHERE user_id = $1', [uid.lea]));

    test('TC-FR-6.14-D fewer rejections or a longer period do not flag', async () => {
      await pastRejections(9); // days 1 and 10
      await rejectNow();
      expect(await flagged()).toBe(false);
      await query(`UPDATE claims SET status = 'WITHDRAWN', rejection_reason = NULL WHERE claimant_id = $1 AND status = 'REJECTED'`, [uid.lea]);
      await pastRejections(31, 22); // days 1, 10 and 32
      await rejectNow();
      expect(await flagged()).toBe(false);
    });

    test('TC-FR-6.14-V three rejections within 30 days flag the account', async () => {
      await pastRejections(19, 10); // days 1, 10 and 20
      await rejectNow();
      expect(await flagged()).toBe(true);
    });
  });
});

describe('TS-FR-9 Item Status and Handover', () => {
  test('TC-FR-9.1-V each post has one of the five statuses', async () => {
    const { rows } = await query('SELECT DISTINCT status FROM posts');
    for (const r of rows) expect(['OPEN', 'CLAIMED', 'RETURNED', 'CLOSED', 'REMOVED']).toContain(r.status);
  });

  test('TC-FR-9.1-D unknown status refused', async () => {
    const postId = await found(omar);
    await expect(query(`UPDATE posts SET status = 'LOST_FOREVER' WHERE post_id = $1`, [postId])).rejects.toThrow();
    await expect(query(`UPDATE posts SET status = 'LOST' WHERE post_id = $1`, [postId])).rejects.toThrow(/check constraint/);
    await omar.patch(`/api/posts/${postId}`).send({ status: 'LOST_FOREVER' }).expect(400);
  });

  test('TC-FR-9.2-V transitions of Figure 5 succeed', async () => {
    for (const [from, to] of [['OPEN', 'CLAIMED'], ['CLAIMED', 'OPEN'], ['CLAIMED', 'RETURNED'], ['RETURNED', 'CLOSED'], ['OPEN', 'CLOSED'], ['OPEN', 'REMOVED']]) {
      expect(canTransition(from, to)).toBe(true);
    }
    const a = await approved(); // Open to Claimed
    await sara.post(`/api/claims/${a.id}/cancel`).send({ reason: 'Not mine' }).expect(200); // Claimed to Open
    expect(await postStatus(a.postId)).toBe('OPEN');
    const b = await approved();
    await omar.post(`/api/claims/${b.id}/handover`).send({ code: b.code }).expect(200); // Claimed to Returned
    await omar.post(`/api/posts/${b.postId}/close`).expect(200); // Returned to Closed
    expect(await postStatus(b.postId)).toBe('CLOSED');
  });

  test('TC-FR-9.2-D other transitions refused', async () => {
    for (const [from, to] of [['OPEN', 'RETURNED'], ['CLOSED', 'OPEN'], ['REMOVED', 'OPEN']]) expect(canTransition(from, to)).toBe(false);
    const postId = await found(omar);
    const id = await claimId(sara, postId);
    await omar.post(`/api/claims/${id}/handover`).send({ code: '1234' }).expect(409); // Open to Returned
    await omar.post(`/api/posts/${postId}/close`).expect(200);
    await claim(lea, postId).expect(409); // a closed post never reopens
  });

  test('TC-FR-9.3-V claimant sees a four-digit code', async () => {
    const { code } = await approved();
    expect(code).toMatch(/^\d{4}$/);
  });

  test('TC-FR-9.3-D code hidden from everyone else', async () => {
    const postId = await found(omar);
    const id = await claimId(sara, postId);
    const approval = await omar.post(`/api/claims/${id}/approve`).expect(200);
    expect(approval.body.claim.handoverCode).toBeUndefined();
    expect((await omar.get(`/api/claims/${id}`)).body.claim.handoverCode).toBeUndefined();
    expect(JSON.stringify((await omar.get(`/api/posts/${postId}/claims`)).body)).not.toMatch(/handoverCode/);
    await lea.get(`/api/claims/${id}`).expect(403);
  });

  test('TC-FR-9.4-V finder can enter the code', async () => {
    const { id, code } = await approved();
    expect((await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(200)).body.claim.status).toBe('COMPLETED');
  });

  test('TC-FR-9.4-D other users cannot enter the code', async () => {
    const { id, code } = await approved();
    await lea.post(`/api/claims/${id}/handover`).send({ code }).expect(403);
    await sara.post(`/api/claims/${id}/handover`).send({ code }).expect(403);
  });

  test('TC-FR-9.5-V correct code returns the item', async () => {
    const { postId, id, code } = await approved();
    await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(200);
    expect(await postStatus(postId)).toBe('RETURNED');
  });

  test('TC-FR-9.5-D wrong code leaves the post Claimed', async () => {
    const { postId, id, code } = await approved();
    const res = await omar.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code) }).expect(400);
    expect(res.body.error).toMatch(/Wrong code/);
    expect(await postStatus(postId)).toBe('CLAIMED');
  });

  test('TC-FR-9.6-V return time recorded in the history', async () => {
    const { postId, id, code } = await approved();
    const before = Date.now();
    await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(200);
    const history = (await omar.get(`/api/posts/${postId}/history`).expect(200)).body;
    const entry = (history.history || history).find((h) => h.changes.returnedAt);
    expect(new Date(entry.changes.returnedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const { rows } = await query('SELECT returned_at FROM posts WHERE post_id = $1', [postId]);
    expect(rows[0].returned_at).not.toBeNull();
  });

  test('TC-FR-9.6-D no return time for a wrong code', async () => {
    const { postId, id, code } = await approved();
    await omar.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code) }).expect(400);
    const { rows } = await query('SELECT returned_at FROM posts WHERE post_id = $1', [postId]);
    expect(rows[0].returned_at).toBeNull();
  });

  test('TC-FR-9.7-V entry allowed after four wrong codes and after the block', async () => {
    const a = await approved();
    for (let i = 0; i < 4; i += 1) await omar.post(`/api/claims/${a.id}/handover`).send({ code: wrongCode(a.code) }).expect(400);
    await omar.post(`/api/claims/${a.id}/handover`).send({ code: a.code }).expect(200);
    const b = await approved();
    for (let i = 0; i < 5; i += 1) await omar.post(`/api/claims/${b.id}/handover`).send({ code: wrongCode(b.code) });
    await query(`UPDATE claims SET code_locked_until = now() - interval '1 second' WHERE claim_id = $1`, [b.id]); // 15 minutes later
    await omar.post(`/api/claims/${b.id}/handover`).send({ code: b.code }).expect(200);
  });

  test('TC-FR-9.7-D fifth wrong code blocks entry for 15 minutes', async () => {
    const { id, code } = await approved();
    for (let i = 0; i < 4; i += 1) await omar.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code) }).expect(400);
    const fifth = await omar.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code) }).expect(423);
    const minutes = (new Date(fifth.body.details.blockedUntil) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(423);
  });

  test('TC-FR-9.8-V both parties notified when code entry is blocked', async () => {
    const { id, code } = await approved();
    for (let i = 0; i < 5; i += 1) await omar.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code) });
    for (const u of [uid.sara, uid.omar]) {
      const n = await notes(u, 'CODE_BLOCKED', id);
      expect(n).toHaveLength(1);
      expect(n[0].content).toMatch(/15 minutes/);
    }
  });

  test('TC-FR-9.8-D no notification before the fifth wrong code', async () => {
    const { id, code } = await approved();
    for (let i = 0; i < 4; i += 1) await omar.post(`/api/claims/${id}/handover`).send({ code: wrongCode(code) });
    expect(await notes(uid.sara, 'CODE_BLOCKED', id)).toHaveLength(0);
    expect(await notes(uid.omar, 'CODE_BLOCKED', id)).toHaveLength(0);
  });

  test('TC-FR-9.9-V either party cancels the handover', async () => {
    for (const [agent, reason] of [[sara, 'The phone is not mine'], [omar, 'Owner did not come']]) {
      const { postId, id } = await approved();
      const res = await agent.post(`/api/claims/${id}/cancel`).send({ reason }).expect(200);
      expect(res.body.claim.status).toBe('WITHDRAWN');
      expect(await postStatus(postId)).toBe('OPEN');
    }
  });

  test('TC-FR-9.9-D third party cannot cancel; returned items cannot be cancelled', async () => {
    const { id, code } = await approved();
    await lea.post(`/api/claims/${id}/cancel`).send({ reason: 'Because' }).expect(403);
    await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(200);
    await sara.post(`/api/claims/${id}/cancel`).send({ reason: 'Changed my mind' }).expect(409);
  });

  test('TC-FR-9.10-V cancellation reason recorded in the history', async () => {
    const { postId, id } = await approved();
    await omar.post(`/api/claims/${id}/cancel`).send({ reason: 'Owner did not come' }).expect(200);
    const history = (await omar.get(`/api/posts/${postId}/history`).expect(200)).body;
    expect(JSON.stringify(history)).toContain('Owner did not come');
  });

  test('TC-FR-9.10-D cancellation without a reason refused', async () => {
    const { postId, id } = await approved();
    await omar.post(`/api/claims/${id}/cancel`).send({ reason: '' }).expect(400);
    expect(await postStatus(postId)).toBe('CLAIMED');
  });

  describe('closing returned posts', () => {
    const at = (s) => new Date(s);
    async function returnedAt(when) {
      const { postId, id, code } = await approved();
      await omar.post(`/api/claims/${id}/handover`).send({ code }).expect(200);
      await query('UPDATE posts SET returned_at = $2 WHERE post_id = $1', [postId, when]);
      return postId;
    }

    test('TC-FR-9.11-V returned post closed after 7 days', async () => {
      const postId = await returnedAt(at('2026-10-01T10:00:00+03:00'));
      await closeReturnedPosts(at('2026-10-08T10:01:00+03:00'));
      expect(await postStatus(postId)).toBe('CLOSED');
    });

    test('TC-FR-9.11-D post not closed early; other statuses untouched', async () => {
      const postId = await returnedAt(at('2026-10-01T10:00:00+03:00'));
      await closeReturnedPosts(at('2026-10-07T23:59:00+03:00'));
      expect(await postStatus(postId)).toBe('RETURNED');
      const open = await found(omar);
      await query(`UPDATE posts SET created_at = now() - interval '30 days' WHERE post_id = $1`, [open]);
      await closeReturnedPosts(new Date());
      expect(await postStatus(open)).toBe('OPEN');
      await query('UPDATE posts SET returned_at = now() WHERE post_id = $1', [postId]); // keep later runs clean
    });
  });
});

describe('TS-FR-8 notification emails', () => {
  test('TC-FR-8.2-V a claim approval is emailed by the sweep', async () => {
    await query('UPDATE users SET email_notifications = true WHERE user_id = $1', [uid.sara]);
    await sendPendingEmails(); // clear the backlog
    await approved();
    const count = await sendPendingEmails();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(sent.some((m) => m.to === 'sara.k@lau.edu' && /approved/.test(m.subject))).toBe(true);
  });
});
