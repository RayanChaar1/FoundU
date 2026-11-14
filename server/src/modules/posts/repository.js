const { query } = require('../../db/pool');

const getCategory = async (org, id) =>
  (await query('SELECT * FROM categories WHERE organization_id = $1 AND category_id = $2', [org, id])).rows[0];

const getLocation = async (org, id) =>
  (await query('SELECT * FROM locations WHERE organization_id = $1 AND location_id = $2', [org, id])).rows[0];

const getDropoff = async (org, id) =>
  (await query('SELECT * FROM dropoff_points WHERE organization_id = $1 AND dropoff_id = $2 AND is_active', [org, id]))
    .rows[0];

async function insertPost(db, p) {
  const { rows } = await db.query(
    `INSERT INTO posts (organization_id, owner_id, type, title, description, category_id, location_id, event_datetime,
                        is_sensitive, whereabouts, verification_question, verification_answer_enc, dropoff_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [p.organizationId, p.ownerId, p.type, p.title, p.description, p.categoryId, p.locationId, p.eventDatetime,
      p.isSensitive, p.whereabouts, p.verificationQuestion, p.verificationAnswerEnc, p.dropoffId],
  );
  return rows[0];
}

const insertPhoto = (db, postId, { storagePath, blurredPath }, position) =>
  db.query(
    `INSERT INTO photos (post_id, storage_path, blurred_path, is_blurred, position) VALUES ($1, $2, $3, $4, $5)`,
    [postId, storagePath, blurredPath, Boolean(blurredPath), position],
  );

/** A post of the organization (FR-18.4: posts of other organizations are never found). */
const findPost = async (org, id, db = { query }) =>
  (await db.query('SELECT * FROM posts WHERE organization_id = $1 AND post_id = $2', [org, id])).rows[0];

const photosOf = async (postId, db = { query }) =>
  (await db.query('SELECT * FROM photos WHERE post_id = $1 ORDER BY position', [postId])).rows;

const hasApprovedClaim = async (postId) =>
  (await query(`SELECT 1 FROM claims WHERE post_id = $1 AND status IN ('APPROVED', 'COMPLETED')`, [postId])).rowCount > 0;

async function updatePost(db, id, fields) {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await db.query(`UPDATE posts SET ${sets}, updated_at = now() WHERE post_id = $1 RETURNING *`, [
    id,
    ...cols.map((c) => fields[c]),
  ]);
  return rows[0];
}

const insertHistory = (db, postId, editorId, changes) =>
  db.query('INSERT INTO post_history (post_id, editor_id, changes) VALUES ($1, $2, $3)', [postId, editorId, changes]);

const historyOf = async (postId) =>
  (await query(
    `SELECT h.history_id AS id, h.changes, h.edited_at AS "editedAt", u.display_name AS editor
       FROM post_history h LEFT JOIN users u ON u.user_id = h.editor_id
      WHERE h.post_id = $1 ORDER BY h.edited_at DESC`,
    [postId],
  )).rows;

const deletePost = (id) => query('DELETE FROM posts WHERE post_id = $1', [id]);

const deletePhoto = (db, photoId) => db.query('DELETE FROM photos WHERE photo_id = $1 RETURNING *', [photoId]);

module.exports = {
  getCategory,
  getLocation,
  getDropoff,
  insertPost,
  insertPhoto,
  findPost,
  photosOf,
  hasApprovedClaim,
  updatePost,
  insertHistory,
  historyOf,
  deletePost,
  deletePhoto,
};
