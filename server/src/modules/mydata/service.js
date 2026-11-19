/* Personal data rights (FR-17.6, FR-17.7, NFR-22): a user downloads, corrects and deletes their own personal data.
   Every function works on the signed-in user only; there is no way to name another user. */
const { query, transaction } = require('../../db/pool');
const { decrypt } = require('../../lib/crypto');
const storage = require('../../lib/storage');
const { badRequest, conflict } = require('../../lib/errors');
const { anonymizePost } = require('../retention/service');
const { notify } = require('../notifications/service');

const DELETED_TEXT = 'Deleted at the request of its author.';

const rowsOf = async (sql, params) => (await query(sql, params)).rows;

/** FR-17.6: everything FoundU holds about the user, in a machine-readable form.  Other users' data is left out. */
async function exportData(user) {
  const id = user.user_id;
  const [profile] = await rowsOf(
    `SELECT u.email, u.full_name AS "fullName", u.display_name AS "displayName", u.role, o.name AS organization,
            c.name AS campus, u.karma_points AS "karmaPoints", u.email_notifications AS "emailNotifications",
            u.hide_from_leaderboard AS "hideFromLeaderboard", u.created_at AS "createdAt"
       FROM users u LEFT JOIN organizations o USING (organization_id) LEFT JOIN campuses c ON c.campus_id = u.campus_id
      WHERE u.user_id = $1`,
    [id],
  );
  const posts = await rowsOf(
    `SELECT p.post_id AS id, p.type, p.title, p.description, cat.name AS category, l.building, cp.name AS campus,
            p.event_datetime AS "eventDatetime", p.status, p.is_sensitive AS sensitive, p.whereabouts,
            p.verification_question AS "verificationQuestion", p.verification_answer_enc AS answer,
            p.created_at AS "createdAt", p.returned_at AS "returnedAt", p.closed_at AS "closedAt",
            (SELECT count(*)::int FROM photos ph WHERE ph.post_id = p.post_id) AS photos,
            coalesce((SELECT json_agg(json_build_object('changes', h.changes, 'editedAt', h.edited_at) ORDER BY h.edited_at)
                        FROM post_history h WHERE h.post_id = p.post_id), '[]') AS history
       FROM posts p JOIN categories cat USING (category_id) JOIN locations l USING (location_id)
       JOIN campuses cp ON cp.campus_id = l.campus_id
      WHERE p.owner_id = $1 ORDER BY p.created_at`,
    [id],
  );
  for (const p of posts) {
    p.verificationAnswer = p.answer ? decrypt(p.answer) : null; // the user's own answer (NFR-10.1 keeps it encrypted at rest)
    delete p.answer;
  }
  const claims = await rowsOf(
    `SELECT c.claim_id AS id, p.title AS "postTitle", c.answer_text AS answer, c.description, c.status,
            c.rejection_reason AS "rejectionReason", c.cancel_reason AS "cancelReason", c.created_at AS "createdAt",
            c.decided_at AS "decidedAt", c.returned_at AS "returnedAt"
       FROM claims c JOIN posts p USING (post_id) WHERE c.claimant_id = $1 ORDER BY c.created_at`,
    [id],
  );
  const messages = await rowsOf(
    'SELECT claim_id AS "conversation", body, sent_at AS "sentAt" FROM messages WHERE sender_id = $1 ORDER BY sent_at', [id]);
  const contacts = await rowsOf(
    `SELECT pc.post_id AS "postId", p.title AS "postTitle", pc.body, pc.created_at AS "createdAt"
       FROM post_contacts pc JOIN posts p USING (post_id) WHERE pc.sender_id = $1 ORDER BY pc.created_at`,
    [id],
  );
  const notifications = await rowsOf(
    'SELECT type, content, is_read AS read, created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY created_at', [id]);
  const karma = await rowsOf(
    'SELECT points, reason, created_at AS "createdAt" FROM karma_events WHERE user_id = $1 ORDER BY created_at', [id]);
  const reports = await rowsOf(
    `SELECT CASE WHEN post_id IS NOT NULL THEN 'post' ELSE 'message' END AS target, reason, details, status,
            created_at AS "createdAt"
       FROM reports WHERE reporter_id = $1 ORDER BY created_at`,
    [id],
  );
  const tags = await rowsOf(
    `SELECT t.item_label AS label, t.is_active AS active, t.created_at AS "createdAt",
            coalesce((SELECT json_agg(json_build_object('body', m.body, 'contact', m.contact, 'receivedAt', m.created_at)
                                      ORDER BY m.created_at)
                        FROM qr_messages m WHERE m.tag_id = t.tag_id), '[]') AS messages
       FROM qr_tags t WHERE t.owner_id = $1 ORDER BY t.created_at`,
    [id],
  );
  return {
    exportedAt: new Date().toISOString(),
    about: 'The personal data FoundU holds about you (FR-17.6).  Other users\' personal data is left out.',
    profile, posts, claims, messages, contacts, notifications, karma, reports, tags,
  };
}

