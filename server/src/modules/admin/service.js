/* Administration (FR-16): users, reference data, drop-off points, parameters and the posts report.
   Every function works inside the administrator's own organization (NFR-12.2), and every change is written to the
   audit log with its author (FR-15.7). */
const { query, transaction } = require('../../db/pool');
const { badRequest, notFound, conflict } = require('../../lib/errors');

const ORG_ROLES = ['USER', 'SECURITY', 'ORG_ADMIN']; // Table 10 without the platform administrator

const audit = (db, admin, action, targetType, targetId, reason = null) => db.query(
  `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [admin.organization_id, admin.user_id, action, targetType, targetId, reason && String(reason).slice(0, 500)],
);

/** Runs an insert or update and turns a duplicate name into a readable 409. */
async function unique(fn, message) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505') throw conflict(message);
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------ users

const USER = `
  SELECT u.user_id AS id, u.full_name AS "fullName", u.display_name AS "displayName", u.email, u.role, u.status,
         u.flagged_for_review AS flagged, c.name AS campus, u.karma_points AS karma, u.created_at AS "createdAt"
    FROM users u LEFT JOIN campuses c ON c.campus_id = u.campus_id
   WHERE u.organization_id = $1 AND u.status <> 'DELETED'`;

/** FR-16.1: users of the organization whose name, display name or email contains the text (all users without one). */
async function searchUsers(admin, text = '') {
  const term = text.trim();
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await query(
    `${USER} AND ($2 = '' OR u.full_name ILIKE $3 OR u.display_name ILIKE $3 OR u.email ILIKE $3)
     ORDER BY u.full_name LIMIT 50`,
    [admin.organization_id, term, like],
  );
  return rows;
}

async function orgUser(admin, id, db = { query }) {
  const { rows } = await db.query(`${USER} AND u.user_id = $2`, [admin.organization_id, id]);
  if (!rows[0]) throw notFound('This user does not exist.'); // users of other organizations look the same
  return rows[0];
}

/** FR-16.2: the user's posts, claims, reports made, and reports received on their content, with their dates. */
async function activity(admin, id) {
  const user = await orgUser(admin, id);
  const [posts, claims, reportsMade, reportsReceived, actions] = await Promise.all([
    query(
      `SELECT post_id AS id, type, title, status, created_at AS "createdAt" FROM posts
        WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100`, [id]),
    query(
      `SELECT c.claim_id AS id, c.status, c.created_at AS "createdAt", p.post_id AS "postId", p.title
         FROM claims c JOIN posts p USING (post_id) WHERE c.claimant_id = $1 ORDER BY c.created_at DESC LIMIT 100`, [id]),
    query(
      `SELECT report_id AS id, reason, status, created_at AS "createdAt", post_id AS "postId"
         FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 100`, [id]),
    query(
      `SELECT r.report_id AS id, r.reason, r.status, r.created_at AS "createdAt", r.post_id AS "postId"
         FROM reports r
         LEFT JOIN posts p ON p.post_id = r.post_id
         LEFT JOIN messages m ON m.message_id = r.message_id
        WHERE p.owner_id = $1 OR m.sender_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [id]),
    query(
      `SELECT action, reason, created_at AS "createdAt" FROM audit_log
        WHERE organization_id = $1 AND target_type = 'USER' AND target_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [admin.organization_id, id]),
  ]);
  return {
    user,
    posts: posts.rows,
    claims: claims.rows,
    reportsMade: reportsMade.rows,
    reportsReceived: reportsReceived.rows,
    accountHistory: actions.rows,
  };
}

/** FR-16.3: only the roles of an organization can be given, and an administrator cannot change their own role. */
async function setRole(admin, id, role) {
  if (!ORG_ROLES.includes(role)) {
    throw badRequest(role === 'PLATFORM_ADMIN'
      ? 'Platform Administrator is not an organization role.'
      : 'Choose User, Security Officer, or Administrator.', { fields: { role: 'Choose a role.' } });
  }
  if (id === admin.user_id) throw conflict('You cannot change your own role.');
  return transaction(async (db) => {
    const before = await orgUser(admin, id, db);
    if (before.role === role) return before;
    await db.query('UPDATE users SET role = $2 WHERE user_id = $1', [id, role]);
    await audit(db, admin, 'ROLE_CHANGED', 'USER', id, `${before.role} to ${role}`);
    return orgUser(admin, id, db);
  });
}

/** FR-16.4: a suspended user's session ends at their next request, and sign-in is refused (auth middleware, FR-1). */
async function suspend(admin, id, reason) {
  if (id === admin.user_id) throw conflict('You cannot suspend your own account.');
  return transaction(async (db) => {
    const before = await orgUser(admin, id, db);
    if (before.status === 'SUSPENDED') throw conflict('This account is already suspended.');
    await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE user_id = $1`, [id]);
    await audit(db, admin, 'USER_SUSPENDED', 'USER', id, reason);
    return orgUser(admin, id, db);
  });
}

