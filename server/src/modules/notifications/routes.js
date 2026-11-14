const express = require('express');
const { z } = require('zod');
const { query } = require('../../db/pool');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.get('/notifications', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT notification_id AS id, type, content, link, is_read AS "isRead", created_at AS "createdAt"
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.user_id],
  );
  const unread = (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user.user_id])).rows[0].n;
  res.json({ notifications: rows, unread }); // FR-8.3
});

router.post('/notifications/read', requireAuth, async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).parse(req.body);
  if (ids) await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND notification_id = ANY ($2)', [req.user.user_id, ids]);
  else await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.user_id]); // FR-8.4
  res.json({ ok: true });
});

module.exports = router;
