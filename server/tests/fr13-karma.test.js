/* TS-FR-13 Karma points and badges. */
const { signIn } = require('./helpers');
const { pool, query } = require('../src/db/pool');
const { ref, today } = require('./fixtures');
const events = require('../src/lib/events');
const { award, semesterStart } = require('../src/modules/karma/service');

let R;
let sara;
let omar;
let lea;
const uid = {};
const extra = []; // users created for the leaderboard

const points = async (userId) => (await query('SELECT karma_points FROM users WHERE user_id = $1', [userId])).rows[0].karma_points;
const setPoints = (userId, n) => query('UPDATE users SET karma_points = $2 WHERE user_id = $1', [userId, n]);
const badges = async (userId) =>
  (await query('SELECT b.code FROM user_badges JOIN badges b USING (badge_id) WHERE user_id = $1 ORDER BY b.badge_id', [userId])).rows.map((r) => r.code);
const badgeNotes = async (userId) =>
  (await query(`SELECT content FROM notifications WHERE user_id = $1 AND type = 'BADGE' ORDER BY notification_id`, [userId])).rows.map((r) => r.content);
const emit = async (name, payload) => {
  events.emit(name, payload);
  await events.settle();
};
const leaders = async (agent = sara) => (await agent.get('/api/leaderboard').expect(200)).body.leaders;
const reset = async (userId) => {
  await query('DELETE FROM karma_events WHERE user_id = $1', [userId]);
  await query('DELETE FROM user_badges WHERE user_id = $1', [userId]);
  await query(`DELETE FROM notifications WHERE user_id = $1 AND type = 'BADGE'`, [userId]);
  await query('UPDATE users SET karma_points = 0, hide_from_leaderboard = false WHERE user_id = $1', [userId]);
};
const event = (userId, n, at = new Date()) =>
  query(`INSERT INTO karma_events (user_id, points, reason, created_at) VALUES ($1, $2, 'RETURN', $3)`, [userId, n, at]);

/** A full return of a found post by Omar to Sara (FR-9.5), which awards Omar through the handover.completed event. */
async function returned() {
  const req = omar.post('/api/posts/found');
  const fields = {
    title: 'Black iPhone 14', categoryId: R.phone, locationId: R.library, date: today(),
    whereabouts: 'FINDER', verificationQuestion: 'Sticker?', verificationAnswer: 'Blue',
  };
  for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
  const postId = (await req.expect(201)).body.id;
  const id = (await sara.post(`/api/posts/${postId}/claims`).send({ answer: 'Blue' }).expect(201)).body.claim.id;
  await omar.post(`/api/claims/${id}/approve`).expect(200);
  const { handoverCode } = (await sara.get(`/api/claims/${id}`).expect(200)).body.claim;
  await omar.post(`/api/claims/${id}/handover`).send({ code: handoverCode }).expect(200);
  await events.settle();
  return postId;
}

beforeAll(async () => {
  R = await ref();
  [sara, omar, lea] = await Promise.all(['sara.k@lau.edu', 'omar.h@lau.edu', 'lea.n@lau.edu'].map(signIn));
  for (const r of (await query('SELECT user_id, email FROM users')).rows) uid[r.email.split(/[.@]/)[0]] = r.user_id;
});
beforeEach(async () => {
  await events.settle();
  for (const u of [uid.omar, uid.sara, uid.john]) await reset(u);
});
afterAll(async () => {
  await events.settle();
  for (const u of [uid.omar, uid.sara, uid.john]) await reset(u);
  if (extra.length) await query('DELETE FROM users WHERE user_id = ANY ($1)', [extra]);
  await pool.end();
});

