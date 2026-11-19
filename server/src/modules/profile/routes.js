const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.get('/me/activity', requireAuth, async (req, res) => res.json(await service.activity(req.user)));

router.get('/users/:id', requireAuth, async (req, res) => {
  res.json({ profile: await service.profile(req.user, z.coerce.number().int().positive().parse(req.params.id)) });
});

module.exports = router;
