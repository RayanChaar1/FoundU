/* Interactive campus map (FR-11): buildings with open posts, filters, and the hotspot view. */
const { query } = require('../../db/pool');
const { isStaff } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../lib/errors');

const HOTSPOT_DAYS = 90; // FR-11.6
const POSTS_PER_BUILDING = 10;

const point = (r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) });

/** FR-11.1, FR-18.4: a campus of the user's organization; any other campus answers 404. */
async function campusOf(user, campusId) {
  const { rows } = await query(
    'SELECT campus_id AS id, name, latitude, longitude FROM campuses WHERE organization_id = $1 AND campus_id = $2',
    [user.organization_id, campusId],
  );
  if (!rows[0]) throw notFound('This campus does not exist.');
  return point(rows[0]);
}

/** FR-11.5: the category has to be one of the organization's categories. */
async function checkCategory(user, categoryId) {
  const { rows } = await query('SELECT 1 FROM categories WHERE organization_id = $1 AND category_id = $2',
    [user.organization_id, categoryId]);
  if (!rows[0]) throw badRequest('Choose a category from the list.', { fields: { categoryId: 'Choose a category from the list.' } });
}

/** FR-11.2, FR-11.4, FR-11.5: one marker per building with open posts, with the number of posts and the latest ones. */
async function markers(user, campusId, { type, categoryId }) {
  const campus = await campusOf(user, campusId);
  if (categoryId) await checkCategory(user, categoryId);
  const where = ['l.campus_id = $1', `p.status = 'OPEN'`];
  const params = [campus.id];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (!isStaff(user)) add('(NOT p.is_hidden OR p.owner_id = ?)', user.user_id); // FR-15.3
  if (type) add('p.type = ?', type);
  if (categoryId) add('p.category_id = ?', categoryId);
  const { rows } = await query(
    `SELECT l.location_id AS id, l.building AS name, l.latitude, l.longitude,
            count(*)::int AS count,
            (count(*) FILTER (WHERE p.type = 'LOST'))::int AS lost,
            (count(*) FILTER (WHERE p.type = 'FOUND'))::int AS found,
            json_agg(json_build_object('id', p.post_id, 'title', p.title, 'type', p.type, 'category', c.name)
                     ORDER BY p.created_at DESC) AS posts
       FROM posts p
       JOIN locations l USING (location_id)
       JOIN categories c USING (category_id)
      WHERE ${where.join(' AND ')}
      GROUP BY l.location_id
      ORDER BY l.building`,
    params,
  );
  return { campus, buildings: rows.map((r) => ({ ...point(r), posts: r.posts.slice(0, POSTS_PER_BUILDING) })) };
}

/** FR-11.6: where items were lost most often during the last 90 days (date of the loss; removed posts excluded). */
async function hotspots(user, campusId) {
  const campus = await campusOf(user, campusId);
  const { rows } = await query(
    `SELECT l.location_id AS id, l.building AS name, l.latitude, l.longitude, count(*)::int AS count
       FROM posts p JOIN locations l USING (location_id)
      WHERE l.campus_id = $1 AND p.type = 'LOST' AND p.status <> 'REMOVED' AND NOT p.is_hidden
        AND p.event_datetime >= now() - make_interval(days => $2)
      GROUP BY l.location_id
      ORDER BY count DESC, l.building`,
    [campus.id, HOTSPOT_DAYS],
  );
  return { campus, days: HOTSPOT_DAYS, hotspots: rows.map(point) };
}

module.exports = { markers, hotspots, HOTSPOT_DAYS };
