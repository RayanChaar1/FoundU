const { query } = require('../../db/pool');

/** Post with its finder, locked for the rest of the transaction when `forUpdate` is set. */
const postFor = async (db, org, postId, forUpdate = false) =>
  (await db.query(
    `SELECT * FROM posts WHERE organization_id = $1 AND post_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [org, postId],
  )).rows[0];

/** Claim joined with its post (organization-checked, FR-18.4). */
const claimFor = async (db, org, claimId, forUpdate = false) =>
  (await db.query(
    `SELECT c.*, p.organization_id, p.owner_id, p.status AS post_status, p.title AS post_title, p.type AS post_type,
            p.whereabouts, p.verification_answer_enc, p.verification_question
       FROM claims c JOIN posts p USING (post_id)
      WHERE p.organization_id = $1 AND c.claim_id = $2 ${forUpdate ? 'FOR UPDATE OF c, p' : ''}`,
    [org, claimId],
  )).rows[0];

async function insertClaim(db, { postId, claimantId, answer, description }) {
  const { rows } = await db.query(
    `INSERT INTO claims (post_id, claimant_id, answer_text, description) VALUES ($1, $2, $3, $4) RETURNING *`,
    [postId, claimantId, answer, description || null],
  );
  return rows[0];
}

async function updateClaim(db, id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await db.query(`UPDATE claims SET ${sets} WHERE claim_id = $1 RETURNING *`, [id, ...keys.map((k) => fields[k])]);
  return rows[0];
}

const setPostStatus = (db, postId, fields) => {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  return db.query(`UPDATE posts SET ${sets}, updated_at = now() WHERE post_id = $1`, [postId, ...keys.map((k) => fields[k])]);
};

const history = (db, postId, editorId, changes) =>
  db.query('INSERT INTO post_history (post_id, editor_id, changes) VALUES ($1, $2, $3)', [postId, editorId, changes]);

/** Rejects the other pending claims on a post and returns them (FR-6.11). */
async function rejectOthers(db, postId, keepId, reason) {
  const { rows } = await db.query(
    `UPDATE claims SET status = 'REJECTED', rejection_reason = $3, auto_rejected = true, decided_at = now()
      WHERE post_id = $1 AND claim_id <> $2 AND status = 'PENDING' RETURNING claim_id, claimant_id`,
    [postId, keepId, reason],
  );
  return rows;
}

/** FR-6.14: rejections of the user's claims decided by a reviewer within the last 30 days. */
const recentRejections = async (db, userId) =>
  (await db.query(
    `SELECT count(*)::int AS n FROM claims
      WHERE claimant_id = $1 AND status = 'REJECTED' AND NOT auto_rejected AND decided_at > now() - interval '30 days'`,
    [userId],
  )).rows[0].n;

const CLAIM_LIST = `
  SELECT c.claim_id, c.post_id, c.status, c.answer_text, c.description, c.rejection_reason, c.cancel_reason,
         c.created_at, c.decided_at, c.returned_at, c.claimant_id,
         p.title AS post_title, p.status AS post_status, p.owner_id, p.whereabouts,
         cu.display_name AS claimant_name, ou.display_name AS finder_name
    FROM claims c JOIN posts p USING (post_id)
    LEFT JOIN users cu ON cu.user_id = c.claimant_id
    LEFT JOIN users ou ON ou.user_id = p.owner_id`;

/** Claims the user submitted and claims the user can review (own posts; drop-off posts for staff). */
async function listFor(user, staff) {
  const { rows } = await query(
    `${CLAIM_LIST}
      WHERE p.organization_id = $1
        AND (c.claimant_id = $2 OR p.owner_id = $2 OR ($3 AND p.whereabouts = 'DROPOFF'))
      ORDER BY c.created_at DESC LIMIT 200`,
    [user.organization_id, user.user_id, staff],
  );
  return rows;
}

const listForPost = async (postId) => (await query(`${CLAIM_LIST} WHERE c.post_id = $1 ORDER BY c.created_at`, [postId])).rows;

const insertContact = (db, postId, senderId, body) =>
  db.query('INSERT INTO post_contacts (post_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *', [postId, senderId, body]);

const contactsOf = async (postId) =>
  (await query(
    `SELECT pc.contact_id AS id, pc.body, pc.created_at AS "createdAt", u.display_name AS "senderName"
       FROM post_contacts pc LEFT JOIN users u ON u.user_id = pc.sender_id
      WHERE pc.post_id = $1 ORDER BY pc.created_at DESC`,
    [postId],
  )).rows;

/** FR-9.11: closes posts that have been Returned for 7 days. */
async function closeReturned(db, now) {
  const { rows } = await db.query(
    `UPDATE posts SET status = 'CLOSED', closed_at = $1, updated_at = $1
      WHERE status = 'RETURNED' AND returned_at <= $1::timestamptz - interval '7 days' RETURNING *`,
    [now],
  );
  return rows;
}

module.exports = {
  postFor, claimFor, insertClaim, updateClaim, setPostStatus, history, rejectOthers, recentRejections,
  listFor, listForPost, insertContact, contactsOf, closeReturned,
};