/** FR-16.5 */
async function reinstate(admin, id) {
  return transaction(async (db) => {
    const before = await orgUser(admin, id, db);
    if (before.status !== 'SUSPENDED') throw conflict('Account is not suspended.');
    await db.query(`UPDATE users SET status = 'ACTIVE' WHERE user_id = $1`, [id]);
    await audit(db, admin, 'USER_REINSTATED', 'USER', id);
    return orgUser(admin, id, db);
  });
}

// --------------------------------------------------------------------------------------- reference data

/** FR-16.6: campuses with their buildings, and categories, each with the number of posts that use it. */
async function places(admin) {
  const org = admin.organization_id;
  const [campuses, buildings, categories] = await Promise.all([
    query('SELECT campus_id AS id, name, latitude, longitude FROM campuses WHERE organization_id = $1 ORDER BY name', [org]),
    query(
      `SELECT l.location_id AS id, l.campus_id AS "campusId", l.building AS name, l.latitude, l.longitude,
              (SELECT count(*)::int FROM posts p WHERE p.location_id = l.location_id) AS posts,
              (SELECT count(*)::int FROM dropoff_points d WHERE d.location_id = l.location_id AND d.is_active) AS dropoffs
         FROM locations l WHERE l.organization_id = $1 ORDER BY l.building`, [org]),
    query(
      `SELECT c.category_id AS id, c.name, c.is_sensitive_default AS sensitive,
              (SELECT count(*)::int FROM posts p WHERE p.category_id = c.category_id) AS posts
         FROM categories c WHERE c.organization_id = $1 ORDER BY c.name = 'Other', c.name`, [org]),
  ]);
  const num = (r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) });
  return { campuses: campuses.rows.map(num), buildings: buildings.rows.map(num), categories: categories.rows };
}

const SAME_CATEGORY = 'A category with this name already exists.';
const SAME_CAMPUS = 'A campus with this name already exists.';
const SAME_BUILDING = 'This campus already has a building with this name.';

async function createCategory(admin, { name, sensitive }) {
  return transaction(async (db) => {
    const { rows: [c] } = await unique(() => db.query(
      `INSERT INTO categories (organization_id, name, is_sensitive_default) VALUES ($1, $2, $3) RETURNING category_id`,
      [admin.organization_id, name, sensitive]), SAME_CATEGORY);
    await audit(db, admin, 'CATEGORY_CREATED', 'CATEGORY', c.category_id, name);
    return { id: c.category_id };
  });
}

async function updateCategory(admin, id, { name, sensitive }) {
  return transaction(async (db) => {
    const { rowCount } = await unique(() => db.query(
      `UPDATE categories SET name = $3, is_sensitive_default = $4 WHERE organization_id = $1 AND category_id = $2`,
      [admin.organization_id, id, name, sensitive]), SAME_CATEGORY);
    if (!rowCount) throw notFound('This category does not exist.');
    await audit(db, admin, 'CATEGORY_UPDATED', 'CATEGORY', id, name);
  });
}

