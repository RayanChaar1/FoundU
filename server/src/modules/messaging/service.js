/* Private Messaging module (Table 7, FR-7): one conversation per approved claim, between the claimant (the owner of
   the item) and the finder.  A conversation is identified by its claim. */
const { query } = require('../../db/pool');
const { badgesOf } = require('../search/repository');
const { notify } = require('../notifications/service');
const events = require('../../lib/events');
const { forbidden, notFound, conflict, badRequest } = require('../../lib/errors');

const ADMINS = ['ORG_ADMIN', 'PLATFORM_ADMIN'];

// A claim has a conversation once approved (FR-6.12, FR-7.1); it stays readable after the handover or its cancellation
const HAS_CONVERSATION = `(c.status IN ('APPROVED', 'COMPLETED') OR (c.status = 'WITHDRAWN' AND c.cancel_reason IS NOT NULL))`;

async function conversation(user, claimId) {
  const { rows } = await query(
    `SELECT c.claim_id, c.status, c.claimant_id, p.owner_id, p.post_id, p.title, p.status AS post_status,
            cu.display_name AS claimant_name, ou.display_name AS finder_name
       FROM claims c JOIN posts p USING (post_id)
       LEFT JOIN users cu ON cu.user_id = c.claimant_id LEFT JOIN users ou ON ou.user_id = p.owner_id
      WHERE c.claim_id = $1 AND p.organization_id = $2 AND ${HAS_CONVERSATION}`,
    [claimId, user.organization_id],
  );
  const conv = rows[0];
  if (!conv) throw notFound('This conversation does not exist.');
  return conv;
}

const isParticipant = (user, conv) => [conv.claimant_id, conv.owner_id].includes(user.user_id);

/** FR-7.6: messages can be sent only while the handover is in progress (post Claimed). */
const isReadOnly = (conv) => !(conv.status === 'APPROVED' && conv.post_status === 'CLAIMED');

/** FR-7.2: participants read the conversation; an administrator only while investigating a report on it (logged). */
async function checkAccess(user, conv) {
  if (isParticipant(user, conv)) return;
  if (ADMINS.includes(user.role)) {
    const reported = await query(
      `SELECT 1 FROM reports r JOIN messages m USING (message_id) WHERE m.claim_id = $1 LIMIT 1`,
      [conv.claim_id],
    );
    if (reported.rowCount) {
      await query(
        `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'CONVERSATION_READ', 'CONVERSATION', $3, 'Investigating a reported message')`,
        [user.organization_id, user.user_id, conv.claim_id],
      );
      return;
    }
  }
  throw forbidden('Only the two participants can read this conversation.');
}

/** FR-7.5: participants are identified by display name and badges only, never by email address or phone number. */
async function participants(user, conv) {
  const people = [
    { userId: conv.claimant_id, displayName: conv.claimant_name || 'Former user', role: 'Owner' },
    { userId: conv.owner_id, displayName: conv.finder_name || 'Former user', role: 'Finder' },
  ];
  return Promise.all(people.map(async (p) => ({
    displayName: p.displayName,
    role: p.role,
    isMe: p.userId === user.user_id,
    badges: p.userId ? await badgesOf(p.userId) : [],
  })));
}

async function list(user) {
  const { rows } = await query(
    `SELECT c.claim_id AS id, p.post_id AS "postId", p.title AS "postTitle", c.status, p.status AS post_status,
            CASE WHEN c.claimant_id = $1 THEN ou.display_name ELSE cu.display_name END AS "otherName",
            (SELECT body FROM messages m WHERE m.claim_id = c.claim_id ORDER BY m.sent_at DESC LIMIT 1) AS "lastMessage",
            (SELECT max(sent_at) FROM messages m WHERE m.claim_id = c.claim_id) AS "lastAt",
            (SELECT count(*)::int FROM messages m WHERE m.claim_id = c.claim_id AND m.sender_id <> $1 AND NOT m.is_read) AS unread
       FROM claims c JOIN posts p USING (post_id)
       LEFT JOIN users cu ON cu.user_id = c.claimant_id LEFT JOIN users ou ON ou.user_id = p.owner_id
      WHERE p.organization_id = $2 AND (c.claimant_id = $1 OR p.owner_id = $1) AND ${HAS_CONVERSATION}
      ORDER BY coalesce((SELECT max(sent_at) FROM messages m WHERE m.claim_id = c.claim_id), c.decided_at) DESC`,
    [user.user_id, user.organization_id],
  );
  return rows.map(({ status, post_status: postStatus, ...r }) => ({
    ...r,
    otherName: r.otherName || 'Former user',
    readOnly: isReadOnly({ status, post_status: postStatus }),
  }));
}

