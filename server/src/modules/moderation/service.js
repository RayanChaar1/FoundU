/* Reporting and moderation (FR-15): reports of posts and messages, automatic hiding, the moderators' queue,
   the four actions, the author's notification, and the audit log. */
const { query, transaction } = require('../../db/pool');
const { canTransition } = require('../../lib/postStatus');
const events = require('../../lib/events');
const { notify, notifyAll, staffOf } = require('../notifications/service');
const { badRequest, forbidden, notFound, conflict } = require('../../lib/errors');

const AUTO_HIDE_REPORTERS = 3; // FR-15.3
const REMOVED_MESSAGE = 'This message was removed by a moderator.';

const audit = (db, user, action, targetType, targetId, reason) =>
  db.query(
    `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.organization_id, user.user_id ?? null, action, targetType, targetId, reason],
  );

/** FR-15.1, FR-15.2: a registered user reports another user's post or message once, with a reason from the list. */
async function report(user, { postId, messageId, reason, details }) {
  const outcome = await transaction(async (db) => {
    let authorId;
    if (postId) {
      const { rows: [p] } = await db.query(
        'SELECT owner_id, status FROM posts WHERE organization_id = $1 AND post_id = $2 FOR UPDATE', [user.organization_id, postId],
      );
      if (!p || p.status === 'REMOVED') throw notFound('This post does not exist.');
      authorId = p.owner_id;
    } else {
      const { rows: [m] } = await db.query(
        `SELECT m.sender_id, c.claimant_id, p.owner_id FROM messages m JOIN claims c USING (claim_id) JOIN posts p USING (post_id)
          WHERE p.organization_id = $1 AND m.message_id = $2`,
        [user.organization_id, messageId],
      );
      if (!m) throw notFound('This message does not exist.');
      if (![m.claimant_id, m.owner_id].includes(user.user_id)) throw forbidden('Only the participants of a conversation can report its messages.');
      authorId = m.sender_id;
    }
    if (authorId === user.user_id) throw forbidden(`You cannot report your own ${postId ? 'post' : 'message'}.`);
    const target = postId ? 'post_id' : 'message_id';
    const dup = await db.query(`SELECT 1 FROM reports WHERE ${target} = $1 AND reporter_id = $2`, [postId || messageId, user.user_id]);
    if (dup.rowCount) throw conflict(`You already reported this ${postId ? 'post' : 'message'}.`);
    const { rows: [r] } = await db.query(
      `INSERT INTO reports (organization_id, reporter_id, post_id, message_id, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING report_id`,
      [user.organization_id, user.user_id, postId || null, messageId || null, reason, details || null],
    );

    let hidden = false;
    if (postId) { // FR-15.3: three different reporters hide the post until a moderator reviews it
      const { rows: [{ n }] } = await db.query(
        `SELECT count(DISTINCT reporter_id)::int AS n FROM reports WHERE post_id = $1 AND status = 'OPEN'`, [postId],
      );
      if (n >= AUTO_HIDE_REPORTERS) {
        const { rowCount } = await db.query('UPDATE posts SET is_hidden = true, updated_at = now() WHERE post_id = $1 AND NOT is_hidden', [postId]);
        if (rowCount) {
          hidden = true;
          await audit(db, { organization_id: user.organization_id }, 'POST_AUTO_HIDDEN', 'POST', postId, `${n} users reported it`);
          await notify(authorId, 'MODERATION', 'Your post was hidden because several users reported it.  A moderator will review it.',
            { link: `/posts/${postId}`, db });
        }
      }
    }
    return { reportId: r.report_id, hidden };
  });
  events.emit('report.created', { reportId: outcome.reportId, postId, messageId, organizationId: user.organization_id });
  if (outcome.hidden) await notifyAll(await staffOf(user.organization_id), 'MODERATION', 'A post was hidden after three reports.  Open the moderation queue to review it.', { link: '/moderation' });
  return outcome;
}

/** FR-15.4: open reports of the organization, oldest first, with what was reported. */
async function queue(user, status = 'OPEN') {
  const { rows } = await query(
    `SELECT r.report_id AS id, r.reason, r.details, r.status, r.action, r.created_at AS "createdAt", r.handled_at AS "handledAt",
            ru.display_name AS reporter,
            CASE WHEN r.post_id IS NOT NULL THEN 'POST' ELSE 'MESSAGE' END AS "targetType",
            r.post_id AS "postId", p.title AS "postTitle", p.status AS "postStatus", p.is_hidden AS "postHidden",
            r.message_id AS "messageId", m.body AS "messageBody", m.claim_id AS "claimId",
            coalesce(pu.display_name, mu.display_name) AS author,
            (SELECT count(*)::int FROM reports o WHERE o.status = 'OPEN'
               AND (o.post_id = r.post_id OR o.message_id = r.message_id)) AS "openOnTarget",
            hu.display_name AS "handledBy"
       FROM reports r
       LEFT JOIN users ru ON ru.user_id = r.reporter_id
       LEFT JOIN posts p ON p.post_id = r.post_id
       LEFT JOIN users pu ON pu.user_id = p.owner_id
       LEFT JOIN messages m ON m.message_id = r.message_id
       LEFT JOIN users mu ON mu.user_id = m.sender_id
       LEFT JOIN users hu ON hu.user_id = r.handled_by
      WHERE r.organization_id = $1 AND (($2 = 'OPEN' AND r.status = 'OPEN') OR ($2 = 'CLOSED' AND r.status <> 'OPEN'))
      ORDER BY ${status === 'OPEN' ? 'r.created_at ASC' : 'r.handled_at DESC'}
      LIMIT 200`,
    [user.organization_id, status],
  );
  return rows;
}

const ACTION_TEXT = { HIDE: 'hidden', REMOVE: 'removed', WARN: 'the subject of a warning' };

/**
 * FR-15.5 to FR-15.7: a moderator decides on a report.  The decision applies to the reported content, so every open
 * report on the same post or message is closed with it.  The author is told the action and its reason; the action
 * is written to the audit log; the karma module hears about upheld reports and removals for fraud.
 */
async function act(user, reportId, { action, reason, fraud = false }) {
  const result = await transaction(async (db) => {
    const { rows: [r] } = await db.query(
      `SELECT r.*, p.owner_id AS post_owner, p.status AS post_status, p.title AS post_title, m.sender_id AS message_sender
         FROM reports r LEFT JOIN posts p ON p.post_id = r.post_id LEFT JOIN messages m ON m.message_id = r.message_id
        WHERE r.organization_id = $1 AND r.report_id = $2 FOR UPDATE OF r`,
      [user.organization_id, reportId],
    );
    if (!r) throw notFound('This report does not exist.');
    if (r.status !== 'OPEN') throw conflict('This report was already handled.');
    const isPost = Boolean(r.post_id);
    const targetId = r.post_id || r.message_id;
    const authorId = isPost ? r.post_owner : r.message_sender;
    const what = isPost ? `your post "${r.post_title}"` : 'one of your messages';

    if (action === 'HIDE') {
      if (!isPost) throw badRequest('Messages are removed, not hidden.');
      await db.query('UPDATE posts SET is_hidden = true, updated_at = now() WHERE post_id = $1', [r.post_id]);
    } else if (action === 'REMOVE') {
      if (isPost) {
        if (!canTransition(r.post_status, 'REMOVED')) throw conflict('Only open posts can be removed.  Hide this post instead.');
        await db.query(`UPDATE posts SET status = 'REMOVED', is_hidden = false, updated_at = now() WHERE post_id = $1`, [r.post_id]);
        await db.query('INSERT INTO post_history (post_id, editor_id, changes) VALUES ($1, $2, $3)',
          [r.post_id, user.user_id, { status: { from: r.post_status, to: 'REMOVED' }, reason }]);
      } else {
        await db.query('UPDATE messages SET body = $2 WHERE message_id = $1', [r.message_id, REMOVED_MESSAGE]);
      }
    } else if (action === 'DISMISS' && isPost) {
      // A post hidden only by the automatic rule becomes visible again once its reports are dismissed (FR-15.3)
      await db.query(
        `UPDATE posts SET is_hidden = false WHERE post_id = $1 AND is_hidden
            AND NOT EXISTS (SELECT 1 FROM reports WHERE post_id = $1 AND action = 'HIDE')`,
        [r.post_id],
      );
    }

    const { rows: closed } = await db.query(
      `UPDATE reports SET status = $2, action = $3, handled_by = $4, handled_at = now()
        WHERE status = 'OPEN' AND ${isPost ? 'post_id' : 'message_id'} = $1 RETURNING reporter_id`,
      [targetId, action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', action, user.user_id],
    );
    const logged = { DISMISS: 'REPORT_DISMISSED', HIDE: 'POST_HIDDEN', REMOVE: isPost ? 'POST_REMOVED' : 'MESSAGE_REMOVED', WARN: 'USER_WARNED' };
    await audit(db, user, logged[action], isPost ? 'POST' : 'MESSAGE', targetId, reason);
    if (action !== 'DISMISS') {
      await notify(authorId, 'MODERATION', `A moderator ${action === 'WARN' ? 'warned you about' : 'took action on'} ${what}: it was ${ACTION_TEXT[action]}.  Reason: ${reason}`,
        { link: isPost && action !== 'REMOVE' ? `/posts/${r.post_id}` : null, db });
    }
    return { authorId, postId: r.post_id, reporters: closed.map((c) => c.reporter_id) };
  });

  if (action !== 'DISMISS') {
    for (const reporterId of result.reporters) events.emit('report.upheld', { reporterId, postId: result.postId });
  }
  if (action === 'REMOVE') events.emit('content.removed', { authorId: result.authorId, postId: result.postId, fraud });
  return { closed: result.reporters.length };
}

/** FR-15.7: the audit log of the organization, newest first; it is never changed or deleted through the API. */
async function auditLog(user) {
  const { rows } = await query(
    `SELECT a.audit_id AS id, a.action, a.target_type AS "targetType", a.target_id AS "targetId", a.reason,
            a.created_at AS "createdAt", u.display_name AS actor
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
      WHERE a.organization_id = $1 ORDER BY a.created_at DESC, a.audit_id DESC LIMIT 300`,
    [user.organization_id],
  );
  return rows;
}

module.exports = { report, queue, act, auditLog, AUTO_HIDE_REPORTERS, REMOVED_MESSAGE };
