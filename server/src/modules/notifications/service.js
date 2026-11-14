/* Notifications module (Table 7, FR-8).  Foundation used by every other module: creates the in-application
   notification; a sweep emails it when the user has enabled email notifications (FR-1.11, FR-8.2). */
const { query } = require('../../db/pool');
const { sendMail } = require('../../lib/mailer');
const config = require('../../config');

/**
 * Notifies one user.  `db` lets callers notify inside their own transaction: the email sweep only sees the
 * notification once that transaction has committed.
 * type: MATCH, CLAIM_RECEIVED, CLAIM_APPROVED, CLAIM_REJECTED, MESSAGE, HANDOVER, BADGE, MODERATION, CONTACT,
 *       QR_MESSAGE, CODE_BLOCKED, HANDOVER_CANCELLED
 */
async function notify(userId, type, content, { link = null, claimId = null, db = { query } } = {}) {
  if (!userId) return null;
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, type, content, link, claim_id) VALUES ($1, $2, $3, $4, $5)
     RETURNING notification_id`,
    [userId, type, content.slice(0, 500), link, claimId],
  );
  return rows[0].notification_id;
}

/** Notifies several users with the same content. */
async function notifyAll(userIds, type, content, options) {
  for (const id of new Set(userIds)) await notify(id, type, content, options);
}

/**
 * FR-8.2: emails every new notification of users who enabled email notifications.  Runs every 20 seconds,
 * so each email leaves within 2 minutes.  FR-8.5: at most one email per conversation every 15 minutes.
 */
async function sendPendingEmails() {
  const { rows } = await query(
    `SELECT n.notification_id, n.user_id, n.type, n.content, n.link, n.claim_id, u.email,
            u.email_notifications AND u.status = 'ACTIVE' AS wanted
       FROM notifications n JOIN users u USING (user_id)
      WHERE NOT n.email_checked ORDER BY n.notification_id LIMIT 200`,
  );
  let sent = 0;
  for (const n of rows) {
    let send = n.wanted;
    if (send && n.type === 'MESSAGE' && n.claim_id) {
      const recent = await query(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND claim_id = $2 AND type = 'MESSAGE'
            AND emailed_at > now() - interval '15 minutes'`,
        [n.user_id, n.claim_id],
      );
      send = recent.rowCount === 0;
    }
    if (send) {
      await sendMail({
        to: n.email,
        subject: `FoundU: ${n.content.length > 70 ? `${n.content.slice(0, 67)}...` : n.content}`,
        text: `${n.content}\n\n${n.link ? `Open: ${config.clientUrl}${n.link}\n\n` : ''}You can turn off email notifications in your profile.`,
      });
      sent += 1;
    }
    await query(
      `UPDATE notifications SET email_checked = true, emailed_at = CASE WHEN $2 THEN now() END WHERE notification_id = $1`,
      [n.notification_id, send],
    );
  }
  return sent;
}

/** Active security officers (and optionally administrators) of an organization, e.g. for drop-off claims (FR-6.6). */
async function staffOf(organizationId, roles = ['SECURITY']) {
  const { rows } = await query(
    `SELECT user_id FROM users WHERE organization_id = $1 AND role = ANY ($2) AND status = 'ACTIVE'`,
    [organizationId, roles],
  );
  return rows.map((r) => r.user_id);
}

module.exports = { notify, notifyAll, sendPendingEmails, staffOf };