/** Messages of a conversation; `after` returns only newer ones (polling, FR-7.4).  Marks the other's messages read. */
async function get(user, claimId, after = 0) {
  const conv = await conversation(user, claimId);
  await checkAccess(user, conv);
  const { rows } = await query(
    `SELECT m.message_id AS id, m.body, m.sent_at AS "sentAt", m.sender_id = $2 AS mine, u.display_name AS "senderName"
       FROM messages m LEFT JOIN users u ON u.user_id = m.sender_id
      WHERE m.claim_id = $1 AND m.message_id > $3 ORDER BY m.message_id`,
    [claimId, user.user_id, after],
  );
  if (isParticipant(user, conv)) {
    await query('UPDATE messages SET is_read = true WHERE claim_id = $1 AND sender_id <> $2 AND NOT is_read', [claimId, user.user_id]);
  }
  return {
    id: conv.claim_id,
    postId: conv.post_id,
    postTitle: conv.title,
    readOnly: isReadOnly(conv),
    canWrite: isParticipant(user, conv) && !isReadOnly(conv),
    participants: await participants(user, conv),
    messages: rows.map((m) => ({ ...m, senderName: m.senderName || 'Former user' })),
  };
}

/** FR-7.3: text messages of 1 to 1,000 characters; the other participant is notified (emails throttled, FR-8.5). */
async function send(user, claimId, body) {
  const conv = await conversation(user, claimId);
  if (!isParticipant(user, conv)) throw forbidden('Only the two participants can write in this conversation.');
  if (isReadOnly(conv)) throw conflict('This conversation is read-only because the item was returned or the handover ended.');
  const { rows } = await query(
    `INSERT INTO messages (claim_id, sender_id, body) VALUES ($1, $2, $3)
     RETURNING message_id AS id, body, sent_at AS "sentAt", true AS mine`,
    [claimId, user.user_id, body],
  );
  const other = user.user_id === conv.claimant_id ? conv.owner_id : conv.claimant_id;
  await notify(other, 'MESSAGE', `New message from ${user.display_name} about "${conv.title}"`, {
    link: `/conversations/${claimId}`,
    claimId,
  });
  return { ...rows[0], senderName: user.display_name };
}

/** FR-7.7: a participant reports a message of the other participant to the moderators (FR-15). */
async function report(user, messageId, { reason, details }) {
  const { rows } = await query(
    `SELECT m.message_id, m.sender_id, m.claim_id FROM messages m JOIN claims c USING (claim_id) JOIN posts p USING (post_id)
      WHERE m.message_id = $1 AND p.organization_id = $2`,
    [messageId, user.organization_id],
  );
  const message = rows[0];
  if (!message) throw notFound('This message does not exist.');
  const conv = await conversation(user, message.claim_id);
  if (!isParticipant(user, conv)) throw forbidden('Only the participants of the conversation can report its messages.');
  if (message.sender_id === user.user_id) throw badRequest('You cannot report your own message.');
  const existing = await query('SELECT 1 FROM reports WHERE message_id = $1 AND reporter_id = $2', [messageId, user.user_id]);
  if (existing.rowCount) throw conflict('You already reported this message.');
  const inserted = await query(
    `INSERT INTO reports (organization_id, reporter_id, message_id, reason, details) VALUES ($1, $2, $3, $4, $5)
     RETURNING report_id`,
    [user.organization_id, user.user_id, messageId, reason, details || null],
  );
  events.emit('report.created', { reportId: inserted.rows[0].report_id, messageId, organizationId: user.organization_id });
}

module.exports = { list, get, send, report };
