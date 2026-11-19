const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { HttpError } = require('../../lib/errors');

const router = express.Router();
const id = z.coerce.number().int().positive();
const REASONS = ['SPAM', 'FRAUD', 'INAPPROPRIATE', 'PERSONAL_DATA', 'OTHER']; // FR-15.2

const reportSchema = z.object({
  postId: id.optional(),
  messageId: id.optional(),
  reason: z.enum(REASONS, { error: 'Choose a reason from the list.' }),
  details: z.string().trim().max(500, 'At most 500 characters.').optional(),
}).refine((v) => Boolean(v.postId) !== Boolean(v.messageId), { path: ['postId'], message: 'Report one post or one message.' });

const actionSchema = z.object({
  action: z.enum(['DISMISS', 'HIDE', 'REMOVE', 'WARN'], { error: 'Choose dismiss, hide, remove, or warn.' }), // FR-15.5
  reason: z.string({ error: 'Give the reason for this action.' }).trim().max(500, 'At most 500 characters.'),
  fraud: z.boolean().optional(),
}).superRefine((v, ctx) => { // FR-15.6: the author is told the reason, so every action but a dismissal needs one
  if (v.action !== 'DISMISS' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give the reason for this action.' });
}).transform((v) => ({ ...v, reason: v.reason || 'Report dismissed.' }));

router.post('/reports', requireAuth, async (req, res) => {
  const { reportId, hidden } = await service.report(req.user, reportSchema.parse(req.body));
  res.status(201).json({ id: reportId, hidden });
});

router.get('/moderation/reports', requireRole('staff'), async (req, res) => {
  const status = req.query.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  res.json({ reports: await service.queue(req.user, status) });
});

router.post('/moderation/reports/:id', requireRole('staff'), async (req, res) => {
  res.json(await service.act(req.user, id.parse(req.params.id), actionSchema.parse(req.body)));
});

router.get('/audit', requireRole('admin'), async (req, res) => {
  res.json({ entries: await service.auditLog(req.user) });
});

// FR-15.7: the audit log only grows; no entry can be changed or deleted
router.all(['/audit', '/audit/:id'], requireRole('admin'), () => {
  throw new HttpError(405, 'The audit log cannot be changed.');
});

module.exports = router;
