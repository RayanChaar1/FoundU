/* TS-FR-8 Notifications.  The message, badge and moderation events are checked by the tests of their own modules
   (FR-7, FR-13, FR-15); this file covers the other events, the counter, read state and emails. */
const { signIn, sendAllPendingEmails } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');
const mailer = require('../src/lib/mailer');
const { notify, sendPendingEmails } = require('../src/modules/notifications/service');
const jobs = require('../src/modules/notifications/jobs');

let R;
let sara;
let omar;
let lea;
const uid = {};

async function found(agent, title = 'zebra purple tablet', categoryId = R.phone) {
  const req = agent.post('/api/posts/found');
  const fields = { title, categoryId, locationId: R.nicol, date: today(), whereabouts: 'FINDER',
    verificationQuestion: 'What is the sticker on it?', verificationAnswer: 'A blue LAU sticker' };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  const id = (await req.expect(201)).body.id;
  await events.settle();
  return id;
}
async function lost(agent, title = 'zebra yellow') {
  const req = agent.post('/api/posts/lost');
  for (const [k, v] of Object.entries({ title, categoryId: R.phone, locationId: R.nicol, date: today() })) req.field(k, String(v));
  const id = (await req.expect(201)).body.id;
  await events.settle();
  return id;
}
const claim = async (postId) => (await sara.post(`/api/posts/${postId}/claims`).send({ answer: 'Blue sticker' }).expect(201)).body.claim.id;
const notesOf = async (userId) => (await query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY notification_id', [userId])).rows;
const emailsTo = (email, since) => mailer.sent.filter((m) => m.to === email && m.at >= since);
const unread = async (agent) => (await agent.get('/api/notifications/unread').expect(200)).body.unread;
const emails = (on) => query('UPDATE users SET email_notifications = $2 WHERE user_id = $1', [uid.sara, on]);

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu'].map(signIn));
  for (const r of (await query(`SELECT user_id, email FROM users`)).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
});
beforeEach(async () => {
  await events.settle();
  await query(`UPDATE posts SET status = 'CLOSED' WHERE status = 'OPEN'`);
  await query('DELETE FROM notifications WHERE user_id = ANY ($1)', [[uid.sara, uid.omar, uid.lea]]);
  await sendAllPendingEmails(); // nothing left from other files
  await emails(false);
});
afterAll(async () => {
  await events.settle();
  await emails(true); // back to the default (FR-1.11): files that run later expect Sara's email copies
  await pool.end();
});

