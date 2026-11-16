const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { maxScore } = require('./score');
const { requireAuth, requireRole } = require('../../middleware/auth');

const router = express.Router();
const id = z.coerce.number().int().positive();

router.get('/posts/:id/matches', requireAuth, async (req, res) => {
  res.json({ matches: await service.listFor(req.user, id.parse(req.params.id)) });
});

router.post('/matches/:id/dismiss', requireAuth, async (req, res) => {
  await service.dismiss(req.user, id.parse(req.params.id));
  res.json({ ok: true });
});

const points = (label) => z.number({ error: `${label}: enter a whole number.` }).int(`${label}: enter a whole number.`)
  .min(0, `${label} cannot be negative.`).max(100, `${label}: at most 100.`);
const threshold = (label) => z.number({ error: `${label}: enter a number from 0 to 100.` }).int().min(0, `${label}: from 0 to 100.`).max(100, `${label}: from 0 to 100.`);

// FR-5.8, FR-5.9: thresholds from 0 to 100; weights never negative and never able to exceed a score of 100
const settings = z
  .object({
    matchThreshold: threshold('Match threshold'),
    possibleThreshold: threshold('Possible-match threshold'),
    weights: z.object({
      category: points('Same category'),
      building: points('Same building'),
      campus: points('Same campus'),
      date1: points('Dates within 1 day'),
      date3: points('Dates 2 to 3 days apart'),
      date7: points('Dates 4 to 7 days apart'),
      keywords: points('Keyword similarity'),
    }).strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.possibleThreshold > v.matchThreshold) {
      ctx.addIssue({ code: 'custom', path: ['possibleThreshold'], message: 'The possible-match threshold cannot exceed the match threshold.' });
    }
    const max = maxScore(v.weights);
    if (max > 100) {
      ctx.addIssue({ code: 'custom', path: ['weights'], message: `The weights can add up to at most 100; these reach ${max}.` });
    }
  });

router.get('/admin/matching', requireRole('admin'), async (req, res) => res.json(await service.getSettings(req.user)));
router.put('/admin/matching', requireRole('admin'), async (req, res) => {
  res.json(await service.updateSettings(req.user, settings.parse(req.body)));
});

module.exports = router;
