/* Smart Match module (Table 7, FR-5): compares a newly published or edited post with the open posts of the
   opposite type, records matches, notifies the owner of the lost post, and lists possible matches. */
const { query, transaction } = require('../../db/pool');
const events = require('../../lib/events');
const { notify } = require('../notifications/service');
const { score } = require('./score');
const { forbidden, notFound } = require('../../lib/errors');

const POST_COLUMNS = `p.post_id, p.organization_id, p.owner_id, p.type, p.title, p.description, p.category_id,
  p.location_id, l.campus_id, p.event_datetime, p.status, l.building`;

async function settingsOf(org, db = { query }) {
  const { rows } = await db.query(
    'SELECT match_threshold, possible_threshold, match_weights FROM organizations WHERE organization_id = $1',
    [org],
  );
  return rows[0];
}

/**
 * FR-5.1 to FR-5.4: compares the post with every open post of the opposite type on the same campus of the same
 * organization (same category, since other categories score 0).  Returns the compared posts and their scores.
 */
async function runFor(postId) {
  return transaction(async (db) => {
    const post = (await db.query(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN locations l USING (location_id) WHERE p.post_id = $1`,
      [postId],
    )).rows[0];
    if (!post || post.status !== 'OPEN') return [];
    const settings = await settingsOf(post.organization_id, db);
    const candidates = (await db.query(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN locations l USING (location_id)
        WHERE p.organization_id = $1 AND l.campus_id = $2 AND p.category_id = $3 AND p.type <> $4
          AND p.status = 'OPEN' AND NOT p.is_hidden AND p.post_id <> $5
          AND p.owner_id IS DISTINCT FROM $6`,
      [post.organization_id, post.campus_id, post.category_id, post.type, post.post_id, post.owner_id],
    )).rows;

    const compared = [];
    for (const other of candidates) {
      const [lost, found] = post.type === 'LOST' ? [post, other] : [other, post];
      const value = score(lost, found, settings.match_weights);
      compared.push({ postId: other.post_id, score: value });
      if (value < settings.possible_threshold) {
        // A pair that no longer reaches the possible threshold after an edit is no longer suggested
        await db.query(`DELETE FROM matches WHERE lost_post_id = $1 AND found_post_id = $2 AND status = 'SUGGESTED'`, [lost.post_id, found.post_id]);
        continue;
      }
      const { rows } = await db.query(
        `INSERT INTO matches (organization_id, lost_post_id, found_post_id, score) VALUES ($1, $2, $3, $4)
         ON CONFLICT (lost_post_id, found_post_id) DO UPDATE SET score = EXCLUDED.score, updated_at = now()
           WHERE matches.status = 'SUGGESTED'
         RETURNING match_id, notified_at`,
        [post.organization_id, lost.post_id, found.post_id, value],
      );
      const match = rows[0]; // undefined when the pair was dismissed (FR-5.7)
      if (match && value >= settings.match_threshold && !match.notified_at) {
        // FR-5.3, FR-5.4: a recorded match; its lost post's owner is told once
        await notify(lost.owner_id, 'MATCH',
          `Possible match for "${lost.title}": "${found.title}" was found at ${found.building} (${value}% match).`,
          { link: `/posts/${lost.post_id}`, db });
        await db.query('UPDATE matches SET notified_at = now() WHERE match_id = $1', [match.match_id]);
      }
    }
    return compared;
  });
}

/** FR-5.5: possible matches of a post (score at or above the possible threshold), best first; owner only. */
async function listFor(user, postId) {
  const post = (await query('SELECT post_id, owner_id, type FROM posts WHERE organization_id = $1 AND post_id = $2', [user.organization_id, postId])).rows[0];
  if (!post) throw notFound('This post does not exist.');
  if (post.owner_id !== user.user_id) throw forbidden('Only the owner of the post can see its matches.');
  const settings = await settingsOf(user.organization_id);
  const [mine, theirs] = post.type === 'LOST' ? ['lost_post_id', 'found_post_id'] : ['found_post_id', 'lost_post_id'];
  const { rows } = await query(
    `SELECT m.match_id AS "id", m.score, o.post_id AS "postId", o.type, o.title, o.event_datetime AS "eventDatetime",
            l.building, c.name AS campus, o.is_sensitive AS sensitive,
            (SELECT photo_id FROM photos WHERE post_id = o.post_id ORDER BY position LIMIT 1) AS "photoId"
       FROM matches m JOIN posts o ON o.post_id = m.${theirs}
       JOIN locations l ON l.location_id = o.location_id JOIN campuses c ON c.campus_id = l.campus_id
      WHERE m.${mine} = $1 AND m.status = 'SUGGESTED' AND o.status = 'OPEN' AND NOT o.is_hidden AND m.score >= $2
      ORDER BY m.score DESC, o.created_at DESC`,
    [postId, settings.possible_threshold],
  );
  return rows.map((r) => ({ ...r, isMatch: r.score >= settings.match_threshold }));
}

/** FR-5.6, FR-5.7: the owner of either post dismisses a suggestion; the pair is never suggested again. */
async function dismiss(user, matchId) {
  const { rows } = await query(
    `SELECT m.match_id, lp.owner_id AS lost_owner, fp.owner_id AS found_owner FROM matches m
       JOIN posts lp ON lp.post_id = m.lost_post_id JOIN posts fp ON fp.post_id = m.found_post_id
      WHERE m.match_id = $1 AND m.organization_id = $2`,
    [matchId, user.organization_id],
  );
  const m = rows[0];
  if (!m) throw notFound('This match does not exist.');
  if (![m.lost_owner, m.found_owner].includes(user.user_id)) throw forbidden('Only the owner of the post can dismiss this match.');
  await query(`UPDATE matches SET status = 'DISMISSED', updated_at = now() WHERE match_id = $1`, [matchId]);
}

/** FR-5.8, FR-5.9: thresholds and weights of the administrator's organization. */
async function getSettings(user) {
  const s = await settingsOf(user.organization_id);
  return { matchThreshold: s.match_threshold, possibleThreshold: s.possible_threshold, weights: s.match_weights };
}

async function updateSettings(user, { matchThreshold, possibleThreshold, weights }) {
  await query(
    `UPDATE organizations SET match_threshold = $2, possible_threshold = $3, match_weights = $4 WHERE organization_id = $1`,
    [user.organization_id, matchThreshold, possibleThreshold, weights],
  );
  await query(
    `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason)
     VALUES ($1, $2, 'MATCH_SETTINGS', 'ORGANIZATION', $1, $3)`,
    [user.organization_id, user.user_id, `Thresholds ${matchThreshold}/${possibleThreshold}, weights ${JSON.stringify(weights)}`.slice(0, 500)],
  );
  return getSettings(user);
}

// FR-2.9: Smart Match starts as soon as a post is published, and runs again after an edit
events.on('post.published', (post) => runFor(post.post_id));
events.on('post.updated', (post) => runFor(post.post_id));

module.exports = { runFor, listFor, dismiss, getSettings, updateSettings };