describe('TS-FR-13 Karma points and badges', () => {
  test('TC-FR-13.1-V points awarded for the actions of Table 13', async () => {
    const postId = await returned();
    expect(await points(uid.omar)).toBe(10);
    await emit('dropoff.received', { ownerId: uid.omar, postId });
    expect(await points(uid.omar)).toBe(15);
    await emit('report.upheld', { reporterId: uid.omar, postId });
    expect(await points(uid.omar)).toBe(17);
  });

  test('TC-FR-13.1-D penalty and balance floor applied', async () => {
    await emit('content.removed', { authorId: uid.omar, postId: null, fraud: true });
    expect(await points(uid.omar)).toBe(0); // never negative (users.karma_points >= 0)
    await emit('content.removed', { authorId: uid.omar, postId: null, fraud: false });
    const { rows } = await query('SELECT points, reason FROM karma_events WHERE user_id = $1', [uid.omar]);
    expect(rows).toEqual([{ points: -20, reason: 'FRAUD' }]); // a removal for another reason, or a dismissed report, awards nothing
  });

  test('TC-FR-13.1-V points follow the rules of the organization (FR-16.8)', async () => {
    const org = (await query('SELECT organization_id FROM users WHERE user_id = $1', [uid.omar])).rows[0].organization_id;
    await query(`UPDATE organizations SET karma_rules = karma_rules || '{"DROPOFF": 7}' WHERE organization_id = $1`, [org]);
    try {
      await reset(uid.omar);
      await emit('dropoff.received', { ownerId: uid.omar, postId: null });
      expect(await points(uid.omar)).toBe(7);
    } finally {
      await query(`UPDATE organizations SET karma_rules = karma_rules || '{"DROPOFF": 5}' WHERE organization_id = $1`, [org]);
      await reset(uid.omar);
    }
  });

  test('TC-FR-13.2-V badges awarded at their thresholds', async () => {
    await award(uid.omar, 'RETURN');
    expect(await badges(uid.omar)).toEqual(['FIRST_FIND']);
    await setPoints(uid.omar, 40);
    await award(uid.omar, 'RETURN');
    await setPoints(uid.omar, 95);
    await award(uid.omar, 'DROPOFF');
    await setPoints(uid.omar, 245);
    await award(uid.omar, 'DROPOFF');
    expect(await badges(uid.omar)).toEqual(['FIRST_FIND', 'HELPING_HAND', 'CAMPUS_HERO', 'CAMPUS_GUARDIAN']);
  });

  test('TC-FR-13.2-D no badge below a threshold or twice', async () => {
    await setPoints(uid.omar, 47);
    await award(uid.omar, 'HELPFUL_REPORT');
    expect(await points(uid.omar)).toBe(49);
    expect(await badges(uid.omar)).toEqual([]);
    await award(uid.omar, 'HELPFUL_REPORT');
    await award(uid.omar, 'FRAUD');
    await setPoints(uid.omar, 45);
    await award(uid.omar, 'DROPOFF');
    expect(await points(uid.omar)).toBe(50);
    expect(await badges(uid.omar)).toEqual(['HELPING_HAND']);
    expect(await badgeNotes(uid.omar)).toHaveLength(1);
  });

  test('TC-FR-13.3-V notification for a new badge', async () => {
    await setPoints(uid.omar, 48);
    await award(uid.omar, 'HELPFUL_REPORT');
    expect(await badgeNotes(uid.omar)).toEqual([expect.stringContaining('You earned the Helping Hand badge')]);
  });

  test('TC-FR-13.3-D no badge notification without a badge', async () => {
    await setPoints(uid.omar, 45);
    await award(uid.omar, 'HELPFUL_REPORT');
    expect(await points(uid.omar)).toBe(47);
    expect(await badgeNotes(uid.omar)).toEqual([]);
  });

  describe('leaderboard', () => {
    beforeAll(async () => {
      for (let i = 1; i <= 12; i += 1) {
        const { rows } = await query(
          `INSERT INTO users (organization_id, email, full_name, display_name, campus_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
          [R.lau, `leader${i}@lau.edu`, `Leader ${i}`, `Leader ${String(i).padStart(2, '0')}`, R.beirut],
        );
        extra.push(rows[0].user_id);
        await event(rows[0].user_id, 300 - i * 10); // 290, 280, ..., 180
      }
    });

    test('TC-FR-13.4-V top ten of the semester', async () => {
      const list = await leaders();
      expect(list).toHaveLength(10);
      expect(list.map((l) => l.points)).toEqual([290, 280, 270, 260, 250, 240, 230, 220, 210, 200]);
      expect(list[0]).toMatchObject({ rank: 1, name: 'Leader 01' });
    });

    test('TC-FR-13.4-D old points and other organizations excluded', async () => {
      const lastSemester = new Date(semesterStart().getTime() - 30 * 864e5);
      await event(uid.sara, 300, lastSemester);
      await event(uid.john, 500);
      const names = (await leaders()).map((l) => l.id);
      expect(names).not.toContain(uid.sara);
      expect(names).not.toContain(uid.john);
    });

    test('TC-FR-13.5-V user hides from the leaderboard', async () => {
      await event(uid.omar, 1000);
      expect((await leaders())[0].id).toBe(uid.omar);
      await omar.patch(`/api/users/${uid.omar}/settings`).send({ hideFromLeaderboard: true }).expect(200);
      const list = await leaders();
      expect(list.map((l) => l.id)).not.toContain(uid.omar);
      expect(list).toHaveLength(10);
      expect(list[0].name).toBe('Leader 01');
    });

    test('TC-FR-13.5-D hidden user still keeps points; others cannot hide him', async () => {
      await setPoints(uid.omar, 120);
      await omar.patch('/api/me/preferences').send({ hideFromLeaderboard: true }).expect(200);
      expect(await points(uid.omar)).toBe(120);
      expect((await omar.get('/api/me/karma').expect(200)).body).toMatchObject({ points: 120, hidden: true });
      await lea.patch(`/api/users/${uid.omar}/settings`).send({ hideFromLeaderboard: false }).expect(403);
      expect((await query('SELECT hide_from_leaderboard FROM users WHERE user_id = $1', [uid.omar])).rows[0].hide_from_leaderboard).toBe(true);
    });
  });

  test('TC-FR-13.6-V points stay with the user who earned them', async () => {
    await setPoints(uid.omar, 50);
    await award(uid.omar, 'RETURN');
    expect(await points(uid.omar)).toBe(60);
    expect(await points(uid.sara)).toBe(0);
  });

  test('TC-FR-13.6-D transfer or sale of points impossible', async () => {
    await setPoints(uid.omar, 50);
    await omar.post('/api/karma/transfer').send({ to: uid.sara, points: 50 }).expect(404);
    await sara.patch('/api/me/preferences').send({ karmaPoints: 999 });
    expect(await points(uid.omar)).toBe(50);
    expect(await points(uid.sara)).toBe(0);
  });
});
