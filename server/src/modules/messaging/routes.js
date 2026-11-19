const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();
const id = z.coerce.number().int().positive();

router.get('/conversations', requireAuth, async (req, res) => {
  res.json({ conversations: await service.list(req.user) });
});

// FR-7.4: the client polls with ?after=<last message id> every few seconds
router.get('/conversations/:id', requireAuth, async (req, res) => {
  const after = z.coerce.number().int().min(0).default(0).parse(req.query.after ?? 0);
  res.json({ conversation: await service.get(req.user, id.parse(req.params.id), after) });
});

router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  const { body } = z
    .object({ body: z.string({ error: 'Write a message.' }).trim().min(1, 'Write a message.').max(1000, 'At most 1,000 characters.') })
    .parse(req.body); // FR-7.3
  res.status(201).json({ message: await service.send(req.user, id.parse(req.params.id), body) });
});

router.post('/messages/:id/report', requireAuth, async (req, res) => {
  const input = z
    .object({
      reason: z.enum(['SPAM', 'FRAUD', 'INAPPROPRIATE', 'PERSONAL_DATA', 'OTHER'], { error: 'Choose a reason.' }), // FR-15.2
      details: z.string().trim().max(500, 'At most 500 characters.').optional(),
    })
    .parse(req.body);
  await service.report(req.user, id.parse(req.params.id), input);
  res.status(201).json({ ok: true });
});

module.exports = router;
