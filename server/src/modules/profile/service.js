/* My Posts and Profile module (Table 7, FR-10): the user's activity dashboard and public profiles. */
const { query } = require('../../db/pool');
const { notFound } = require('../../lib/errors');

/** FR-10.1: the user's posts, claims and conversations, each with its status. */
async function activity(user) {
  const [posts, claims, conversations] = await Promise.all([
    query(
      `SELECT p.post_id AS id, p.type, p.title, p.status, p.created_at AS "createdAt", l.building,
              (SELECT count(*)::int FROM claims c WHERE c.post_id = p.post_id AND c.status = 'PENDING') AS "pendingClaims",
              (SELECT photo_id FROM photos WHERE post_id = p.post_id ORDER BY position LIMIT 1) AS "photoId"
         FROM posts p JOIN locations l USING (location_id)
        WHERE p.owner_id = $1 AND p.status <> 'REMOVED' ORDER BY p.created_at DESC`,
      [user.user_id],
    ),
    query(
      `SELECT c.claim_id AS id, c.status, c.created_at AS "createdAt", p.post_id AS "postId", p.title AS "postTitle",
              c.cancel_reason IS NOT NULL AS cancelled
         FROM claims c JOIN posts p USING (post_id)
        WHERE c.claimant_id = $1 ORDER BY c.created_at DESC`,
      [user.user_id],
    ),
    query(
      `SELECT c.claim_id AS id, p.title AS "postTitle", p.status AS "postStatus", c.status AS "claimStatus",
              CASE WHEN c.claimant_id = $1 THEN ou.display_name ELSE cu.display_name END AS "otherName"
         FROM claims c JOIN posts p USING (post_id)
         LEFT JOIN users cu ON cu.user_id = c.claimant_id LEFT JOIN users ou ON ou.user_id = p.owner_id
        WHERE (c.claimant_id = $1 OR p.owner_id = $1)
          AND (c.status IN ('APPROVED', 'COMPLETED') OR (c.status = 'WITHDRAWN' AND c.cancel_reason IS NOT NULL))
        ORDER BY c.decided_at DESC`,
      [user.user_id],
    ),
  ]);
  return {
    posts: posts.rows,
    claims: claims.rows,
    conversations: conversations.rows.map((c) => ({
      ...c,
      otherName: c.otherName || 'Former user',
      open: c.claimStatus === 'APPROVED' && c.postStatus === 'CLAIMED', // FR-7.6: otherwise read-only
    })),
  };
}

/** FR-10.6, FR-10.7: public profile of an active member of the same organization; never the email address. */
async function profile(viewer, userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.display_name, u.karma_points, u.created_at, c.name AS campus, o.karma_enabled,
            (SELECT count(*)::int FROM claims cl JOIN posts p USING (post_id)
              WHERE p.owner_id = u.user_id AND cl.status = 'COMPLETED') AS returned
       FROM users u JOIN organizations o USING (organization_id) LEFT JOIN campuses c ON c.campus_id = u.campus_id
      WHERE u.user_id = $1 AND u.organization_id = $2 AND u.status = 'ACTIVE'`,
    [userId, viewer.organization_id],
  );
  const u = rows[0];
  if (!u) throw notFound('Profile not available.');
  const badges = await query(
    `SELECT b.code, b.name, ub.awarded_at AS "awardedAt" FROM user_badges ub JOIN badges b USING (badge_id)
      WHERE ub.user_id = $1 ORDER BY ub.awarded_at`,
    [userId],
  );
  return {
    id: u.user_id,
    displayName: u.display_name,
    campus: u.campus,
    karmaPoints: u.karma_enabled ? u.karma_points : undefined, // FR-18: karma can be turned off per organization
    badges: u.karma_enabled ? badges.rows : [],
    itemsReturned: u.returned,
    memberSince: u.created_at,
    isMe: u.user_id === viewer.user_id,
  };
}

module.exports = { activity, profile };
