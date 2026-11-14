const { query } = require('../../db/pool');

const PAGE_SIZE = 20; // FR-4.9

/** Feed and search (FR-4.1 to FR-4.6, FR-4.9).  Every filter is optional and all can be combined. */
async function searchPosts(org, f, viewer) {
  const where = ['p.organization_id = $1', `p.status <> 'REMOVED'`];
  const params = [org];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  add('p.status = ?', f.status || 'OPEN');
  if (!viewer.staff) add('(NOT p.is_hidden OR p.owner_id = ?)', viewer.userId); // FR-15.3
  if (f.type) add('p.type = ?', f.type);
  if (f.categoryId) add('p.category_id = ?', f.categoryId);
  if (f.campusId) add('l.campus_id = ?', f.campusId);
  if (f.locationId) add('p.location_id = ?', f.locationId);
  if (f.from) add('p.event_datetime >= ?', f.from);
  if (f.to) add(`p.event_datetime < (?::date + 1)`, f.to);
  if (f.q) {
    params.push(f.q);
    const n = params.length;
    params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(p.search @@ websearch_to_tsquery('english', $${n}) OR p.title ILIKE $${n + 1})`);
  }
  const filter = where.join(' AND ');
  const offset = (f.page - 1) * PAGE_SIZE;
  const [items, total] = await Promise.all([
    query(
      `SELECT p.post_id AS id, p.type, p.title, p.status, p.is_sensitive AS sensitive, p.event_datetime AS "eventDatetime",
              p.created_at AS "createdAt", c.name AS category, l.building, cp.name AS campus,
              (SELECT photo_id FROM photos ph WHERE ph.post_id = p.post_id ORDER BY position LIMIT 1) AS "photoId"
         FROM posts p
         JOIN categories c USING (category_id)
         JOIN locations l USING (location_id)
         JOIN campuses cp ON cp.campus_id = l.campus_id
        WHERE ${filter}
        ORDER BY p.created_at DESC, p.post_id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params,
    ),
    query(`SELECT count(*)::int AS n FROM posts p JOIN locations l USING (location_id) WHERE ${filter}`, params),
  ]);
  return { items: items.rows, total: total.rows[0].n, page: f.page, pageSize: PAGE_SIZE };
}

async function postDetail(org, id) {
  const { rows } = await query(
    `SELECT p.*, c.name AS category, l.building, l.latitude, l.longitude, cp.name AS campus, cp.campus_id,
            u.display_name AS poster, u.user_id AS poster_id,
            d.name AS dropoff_name, d.opening_hours AS dropoff_hours, d.contact_number AS dropoff_contact,
            dl.building AS dropoff_building
       FROM posts p
       JOIN categories c USING (category_id)
       JOIN locations l USING (location_id)
       JOIN campuses cp ON cp.campus_id = l.campus_id
       LEFT JOIN users u ON u.user_id = p.owner_id
       LEFT JOIN dropoff_points d ON d.dropoff_id = p.dropoff_id
       LEFT JOIN locations dl ON dl.location_id = d.location_id
      WHERE p.organization_id = $1 AND p.post_id = $2`,
    [org, id],
  );
  return rows[0];
}

const badgesOf = async (userId) =>
  (await query(
    `SELECT b.code, b.name FROM user_badges ub JOIN badges b USING (badge_id) WHERE ub.user_id = $1 ORDER BY ub.awarded_at`,
    [userId],
  )).rows;

const photoIds = async (postId) =>
  (await query('SELECT photo_id FROM photos WHERE post_id = $1 ORDER BY position', [postId])).rows.map((r) => r.photo_id);

/** A photo with what is needed to decide whether the viewer sees it blurred (FR-17.2). */
async function photoWithPost(photoId) {
  const { rows } = await query(
    `SELECT ph.*, p.organization_id, p.owner_id, p.is_sensitive, p.status, p.is_hidden
       FROM photos ph JOIN posts p USING (post_id) WHERE ph.photo_id = $1`,
    [photoId],
  );
  return rows[0];
}

const isApprovedClaimant = async (postId, userId) =>
  (await query(
    `SELECT 1 FROM claims WHERE post_id = $1 AND claimant_id = $2 AND status IN ('APPROVED', 'COMPLETED')`,
    [postId, userId],
  )).rowCount > 0;

module.exports = { searchPosts, postDetail, badgesOf, photoIds, photoWithPost, isApprovedClaimant, PAGE_SIZE };
