const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireAuth, requireRole } = require('../../middleware/auth');

const router = express.Router();
const id = z.coerce.number().int().positive();
const text = (max, message) => z.string({ error: message }).trim().min(1, message).max(max, `At most ${max} characters.`);
const hhmm = (message) => z.string({ error: message }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);

/** FR-14.2: every attribute is required, and the point closes after it opens. */
const pointSchema = z.object({
  name: text(80, 'Enter the name of the point.'),
  locationId: id.or(z.literal('').transform(() => undefined)).refine(Boolean, 'Choose a building.'),
  opensAt: hhmm('Enter the opening time.'),
  closesAt: hhmm('Enter the closing time.'),
  contactNumber: text(40, 'Enter a contact number.').regex(/^[0-9+()\-. a-z]+$/i, 'Enter a valid contact number.'),
}).refine((v) => v.closesAt > v.opensAt, { path: ['closesAt'], message: 'The closing time is after the opening time.' });

/** FR-14.4: the found post of a visitor's item (whereabouts and point are set by the server). */
const visitorSchema = z.object({
  title: text(80, 'Enter a title.'),
  categoryId: id.or(z.literal('').transform(() => undefined)).refine(Boolean, 'Choose a category.'),
  locationId: id.or(z.literal('').transform(() => undefined)).refine(Boolean, 'Choose a building.'),
  description: z.string().trim().max(1000, 'At most 1,000 characters.').default(''),
  date: z.string({ error: 'Enter the date.' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time.').optional().or(z.literal('').transform(() => undefined)),
  verificationQuestion: text(200, 'Enter a verification question.'),
  verificationAnswer: text(200, 'Enter the expected answer.'),
}).transform((v, ctx) => {
  const at = new Date(`${v.date}T${v.time || '00:00'}`);
  if (Number.isNaN(at.getTime())) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Enter a valid date.' });
  else if (at.getTime() > Date.now() + 5 * 60 * 1000) ctx.addIssue({ code: 'custom', path: ['date'], message: 'The date cannot be in the future.' });
  return { ...v, eventDatetime: at };
});

router.get('/dropoffs', requireAuth, async (req, res) => {
  res.json({ dropoffs: await service.list(req.user) });
});

router.post('/dropoffs', requireRole('admin'), async (req, res) => {
  res.status(201).json({ dropoff: await service.create(req.user, pointSchema.parse(req.body)) });
});

router.get('/dropoffs/:id/items', requireRole('staff'), async (req, res) => {
  res.json(await service.items(req.user, id.parse(req.params.id)));
});

router.post('/dropoffs/:id/items', requireRole('staff'), async (req, res) => {
  const { postId } = z.object({ postId: id }).parse(req.body);
  res.json(await service.receive(req.user, id.parse(req.params.id), postId));
});

router.post('/dropoffs/:id/posts', requireRole('staff'), async (req, res) => {
  const post = await service.postForVisitor(req.user, id.parse(req.params.id), visitorSchema.parse(req.body));
  res.status(201).json({ id: post.post_id, status: post.status });
});

module.exports = router;
