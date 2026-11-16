const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const id = z.coerce.number().int().positive();
const reason = (message) => z.object({ reason: z.string({ error: message }).trim().min(1, message).max(500, 'At most 500 characters.') });

const claimBody = z.object({
  answer: z.string({ error: 'Answer the verification question.' }).trim().min(1, 'Answer the verification question.').max(500, 'At most 500 characters.'),
  description: z.string().trim().max(1000, 'At most 1,000 characters.').optional().or(z.literal('')), // FR-6.2
});

router.post('/posts/:id/claims', requireAuth, async (req, res) => {
  const claim = await service.submit(req.user, id.parse(req.params.id), claimBody.parse(req.body));
  res.status(201).json({ claim: await service.get(req.user, claim.claim_id) });
});

router.get('/posts/:id/claims', requireAuth, async (req, res) => {
  res.json({ claims: await service.listForPost(req.user, id.parse(req.params.id)) });
});

router.post('/posts/:id/contact', requireAuth, async (req, res) => {
  const { message } = z
    .object({ message: z.string({ error: 'Write a message.' }).trim().min(1, 'Write a message.').max(1000, 'At most 1,000 characters.') })
    .parse(req.body);
  await service.contact(req.user, id.parse(req.params.id), message);
  res.status(201).json({ ok: true });
});

router.get('/posts/:id/contacts', requireAuth, async (req, res) => {
  res.json({ contacts: await service.contacts(req.user, id.parse(req.params.id)) });
});

router.get('/claims', requireAuth, async (req, res) => res.json({ claims: await service.list(req.user) }));

router.get('/claims/:id', requireAuth, async (req, res) => res.json({ claim: await service.get(req.user, id.parse(req.params.id)) }));

router.post('/claims/:id/approve', requireAuth, async (req, res) => {
  res.json({ claim: await service.approve(req.user, id.parse(req.params.id)) });
});

router.post('/claims/:id/reject', requireAuth, async (req, res) => {
  const { reason: why } = reason('Give a reason for the rejection.').parse(req.body); // FR-6.9
  res.json({ claim: await service.reject(req.user, id.parse(req.params.id), why) });
});

router.post('/claims/:id/withdraw', requireAuth, async (req, res) => {
  res.json({ claim: await service.withdraw(req.user, id.parse(req.params.id)) });
});

router.post('/claims/:id/handover', requireAuth, async (req, res) => {
  const { code } = z.object({ code: z.string({ error: 'Enter the 4-digit code.' }).trim().regex(/^\d{4}$/, 'Enter the 4-digit code.') }).parse(req.body);
  res.json({ claim: await service.confirmHandover(req.user, id.parse(req.params.id), code) });
});

router.post('/claims/:id/cancel', requireAuth, async (req, res) => {
  const { reason: why } = reason('Give a reason for cancelling the handover.').parse(req.body); // FR-9.10
  res.json({ claim: await service.cancelHandover(req.user, id.parse(req.params.id), why) });
});

module.exports = router;
