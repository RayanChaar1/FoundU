const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { query } = require('../../db/pool');
const { requireAuth } = require('../../middleware/auth');
const { forbidden, notFound } = require('../../lib/errors');

const router = express.Router();
const id = z.coerce.number().int().positive();

/** FR-18.6: nothing about karma is shown when the organization disabled it. */
const karmaEnabled = (req, res, next) => (req.user.karma_enabled ? next() : next(notFound('Karma points are disabled for your organization.')));

router.get('/leaderboard', requireAuth, karmaEnabled, async (req, res) => {
  res.json({ since: service.semesterStart(), leaders: await service.leaderboard(req.user) });
});

router.get('/me/karma', requireAuth, karmaEnabled, async (req, res) => {
  res.json(await service.mine(req.user));
});

/** FR-13.5: a user changes only their own leaderboard setting. */
router.patch('/users/:id/settings', requireAuth, async (req, res) => {
  if (id.parse(req.params.id) !== req.user.user_id) throw forbidden('You can only change your own settings.');
  const { hideFromLeaderboard } = z.object({ hideFromLeaderboard: z.boolean() }).strict().parse(req.body);
  await query('UPDATE users SET hide_from_leaderboard = $2 WHERE user_id = $1', [req.user.user_id, hideFromLeaderboard]);
  res.json({ hideFromLeaderboard });
});

module.exports = router;
