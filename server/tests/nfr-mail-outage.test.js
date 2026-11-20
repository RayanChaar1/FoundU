// TC-NFR-21.2-D (and NFR-25.2): with the email service down, signed-in users carry on, emails wait for the next
// sweep, and a new sign-in is told the code could not be sent instead of getting a server error.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '2599'; // nothing listens here
const request = require('supertest');
const { createApp } = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { sendPendingEmails } = require('../src/modules/notifications/service');

const app = createApp();
afterAll(() => pool.end());

describe('Email service down', () => {
  test('a new sign-in gets 503 with a clear message, and the unsent code is not kept', async () => {
    const count = async () => (await query(`SELECT count(*)::int AS n FROM otp_codes WHERE email = 'omar.h@lau.edu'`)).rows[0].n;
    const before = await count();
    const res = await request(app).post('/api/auth/start').send({ email: 'omar.h@lau.edu' }).expect(503);
    expect(res.body.error).toBe('We could not send your code right now.  Try again in a few minutes.');
    expect(await count()).toBe(before);
  });

  test('a notification email that cannot be sent stays waiting for the next sweep', async () => {
    const { rows: [u] } = await query(`SELECT user_id FROM users WHERE email = 'lea.n@lau.edu'`);
    await query('UPDATE users SET email_notifications = true WHERE user_id = $1', [u.user_id]);
    const { rows: [n] } = await query(`INSERT INTO notifications (user_id, type, content) VALUES ($1, 'MODERATION', 'Outage test') RETURNING notification_id`, [u.user_id]);
    await sendPendingEmails();
    const { rows: [after] } = await query('SELECT email_checked, emailed_at FROM notifications WHERE notification_id = $1', [n.notification_id]);
    expect(after).toEqual({ email_checked: false, emailed_at: null });
    await query('DELETE FROM notifications WHERE notification_id = $1', [n.notification_id]);
  });
});
