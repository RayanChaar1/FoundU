// NFR-22.1 (Law No. 81 of 2018): every piece of data FoundU stores has a stated purpose and retention, shown to
// users at /privacy, and the short-lived data of Table 58 is deleted on time.
const request = require('supertest');
const { createApp } = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { ITEMS } = require('../src/modules/privacy/inventory');
const { purgeShortLived } = require('../src/modules/retention/service');

const app = createApp();
afterAll(() => pool.end());

/** Columns of the database ("table.column") that no inventory entry explains. */
async function unexplained() {
  const listed = new Set(ITEMS.flatMap((i) => Object.entries(i.columns).flatMap(([t, cols]) => cols.map((c) => `${t}.${c}`))));
  const { rows } = await query(`SELECT table_name || '.' || column_name AS col FROM information_schema.columns
                                 WHERE table_schema = 'public' ORDER BY 1`);
  return rows.map((r) => r.col).filter((c) => !listed.has(c));
}

describe('NFR-22.1 Purpose and information', () => {
  test('TC-NFR-22.1-V: every column has a purpose; the notice is public; users can view and correct their data', async () => {
    expect(await unexplained()).toEqual([]);
    for (const i of ITEMS) {
      expect(i.purpose.length).toBeGreaterThan(20);
      expect(i.kept.length).toBeGreaterThan(5);
    }
    const res = await request(app).get('/api/privacy').expect(200); // before signing in
    expect(res.body.items.filter((i) => i.personal).length).toBeGreaterThanOrEqual(8);
    expect(res.body.rights.join(' ')).toMatch(/download/i);
    expect(res.body.rights.join(' ')).toMatch(/Correct/);
    expect(res.body.rules.join(' ')).toMatch(/code of conduct/);
  });

  test('TC-NFR-22.1-D: a field added without a stated purpose is flagged', async () => {
    await query('ALTER TABLE users ADD COLUMN test_field text');
    try {
      expect(await unexplained()).toEqual(['users.test_field']);
    } finally {
      await query('ALTER TABLE users DROP COLUMN test_field');
    }
    expect(await unexplained()).toEqual([]);
  });

  test('Table 58: notifications older than six months and codes expired for a day are deleted', async () => {
    const { rows: [u] } = await query(`SELECT user_id FROM users WHERE email = 'sara.k@lau.edu'`);
    const { rows: [old] } = await query(`INSERT INTO notifications (user_id, type, content, created_at)
      VALUES ($1, 'MODERATION', 'Old notification', now() - interval '6 months 1 day') RETURNING notification_id`, [u.user_id]);
    const { rows: [recent] } = await query(`INSERT INTO notifications (user_id, type, content, created_at)
      VALUES ($1, 'MODERATION', 'Recent notification', now() - interval '5 months') RETURNING notification_id`, [u.user_id]);
    const { rows: [code] } = await query(`INSERT INTO otp_codes (email, code_hash, expires_at)
      VALUES ('sara.k@lau.edu', 'x', now() - interval '2 days') RETURNING otp_id`);
    const out = await purgeShortLived();
    expect(out.notifications).toBeGreaterThanOrEqual(1);
    expect(out.codes).toBeGreaterThanOrEqual(1);
    const left = (await query('SELECT notification_id FROM notifications WHERE notification_id = ANY ($1)', [[old.notification_id, recent.notification_id]])).rows;
    expect(left.map((r) => r.notification_id)).toEqual([recent.notification_id]);
    expect((await query('SELECT 1 FROM otp_codes WHERE otp_id = $1', [code.otp_id])).rowCount).toBe(0);
  });
});
