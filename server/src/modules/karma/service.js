/* Karma points and badges (FR-13, Table 13).  Points are only ever awarded by the system in reaction to events of
   the other modules; no function moves points between users or turns them into anything else (FR-13.6). */
const { query, transaction } = require('../../db/pool');
const events = require('../../lib/events');
const { notify } = require('../notifications/service');

/** Table 13: the default points.  Each organization keeps its own copy in organizations.karma_rules (FR-16.8). */
const POINTS ={ RETURN: 10, DROPOFF: 5, HELPFUL_REPORT: 2, FRAUD: -20 };
const STAFF = ['SECURITY', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const LEADERBOARD_SIZE = 10; // FR-13.4

/** First day of the current semester: Spring from February, Summer from June, Fall from September. */
function semesterStart(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0 = January
  if (m >= 8) return new Date(y, 8, 1);
  if (m >= 5) return new Date(y, 5, 1);
  if (m >= 1) return new Date(y, 1, 1);
  return new Date(y - 1, 8, 1); // January still belongs to the Fall semester
}

/**
 * FR-13.1 to FR-13.3: records the points, keeps the balance at 0 or more (Table 22), awards every badge whose
 * threshold is reached (each badge once), and notifies the user of each new badge.
 * Returns the new balance and the new badges, or null when karma is disabled for the organization (FR-18.6).
 */
async function award(userId, reason, postId = null) {
  const result = await transaction(async (db) => {
    const { rows: [u] } = await db.query(
      `SELECT u.user_id, u.role, o.karma_enabled, o.karma_rules FROM users u JOIN organizations o USING (organization_id)
        WHERE u.user_id = $1 AND u.status = 'ACTIVE' FOR UPDATE OF u`,
      [userId],
    );
    if (!u || !u.karma_enabled) return null;
    const points = u.karma_rules?.[reason] ?? POINTS[reason];
    await db.query('INSERT INTO karma_events (user_id, points, reason, post_id) VALUES ($1, $2, $3, $4)',
      [userId, points, reason, postId]);
    const { rows: [{ karma_points: balance }] } = await db.query(
      'UPDATE users SET karma_points = greatest(0, karma_points + $2) WHERE user_id = $1 RETURNING karma_points',
      [userId, points],
    );
    const { rows: badges } = await db.query(
      `INSERT INTO user_badges (user_id, badge_id)
       SELECT $1, badge_id FROM badges
        WHERE karma_threshold <= $2 OR (code = 'FIRST_FIND' AND $3)
       ON CONFLICT DO NOTHING
       RETURNING badge_id`,
      [userId, balance, reason === 'RETURN'],
    );
    const named = badges.length
      ? (await db.query('SELECT name FROM badges WHERE badge_id = ANY ($1) ORDER BY karma_threshold NULLS FIRST',
        [badges.map((b) => b.badge_id)])).rows.map((b) => b.name)
      : [];
    for (const name of named) {
      await notify(userId, 'BADGE', `You earned the ${name} badge.  Thank you for helping your campus!`, { link: '/leaderboard', db });
    }
    return { balance, badges: named };
  });
  return result;
}

/** FR-13.4, FR-13.5: the ten users of the organization with the most points this semester, without hidden users. */
async function leaderboard(user) {
  const { rows } = await query(
    `SELECT u.user_id AS id, u.display_name AS name, sum(k.points)::int AS points
       FROM karma_events k JOIN users u USING (user_id)
      WHERE u.organization_id = $1 AND u.status = 'ACTIVE' AND NOT u.hide_from_leaderboard AND k.created_at >= $2
      GROUP BY u.user_id
     HAVING sum(k.points) > 0
      ORDER BY points DESC, u.display_name
      LIMIT ${LEADERBOARD_SIZE}`,
    [user.organization_id, semesterStart()],
  );
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

/** The signed-in user's balance, badges and latest points. */
async function mine(user) {
  const [u, badges, history] = await Promise.all([
    query('SELECT karma_points, hide_from_leaderboard FROM users WHERE user_id = $1', [user.user_id]),
    query(
      `SELECT b.code, b.name, b.karma_threshold AS threshold, ub.awarded_at AS "awardedAt"
         FROM user_badges ub JOIN badges b USING (badge_id) WHERE ub.user_id = $1 ORDER BY ub.awarded_at`,
      [user.user_id],
    ),
    query(
      `SELECT k.points, k.reason, k.created_at AS "createdAt", k.post_id AS "postId", p.title AS "postTitle"
         FROM karma_events k LEFT JOIN posts p USING (post_id)
        WHERE k.user_id = $1 ORDER BY k.created_at DESC, k.karma_event_id DESC LIMIT 20`,
      [user.user_id],
    ),
  ]);
  const all = (await query('SELECT code, name, karma_threshold AS threshold FROM badges ORDER BY karma_threshold NULLS FIRST')).rows;
  return {
    points: u.rows[0].karma_points,
    hidden: u.rows[0].hide_from_leaderboard,
    badges: badges.rows,
    allBadges: all,
    history: history.rows,
  };
}

// Reactions to the other modules (5.3).  Staff collect and return items as part of their job, so they earn nothing.
const finder = async (userId) => {
  const { rows } = await query('SELECT role FROM users WHERE user_id = $1', [userId]);
  return rows[0] && !STAFF.includes(rows[0].role);
};
events.on('handover.completed', async (claim) => {
  if (claim.owner_id && (await finder(claim.owner_id))) await award(claim.owner_id, 'RETURN', claim.post_id);
});
events.on('dropoff.received', async ({ ownerId, postId }) => {
  if (await finder(ownerId)) await award(ownerId, 'DROPOFF', postId);
});
events.on('report.upheld', async ({ reporterId, postId }) => { // a report that led to an action (FR-15.5)
  if (reporterId) await award(reporterId, 'HELPFUL_REPORT', postId);
});
events.on('content.removed', async ({ authorId, postId, fraud }) => { // a post removed by a moderator (FR-15.5)
  if (authorId && fraud) await award(authorId, 'FRAUD', postId);
});

module.exports = { award, leaderboard, mine, semesterStart, POINTS };