describe('TS-FR-8 Notifications', () => {
  test('TC-FR-8.1-V one notification per event, with the right text and link', async () => {
    const lostId = await lost(sara);
    const postA = await found(omar); // match found for Sara's lost post
    const a = await claim(postA); // claim received by Omar
    await omar.post(`/api/claims/${a}/approve`).expect(200); // claim approved for Sara
    const postB = await found(omar, 'Brown wallet', R.wallet); // another category: no second match
    const b = await claim(postB);
    await omar.post(`/api/claims/${b}/reject`).send({ reason: 'Wrong answer' }).expect(200); // claim rejected
    const code = (await sara.get(`/api/claims/${a}`)).body.claim.handoverCode;
    await omar.post(`/api/claims/${a}/handover`).send({ code }).expect(200); // handover confirmed

    const byType = (rows, type) => rows.filter((n) => n.type === type);
    const s = await notesOf(uid.sara);
    const o = await notesOf(uid.omar);
    expect(byType(s, 'MATCH')).toHaveLength(1);
    expect(byType(s, 'MATCH')[0].link).toBe(`/posts/${lostId}`);
    expect(byType(o, 'CLAIM_RECEIVED').map((n) => n.claim_id)).toEqual([a, b]);
    expect(byType(s, 'CLAIM_APPROVED')).toHaveLength(1);
    expect(byType(s, 'CLAIM_APPROVED')[0].link).toBe(`/claims/${a}`);
    expect(byType(s, 'CLAIM_REJECTED')).toHaveLength(1);
    expect(byType(s, 'CLAIM_REJECTED')[0].content).toMatch(/Wrong answer/);
    expect(byType(s, 'HANDOVER')).toHaveLength(1);
    expect(byType(o, 'HANDOVER')).toHaveLength(1);
  });

  test('TC-FR-8.1-D no notification for actions without an event', async () => {
    const lostId = await lost(sara, 'quokka orange');
    await query('DELETE FROM notifications WHERE user_id = $1', [uid.sara]);
    await sara.patch(`/api/posts/${lostId}`).send({ description: 'Orange cover' }).expect(200);
    await sara.get('/api/posts').expect(200);
    await events.settle();
    expect(await notesOf(uid.sara)).toHaveLength(0);
  });

  test('TC-FR-8.2-V email sent within 2 minutes', async () => {
    expect(jobs[0].everyMs).toBeLessThanOrEqual(2 * 60 * 1000);
    await emails(true);
    const since = new Date();
    const id = await claim(await found(omar));
    await omar.post(`/api/claims/${id}/approve`).expect(200);
    await sendPendingEmails(); // what the 20-second job does
    expect(emailsTo('sara.k@lau.edu', since).some((m) => /approved/.test(m.subject))).toBe(true);
  });

  test('TC-FR-8.2-D email failure does not lose the notification', async () => {
    await emails(true);
    const since = new Date();
    const spy = jest.spyOn(mailer, 'sendMail').mockRejectedValueOnce(new Error('SMTP stopped'));
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const id = await notify(uid.sara, 'CLAIM_APPROVED', 'Your claim was approved.', { link: '/claims/1' });
    await sendPendingEmails();
    const row = (await query('SELECT * FROM notifications WHERE notification_id = $1', [id])).rows[0];
    expect(row).toBeDefined(); // the in-application notification stays
    expect(row.emailed_at).toBeNull();
    spy.mockRestore();
    errors.mockRestore();
    await sendPendingEmails(); // the mail server is back
    expect(emailsTo('sara.k@lau.edu', since).filter((m) => m.subject.includes('Your claim was approved'))).toHaveLength(1);
  });

  test('TC-FR-8.3-V counter shows unread notifications', async () => {
    for (let i = 1; i <= 3; i += 1) await notify(uid.sara, 'MATCH', `Event ${i}`);
    expect(await unread(sara)).toBe(3);
  });

  test('TC-FR-8.3-D counter never shows read or negative values', async () => {
    for (let i = 1; i <= 3; i += 1) await notify(uid.sara, 'MATCH', `Event ${i}`);
    await sara.post('/api/notifications/read').send({}).expect(200);
    await sara.post('/api/notifications/read').send({}).expect(200);
    expect(await unread(sara)).toBe(0);
  });

  test('TC-FR-8.4-V mark one or all as read', async () => {
    const ids = [];
    for (let i = 1; i <= 3; i += 1) ids.push(await notify(uid.sara, 'MATCH', `Event ${i}`));
    expect((await sara.patch(`/api/notifications/${ids[0]}`).send({ isRead: true }).expect(200)).body.unread).toBe(2);
    expect((await sara.post('/api/notifications/read').send({}).expect(200)).body.unread).toBe(0);
  });

  test('TC-FR-8.4-D cannot mark another user\'s notification', async () => {
    const id = await notify(uid.sara, 'MATCH', 'Event');
    await lea.patch(`/api/notifications/${id}`).send({ isRead: true }).expect(403);
    expect(await unread(sara)).toBe(1);
  });

  describe('email throttling per conversation', () => {
    let claimId;
    const message = () => notify(uid.sara, 'MESSAGE', 'New message from Omar H.', { claimId, link: `/conversations/${claimId}` });
    beforeEach(async () => {
      claimId = await claim(await found(omar));
      await sendPendingEmails();
      await emails(true);
    });

    test('TC-FR-8.5-V new email after 15 minutes', async () => {
      const since = new Date();
      await message();
      await sendPendingEmails();
      await query(`UPDATE notifications SET emailed_at = emailed_at - interval '16 minutes' WHERE claim_id = $1`, [claimId]);
      await message();
      await sendPendingEmails();
      expect(emailsTo('sara.k@lau.edu', since).filter((m) => m.subject.includes('New message'))).toHaveLength(2);
    });

    test('TC-FR-8.5-D no flood of emails', async () => {
      const since = new Date();
      for (let i = 0; i < 5; i += 1) {
        await message();
        await sendPendingEmails();
      }
      expect(emailsTo('sara.k@lau.edu', since).filter((m) => m.subject.includes('New message'))).toHaveLength(1);
      expect(await unread(sara)).toBe(5); // every message still has its in-application notification
    });
  });
});
