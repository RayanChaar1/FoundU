/* Drop-off points (FR-14): the official list, items received and held, and posts for finders without an account.
   The release itself is the handover of the claims module, with the ID check of FR-14.5. */
const { query, transaction } = require('../../db/pool');
const posts = require('../posts/service');
const events = require('../../lib/events');
const { badRequest, notFound, conflict } = require('../../lib/errors');

const POINT = `
  SELECT d.dropoff_id AS id, d.name, d.opening_hours AS "openingHours", d.contact_number AS "contactNumber",
         l.location_id AS "locationId", l.building, c.campus_id AS "campusId", c.name AS campus,
         (SELECT count(*)::int FROM posts p
           WHERE p.dropoff_id = d.dropoff_id AND p.received_at IS NOT NULL AND p.status IN ('OPEN', 'CLAIMED')) AS held
    FROM dropoff_points d JOIN locations l USING (location_id) JOIN campuses c ON c.campus_id = l.campus_id
   WHERE d.organization_id = $1 AND d.is_active`;

/** FR-14.1, FR-14.2: the active drop-off points of the user's organization. */
const list = async (user) => (await query(`${POINT} ORDER BY c.name, d.name`, [user.organization_id])).rows;

async function point(user, id) {
  const { rows } = await query(`${POINT} AND d.dropoff_id = $2`, [user.organization_id, id]);
  if (!rows[0]) throw notFound('This drop-off point does not exist.');
  return rows[0];
}

/** FR-14.2: an administrator adds a point with its name, building (and so campus), opening hours and contact number. */
async function create(user, { name, locationId, opensAt, closesAt, contactNumber }) {
  const { rows } = await query('SELECT 1 FROM locations WHERE organization_id = $1 AND location_id = $2',
    [user.organization_id, locationId]);
  if (!rows[0]) throw badRequest('Choose a building.', { fields: { locationId: 'Choose a building.' } });
  const id = await transaction(async (db) => {
    const { rows: [d] } = await db.query(
      `INSERT INTO dropoff_points (organization_id, location_id, name, opening_hours, contact_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING dropoff_id`,
      [user.organization_id, locationId, name, `${opensAt} to ${closesAt}`, contactNumber],
    );
    await db.query(
      `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, $2, 'DROPOFF_CREATED', 'DROPOFF', $3, $4)`,
      [user.organization_id, user.user_id, d.dropoff_id, name],
    );
    return d.dropoff_id;
  });
  return point(user, id);
}

const ITEM = `
  SELECT p.post_id AS id, p.title, p.status, p.event_datetime AS "eventDatetime", p.received_at AS "receivedAt",
         c.name AS category, l.building, u.display_name AS finder,
         a.claim_id AS "claimId", cu.display_name AS claimant
    FROM posts p
    JOIN categories c USING (category_id)
    JOIN locations l USING (location_id)
    LEFT JOIN users u ON u.user_id = p.owner_id
    LEFT JOIN claims a ON a.post_id = p.post_id AND a.status = 'APPROVED'
    LEFT JOIN users cu ON cu.user_id = a.claimant_id
   WHERE p.dropoff_id = $1 AND p.type = 'FOUND'`;

/** FR-14.7: items held at the point (received, not yet returned), and items announced but not received yet. */
async function items(user, id) {
  const p = await point(user, id);
  const [held, expected] = await Promise.all([
    query(`${ITEM} AND p.received_at IS NOT NULL AND p.status IN ('OPEN', 'CLAIMED') ORDER BY p.received_at DESC`, [id]),
    query(`${ITEM} AND p.received_at IS NULL AND p.status = 'OPEN' AND p.whereabouts = 'DROPOFF' ORDER BY p.created_at DESC`, [id]),
  ]);
  return { point: p, held: held.rows, expected: expected.rows };
}

/** FR-14.3: an officer records an item handed in at the point by linking it to its found post. */
async function receive(user, id, postId) {
  const p = await point(user, id);
  const post = await transaction(async (db) => {
    const { rows: [row] } = await db.query(
      `SELECT po.*, l.campus_id FROM posts po JOIN locations l USING (location_id)
        WHERE po.organization_id = $1 AND po.post_id = $2 FOR UPDATE OF po`,
      [user.organization_id, postId],
    );
    if (!row || row.status === 'REMOVED') throw notFound('This post does not exist.');
    if (row.type !== 'FOUND') throw badRequest('Only found posts can be recorded at a drop-off point.');
    if (row.status !== 'OPEN') throw conflict('This post is no longer open.');
    if (row.received_at) throw conflict('This item is already held at a drop-off point.');
    if (row.campus_id !== p.campusId) throw badRequest('This item was found on another campus.');
    await db.query(
      `UPDATE posts SET whereabouts = 'DROPOFF', dropoff_id = $2, received_at = now(), received_by = $3, updated_at = now()
        WHERE post_id = $1`,
      [postId, id, user.user_id],
    );
    await db.query('INSERT INTO post_history (post_id, editor_id, changes) VALUES ($1, $2, $3)',
      [postId, user.user_id, { received: { dropoff: p.name } }]);
    return row;
  });
  // The karma module awards the finder for handing the item in (Table 13); never for an officer's own post
  if (post.owner_id && post.owner_id !== user.user_id) {
    events.emit('dropoff.received', { postId, ownerId: post.owner_id, dropoffId: id, officerId: user.user_id });
  }
  return items(user, id);
}

/** FR-14.4: an officer posts an item handed in by a finder without an account; the officer is its author. */
async function postForVisitor(user, id, input) {
  const p = await point(user, id);
  const created = await posts.create(user, 'FOUND', { ...input, whereabouts: 'DROPOFF', dropoffId: p.id });
  await query('UPDATE posts SET received_at = now(), received_by = $2 WHERE post_id = $1', [created.post_id, user.user_id]);
  return created;
}

module.exports = { list, point, create, items, receive, postForVisitor };