async function deleteCategory(admin, id) {
  return transaction(async (db) => {
    const { rows: [c] } = await db.query(
      `SELECT name, (SELECT count(*)::int FROM posts WHERE category_id = $2) AS posts,
              (SELECT count(*)::int FROM qr_tags WHERE category_id = $2) AS tags
         FROM categories WHERE organization_id = $1 AND category_id = $2`, [admin.organization_id, id]);
    if (!c) throw notFound('This category does not exist.');
    if (c.posts || c.tags) {
      throw conflict(`${c.name} is used by ${c.posts} post${c.posts === 1 ? '' : 's'}${c.tags ? ` and ${c.tags} QR tag${c.tags === 1 ? '' : 's'}` : ''}, so it cannot be deleted.`);
    }
    await db.query('DELETE FROM categories WHERE category_id = $1', [id]);
    await audit(db, admin, 'CATEGORY_DELETED', 'CATEGORY', id, c.name);
  });
}

async function createCampus(admin, { name, latitude, longitude }) {
  return transaction(async (db) => {
    const { rows: [c] } = await unique(() => db.query(
      `INSERT INTO campuses (organization_id, name, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING campus_id`,
      [admin.organization_id, name, latitude, longitude]), SAME_CAMPUS);
    await audit(db, admin, 'CAMPUS_CREATED', 'CAMPUS', c.campus_id, name);
    return { id: c.campus_id };
  });
}

async function updateCampus(admin, id, { name, latitude, longitude }) {
  return transaction(async (db) => {
    const { rowCount } = await unique(() => db.query(
      `UPDATE campuses SET name = $3, latitude = $4, longitude = $5 WHERE organization_id = $1 AND campus_id = $2`,
      [admin.organization_id, id, name, latitude, longitude]), SAME_CAMPUS);
    if (!rowCount) throw notFound('This campus does not exist.');
    await audit(db, admin, 'CAMPUS_UPDATED', 'CAMPUS', id, name);
  });
}

/** A campus is only deleted once it has no building, since deleting it would delete its buildings with it. */
async function deleteCampus(admin, id) {
  return transaction(async (db) => {
    const { rows: [c] } = await db.query(
      `SELECT name, (SELECT count(*)::int FROM locations WHERE campus_id = $2) AS buildings
         FROM campuses WHERE organization_id = $1 AND campus_id = $2`, [admin.organization_id, id]);
    if (!c) throw notFound('This campus does not exist.');
    if (c.buildings) throw conflict(`${c.name} still has ${c.buildings} building${c.buildings === 1 ? '' : 's'}.  Delete them first.`);
    await db.query('DELETE FROM campuses WHERE campus_id = $1', [id]);
    await audit(db, admin, 'CAMPUS_DELETED', 'CAMPUS', id, c.name);
  });
}

async function ownCampus(db, admin, campusId) {
  const { rows } = await db.query('SELECT 1 FROM campuses WHERE organization_id = $1 AND campus_id = $2',
    [admin.organization_id, campusId]);
  if (!rows[0]) throw badRequest('Choose a campus.', { fields: { campusId: 'Choose a campus.' } });
}

async function createBuilding(admin, { campusId, name, latitude, longitude }) {
  return transaction(async (db) => {
    await ownCampus(db, admin, campusId);
    const { rows: [l] } = await unique(() => db.query(
      `INSERT INTO locations (organization_id, campus_id, building, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5) RETURNING location_id`,
      [admin.organization_id, campusId, name, latitude, longitude]), SAME_BUILDING);
    await audit(db, admin, 'BUILDING_CREATED', 'BUILDING', l.location_id, name);
    return { id: l.location_id };
  });
}

