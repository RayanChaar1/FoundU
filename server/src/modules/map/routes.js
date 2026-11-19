const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();
const id = z.coerce.number().int().positive();

const filters = z.object({
  type: z.enum(['LOST', 'FOUND'], { error: 'The type is LOST or FOUND.' }).optional(), // FR-11.4
  categoryId: z.coerce.number({ error: 'Choose a category from the list.' })
    .int('Choose a category from the list.').positive('Choose a category from the list.').optional(), // FR-11.5
});

router.get('/campuses/:id/map', requireAuth, async (req, res) => {
  res.json(await service.markers(req.user, id.parse(req.params.id), filters.parse(req.query)));
});

router.get('/campuses/:id/hotspots', requireAuth, async (req, res) => {
  res.json(await service.hotspots(req.user, id.parse(req.params.id)));
});

module.exports = router;
