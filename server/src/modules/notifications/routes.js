const express = require('express');
const { z } = require('zod');
const { query } = require('../../db/pool');
const { requireAuth } = require('../../middleware/auth');
const { forbidden, notFound } = require('../../lib/errors');

const router = express.Router();
const id = z.coerce.number().int().positive();

const unreadCount = async (userId) =>
  (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [userId])).rows[0].n;

// FR-8.3: the latest notifications and the number of unread ones
router.get('/notifications', requireAuth, async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit ?? 30);
  const { rows } = await query(
    `SELECT notification_id AS id, type, content, link, is_read AS "isRead", created_at AS "createdAt"
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, notification_id DESC LIMIT $2`,
    [req.user.user_id, limit],
  );
  res.json({ notifications: rows, unread: await unreadCount(req.user.user_id) });
});

// Light endpoint polled by the bell
router.get('/notifications/unread', requireAuth, async (req, res) => {
  res.json({ unread: await unreadCount(req.user.user_id) });
});

// FR-8.4: mark one notification as read; never another user's
router.patch('/notifications/:id', requireAuth, async (req, res) => {
  const { isRead } = z.object({ isRead: z.boolean() }).strict().parse(req.body);
  const { rows } = await query('SELECT user_id FROM notifications WHERE notification_id = $1', [id.parse(req.params.id)]);
  if (!rows[0]) throw notFound('This notification does not exist.');
  if (rows[0].user_id !== req.user.user_id) throw forbidden('This notification belongs to another user.');
  await query('UPDATE notifications SET is_read = $2 WHERE notification_id = $1', [req.params.id, isRead]);
  res.json({ unread: await unreadCount(req.user.user_id) });
});

// FR-8.4: mark all (or the given) notifications as read
router.post('/notifications/read', requireAuth, async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).parse(req.body ?? {});
  if (ids) await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND notification_id = ANY ($2)', [req.user.user_id, ids]);
  else await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND NOT is_read', [req.user.user_id]);
  res.json({ unread: await unreadCount(req.user.user_id) });
});

module.exports = router;