async function updateBuilding(admin, id, { campusId, name, latitude, longitude }) {
  return transaction(async (db) => {
    await ownCampus(db, admin, campusId);
    const { rowCount } = await unique(() => db.query(
      `UPDATE locations SET campus_id = $3, building = $4, latitude = $5, longitude = $6
        WHERE organization_id = $1 AND location_id = $2`,
      [admin.organization_id, id, campusId, name, latitude, longitude]), SAME_BUILDING);
    if (!rowCount) throw notFound('This building does not exist.');
    await audit(db, admin, 'BUILDING_UPDATED', 'BUILDING', id, name);
  });
}

async function deleteBuilding(admin, id) {
  return transaction(async (db) => {
    const { rows: [l] } = await db.query(
      `SELECT building AS name, (SELECT count(*)::int FROM posts WHERE location_id = $2) AS posts,
              (SELECT count(*)::int FROM dropoff_points WHERE location_id = $2) AS dropoffs
         FROM locations WHERE organization_id = $1 AND location_id = $2`, [admin.organization_id, id]);
    if (!l) throw notFound('This building does not exist.');
    if (l.posts || l.dropoffs) {
      const uses = [l.posts && `${l.posts} post${l.posts === 1 ? '' : 's'}`, l.dropoffs && `${l.dropoffs} drop-off point${l.dropoffs === 1 ? '' : 's'}`];
      throw conflict(`${l.name} is used by ${uses.filter(Boolean).join(' and ')}, so it cannot be deleted.`);
    }
    await db.query('DELETE FROM locations WHERE location_id = $1', [id]);
    await audit(db, admin, 'BUILDING_DELETED', 'BUILDING', id, l.name);
  });
}

// ---------------------------------------------------------------------------------------- drop-off points

const HELD = `(SELECT count(*)::int FROM posts p
                WHERE p.dropoff_id = d.dropoff_id AND p.received_at IS NOT NULL AND p.status IN ('OPEN', 'CLAIMED'))`;

/** FR-16.7 (adding a point is FR-14.2, POST /api/dropoffs). */
async function updateDropoff(admin, id, { name, locationId, opensAt, closesAt, contactNumber }) {
  return transaction(async (db) => {
    const { rows: [l] } = await db.query('SELECT 1 FROM locations WHERE organization_id = $1 AND location_id = $2',
      [admin.organization_id, locationId]);
    if (!l) throw badRequest('Choose a building.', { fields: { locationId: 'Choose a building.' } });
    const { rowCount } = await db.query(
      `UPDATE dropoff_points SET name = $3, location_id = $4, opening_hours = $5, contact_number = $6
        WHERE organization_id = $1 AND dropoff_id = $2 AND is_active`,
      [admin.organization_id, id, name, locationId, `${opensAt} to ${closesAt}`, contactNumber]);
    if (!rowCount) throw notFound('This drop-off point does not exist.');
    await audit(db, admin, 'DROPOFF_UPDATED', 'DROPOFF', id, name);
  });
}

/** A removed point leaves the official list; it stays in the database for the posts that refer to it. */
async function removeDropoff(admin, id) {
  return transaction(async (db) => {
    const { rows: [d] } = await db.query(
      `SELECT d.name, ${HELD} AS held FROM dropoff_points d
        WHERE d.organization_id = $1 AND d.dropoff_id = $2 AND d.is_active FOR UPDATE`, [admin.organization_id, id]);
    if (!d) throw notFound('This drop-off point does not exist.');
    if (d.held) {
      throw conflict(`${d.name} holds ${d.held} item${d.held === 1 ? '' : 's'}.  Release them to their owners first.`);
    }
    await db.query('UPDATE dropoff_points SET is_active = false WHERE dropoff_id = $1', [id]);
    await audit(db, admin, 'DROPOFF_REMOVED', 'DROPOFF', id, d.name);
  });
}

// ------------------------------------------------------------------------------------------- parameters

const KARMA_LABEL = { RETURN: 'Return', DROPOFF: 'Drop-off', HELPFUL_REPORT: 'Helpful report', FRAUD: 'Fraud' };

