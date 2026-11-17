/* FR-17.5: the personal data of a post is removed once it has been closed for the retention period of its organization
   (12 months by default, FR-16.8).  What stays is what statistics need: type, category, building, dates and status.
   Open, claimed and returned posts are never touched. */
const { query, transaction } = require('../../db/pool');
const storage = require('../../lib/storage');

const REMOVED = 'Removed after the retention period.';

/** Anonymizes every post closed for longer than its organization's retention period at `now`.  Returns their ids. */
async function anonymizeExpired(now = new Date()) {
  const { rows } = await query(
    `SELECT p.post_id FROM posts p JOIN organizations o USING (organization_id)
      WHERE p.status = 'CLOSED' AND p.anonymized_at IS NULL AND p.closed_at IS NOT NULL
        AND p.closed_at <= $1::timestamptz - make_interval(months => o.retention_months)
      ORDER BY p.post_id LIMIT 500`,
    [now],
  );
  const done = [];
  for (const { post_id: id } of rows) {
    const files = await transaction(async (db) => {
      await db.query(
        `UPDATE posts
            SET owner_id = NULL,
                title = CASE type WHEN 'LOST' THEN 'Lost item' ELSE 'Found item' END,
                description = '',
                verification_question = CASE type WHEN 'FOUND' THEN 'Removed' END,
                verification_answer_enc = CASE type WHEN 'FOUND' THEN '' END,
                anonymized_at = $2
          WHERE post_id = $1`,
        [id, now],
      );
      const { rows: photos } = await db.query('DELETE FROM photos WHERE post_id = $1 RETURNING storage_path, blurred_path', [id]);
      await db.query('DELETE FROM post_history WHERE post_id = $1', [id]); // older titles and descriptions
      await db.query(`UPDATE post_contacts SET sender_id = NULL, body = $2 WHERE post_id = $1`, [id, REMOVED]);
      await db.query(
        `UPDATE claims SET claimant_id = NULL, answer_text = $2::text, description = NULL,
                           rejection_reason = CASE WHEN rejection_reason IS NOT NULL THEN $2::text END,
                           cancel_reason = CASE WHEN cancel_reason IS NOT NULL THEN $2::text END, handover_code_enc = NULL, handover_code_hash = NULL
          WHERE post_id = $1`,
        [id, REMOVED],
      );
      await db.query(
        `UPDATE messages SET sender_id = NULL, body = $2 WHERE claim_id IN (SELECT claim_id FROM claims WHERE post_id = $1)`,
        [id, REMOVED],
      );
      return photos;
    });
    for (const p of files) storage.remove(p.storage_path, p.blurred_path); // after the commit
    done.push(id);
  }
  return done;
}

module.exports = { anonymizeExpired, REMOVED };
