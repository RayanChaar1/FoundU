/* Personal data rights (FR-17.6, FR-17.7, NFR-22): download, correct and delete my data. */
const { Router } = require('express');
const { z } = require('zod');
const { requireAuth, endSession } = require('../../middleware/auth');
const service = require('./service');

const router = Router();

// FR-17.6: a JSON file the user can save and reuse (right to portability)
router.get('/me/data', requireAuth, async (req, res) => {
  const data = await service.exportData(req.user);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', 'attachment; filename="foundu-my-data.json"');
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

// NFR-22: correct the profile
router.patch('/me/profile', requireAuth, async (req, res) => {
  const body = z.object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(100, 'At most 100 characters.').optional(),
    displayName: z.string().trim().min(2, 'Enter a display name of at least 2 characters.').max(60, 'At most 60 characters.').optional(),
    campusId: z.coerce.number().int().positive('Choose your campus.').optional(),
  }).parse(req.body);
  res.json({ user: await service.correctProfile(req.user, body) });
});

// FR-17.7: delete my data; the user types DELETE to confirm
router.delete('/me', requireAuth, async (req, res) => {
  z.object({ confirm: z.literal('DELETE', { error: 'Type DELETE to confirm.' }) }).parse(req.body ?? {});
  const result = await service.deleteData(req.user);
  endSession(res);
  res.json(result);
});

module.exports = router;