/** FR-16.8: the retention period and the karma points (the Smart Match thresholds have their own page, FR-5.8). */
async function settings(admin) {
  const { rows: [o] } = await query(
    `SELECT retention_months AS "retentionMonths", karma_rules AS "karmaRules", karma_enabled AS "karmaEnabled"
       FROM organizations WHERE organization_id = $1`, [admin.organization_id]);
  return o;
}

async function updateSettings(admin, { retentionMonths, karmaRules }) {
  return transaction(async (db) => {
    const { rows: [before] } = await db.query(
      'SELECT retention_months, karma_rules FROM organizations WHERE organization_id = $1 FOR UPDATE', [admin.organization_id]);
    const changes = [];
    if (before.retention_months !== retentionMonths) changes.push(`Retention ${before.retention_months} to ${retentionMonths} months`);
    for (const [k, v] of Object.entries(karmaRules)) {
      if (before.karma_rules[k] !== v) changes.push(`${KARMA_LABEL[k]} points ${before.karma_rules[k]} to ${v}`);
    }
    if (changes.length) {
      await db.query('UPDATE organizations SET retention_months = $2, karma_rules = $3 WHERE organization_id = $1',
        [admin.organization_id, retentionMonths, { ...before.karma_rules, ...karmaRules }]);
      await audit(db, admin, 'SETTINGS_CHANGED', 'ORGANIZATION', admin.organization_id, changes.join('; '));
    }
    return { retentionMonths, karmaRules: { ...before.karma_rules, ...karmaRules } };
  });
}

// ---------------------------------------------------------------------------------------------- report

/** One CSV field: quoted when needed, and never read as a formula by a spreadsheet (CSV injection). */
function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS = { OPEN: 'Open', CLAIMED: 'Claimed', RETURNED: 'Returned', CLOSED: 'Closed', REMOVED: 'Removed' };

/** FR-16.9: the posts created from `from` to `to` (both included), with their returns, as a CSV file. */
async function report(admin, from, to) {
  if (to < from) throw badRequest('The end date is before the start date.', { fields: { to: 'Choose an end date on or after the start date.' } });
  const { rows } = await query(
    `SELECT p.post_id, p.type, p.title, c.name AS category, ca.name AS campus, l.building, p.status,
            to_char(p.created_at, 'YYYY-MM-DD') AS created_on, to_char(p.returned_at, 'YYYY-MM-DD') AS returned_on
       FROM posts p JOIN categories c USING (category_id) JOIN locations l USING (location_id)
       JOIN campuses ca ON ca.campus_id = l.campus_id
      WHERE p.organization_id = $1 AND p.created_at >= $2::date AND p.created_at < $3::date + 1
      ORDER BY p.created_at, p.post_id`,
    [admin.organization_id, from, to],
  );
  const header = ['Post', 'Type', 'Title', 'Category', 'Campus', 'Building', 'Posted on', 'Status', 'Returned', 'Returned on'];
  const lines = rows.map((r) => [
    r.post_id, r.type === 'LOST' ? 'Lost' : 'Found', r.title, r.category, r.campus, r.building, r.created_on,
    STATUS[r.status], r.returned_on || r.status === 'RETURNED' ? 'Yes' : 'No', r.returned_on,
  ]);
  const csv = [header, ...lines].map((l) => l.map(csvField).join(',')).join('\r\n');
  return { csv: `\uFEFF${csv}\r\n`, count: rows.length, filename: `foundu-posts-${from}-to-${to}.csv` };
}

module.exports = {
  ORG_ROLES, searchUsers, activity, setRole, suspend, reinstate,
  places, createCategory, updateCategory, deleteCategory, createCampus, updateCampus, deleteCampus,
  createBuilding, updateBuilding, deleteBuilding, updateDropoff, removeDropoff, settings, updateSettings, report, csvField,
};