/** NFR-22 (right to rectification): the user corrects their name, display name and campus. */
async function correctProfile(user, { fullName, displayName, campusId }) {
  if (campusId !== undefined) {
    const { rowCount } = await query('SELECT 1 FROM campuses WHERE campus_id = $1 AND organization_id = $2', [campusId, user.organization_id]);
    if (!rowCount) throw badRequest('Choose a campus of your organization.', { fields: { campusId: 'Choose a campus of your organization.' } });
  }
  const { rows: [u] } = await query(
    `UPDATE users SET full_name = coalesce($2, full_name), display_name = coalesce($3, display_name),
                      campus_id = coalesce($4, campus_id)
      WHERE user_id = $1 RETURNING full_name AS "fullName", display_name AS "displayName", campus_id AS "campusId"`,
    [user.user_id, fullName ?? null, displayName ?? null, campusId ?? null],
  );
  return u;
}

/**
 * FR-17.7: deletes the user's personal data at once (well within 30 days).  Posts are kept only anonymized, for the
 * organization's statistics, as after the retention period (FR-17.5).  Refused while a handover is under way, because
 * the other party is waiting for the item.
 */
async function deleteData(user) {
  const id = user.user_id;
  const busy = await rowsOf(
    `SELECT p.title FROM claims c JOIN posts p USING (post_id)
      WHERE c.status = 'APPROVED' AND (c.claimant_id = $1 OR p.owner_id = $1)`,
    [id],
  );
  if (busy.length) {
    throw conflict(`Finish or cancel your handovers first: ${busy.map((b) => `"${b.title}"`).join(', ')}.`);
  }
  const now = new Date();
  const files = await transaction(async (db) => {
    const removed = [];
    const { rows: posts } = await db.query('SELECT post_id, status FROM posts WHERE owner_id = $1 FOR UPDATE', [id]);
    for (const p of posts) {
      if (['OPEN', 'RETURNED'].includes(p.status)) {
        await db.query(`UPDATE posts SET status = 'CLOSED', closed_at = $2, updated_at = $2 WHERE post_id = $1`, [p.post_id, now]);
      }
      const { rows: waiting } = await db.query(
        `UPDATE claims c SET status = 'REJECTED', rejection_reason = $2, decided_at = $3, auto_rejected = true
           FROM posts p WHERE p.post_id = c.post_id AND c.post_id = $1 AND c.status = 'PENDING'
         RETURNING c.claimant_id, c.claim_id, p.title`,
        [p.post_id, 'The owner deleted their data, so the post was closed.', now]);
      for (const w of waiting) {
        await notify(w.claimant_id, 'CLAIM_REJECTED', `Your claim on "${w.title}" was closed: its owner deleted their data.`,
          { claimId: w.claim_id, db });
      }
      removed.push(...(await anonymizePost(db, p.post_id, now, DELETED_TEXT)));
    }
    await db.query(`UPDATE claims SET status = 'WITHDRAWN', decided_at = $2 WHERE claimant_id = $1 AND status = 'PENDING'`, [id, now]);
    await db.query(
      `UPDATE claims SET claimant_id = NULL, answer_text = $2::text, description = NULL,
                         cancel_reason = CASE WHEN cancel_reason IS NOT NULL THEN $2::text END,
                         handover_code_enc = NULL, handover_code_hash = NULL
        WHERE claimant_id = $1`,
      [id, DELETED_TEXT],
    );
    await db.query('UPDATE messages SET sender_id = NULL, body = $2 WHERE sender_id = $1', [id, DELETED_TEXT]);
    await db.query('UPDATE post_contacts SET sender_id = NULL, body = $2 WHERE sender_id = $1', [id, DELETED_TEXT]);
    await db.query('UPDATE post_history SET editor_id = NULL WHERE editor_id = $1', [id]);
    await db.query('UPDATE reports SET reporter_id = NULL, details = NULL WHERE reporter_id = $1', [id]);
    await db.query('DELETE FROM notifications WHERE user_id = $1', [id]);
    await db.query('DELETE FROM karma_events WHERE user_id = $1', [id]);
    const { rows: tags } = await db.query('DELETE FROM qr_tags WHERE owner_id = $1 RETURNING photo_path', [id]);
    removed.push(...tags.filter((t) => t.photo_path).map((t) => ({ storage_path: t.photo_path })));
    await db.query('DELETE FROM otp_codes WHERE lower(email) = lower($1)', [user.email]);
    await db.query(
      `UPDATE users SET email = $2, full_name = 'Deleted user', display_name = 'Deleted user', campus_id = NULL,
                        status = 'DELETED', karma_points = 0, email_notifications = false, hide_from_leaderboard = true
        WHERE user_id = $1`,
      [id, `deleted-${id}@deleted.invalid`],
    );
    await db.query(
      `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason)
       VALUES ($1, NULL, 'DATA_DELETED', 'USER', $2, 'Personal data deleted at the user''s request (FR-17.7)')`,
      [user.organization_id, id],
    );
    return removed;
  });
  for (const f of files) await storage.remove(f.storage_path, f.blurred_path); // after the commit; gone before the answer
  return { deleted: true };
}

module.exports = { exportData, correctProfile, deleteData, DELETED_TEXT };
