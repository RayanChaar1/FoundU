const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const service = require('./service');
const { requireAuth } = require('../../middleware/auth');
const { badRequest } = require('../../lib/errors');

const router = express.Router();

// FR-2.6: photos of at most 10 MB each, at most five per post (FR-2.3)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
const photos = (req, res, next) =>
  upload.array('photos', 5)(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest('At most 5 photos.'));
    next(err);
  });

const id = z.coerce.number().int().positive();
const text = (max, message) => z.string({ error: message }).trim().min(1, message).max(max, `At most ${max} characters.`);

/** Date (YYYY-MM-DD) and optional approximate time (HH:MM), never in the future. */
const when = {
  date: z.string({ error: 'Enter the date.' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time.').optional().or(z.literal('').transform(() => undefined)),
};
function eventDatetime(v, ctx) {
  const at = new Date(`${v.date}T${v.time || '00:00'}`);
  if (Number.isNaN(at.getTime())) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Enter a valid date.' });
  else if (at.getTime() > Date.now() + 5 * 60 * 1000) ctx.addIssue({ code: 'custom', path: ['date'], message: 'The date cannot be in the future.' });
  return at;
}

const common = {
  title: text(80, 'Enter a title.'),
  categoryId: id.or(z.literal('').transform(() => undefined)).refine(Boolean, 'Choose a category.'),
  locationId: id.or(z.literal('').transform(() => undefined)).refine(Boolean, 'Choose a building.'),
  description: z.string().trim().max(1000, 'At most 1,000 characters.').default(''),
  ...when,
};

const lostSchema = z.object(common).transform((v, ctx) => ({ ...v, eventDatetime: eventDatetime(v, ctx) }));

const foundSchema = z
  .object({
    ...common,
    whereabouts: z.enum(['FINDER', 'DROPOFF'], { error: 'Say where the item is now.' }),
    dropoffId: id.optional().or(z.literal('').transform(() => undefined)),
    verificationQuestion: text(200, 'Enter a verification question.'),
    verificationAnswer: text(200, 'Enter the expected answer.'),
  })
  .superRefine((v, ctx) => {
    if (v.whereabouts === 'DROPOFF' && !v.dropoffId) {
      ctx.addIssue({ code: 'custom', path: ['dropoffId'], message: 'Choose the drop-off point from the official list.' });
    }
  })
  .transform((v, ctx) => ({ ...v, eventDatetime: eventDatetime(v, ctx) }));

const created = (post) => ({ id: post.post_id, status: post.status, sensitive: post.is_sensitive });

router.post('/posts/lost', requireAuth, photos, async (req, res) => {
  const input = lostSchema.parse(req.body);
  res.status(201).json(created(await service.create(req.user, 'LOST', input, req.files)));
});

router.post('/posts/found', requireAuth, photos, async (req, res) => {
  const input = foundSchema.parse(req.body);
  res.status(201).json(created(await service.create(req.user, 'FOUND', input, req.files)));
});

const editSchema = z
  .object({
    title: text(80, 'Enter a title.').optional(),
    description: z.string().trim().max(1000, 'At most 1,000 characters.').optional(),
    categoryId: id.optional(),
    locationId: id.optional(),
    date: when.date.optional(),
    time: when.time,
    whereabouts: z.enum(['FINDER', 'DROPOFF']).optional(),
    dropoffId: id.nullable().optional(),
    verificationQuestion: text(200, 'Enter a verification question.').optional(),
    verificationAnswer: text(200, 'Enter the expected answer.').optional(),
    type: z.never({ error: 'The type of a post cannot be changed.' }).optional(), // FR-10.2
  })
  .strict()
  .transform((v, ctx) => {
    const { date, time, ...rest } = v;
    if (date) rest.eventDatetime = eventDatetime({ date, time }, ctx);
    return rest;
  });

router.patch('/posts/:id', requireAuth, async (req, res) => {
  const post = await service.edit(req.user, id.parse(req.params.id), editSchema.parse(req.body));
  res.json({ id: post.post_id, status: post.status });
});

router.delete('/posts/:id', requireAuth, async (req, res) => {
  await service.remove(req.user, id.parse(req.params.id));
  res.status(204).end();
});

router.post('/posts/:id/close', requireAuth, async (req, res) => {
  const post = await service.close(req.user, id.parse(req.params.id));
  res.json({ id: post.post_id, status: post.status });
});

router.post('/posts/:id/photos', requireAuth, photos, async (req, res) => {
  if (!req.files?.length) throw badRequest('Attach at least one photo.');
  await service.addPhotos(req.user, id.parse(req.params.id), req.files);
  res.status(201).json({ added: req.files.length });
});

router.delete('/posts/:id/photos/:photoId', requireAuth, async (req, res) => {
  await service.deletePhoto(req.user, id.parse(req.params.id), id.parse(req.params.photoId));
  res.status(204).end();
});

router.get('/posts/:id/history', requireAuth, async (req, res) => {
  const post = await service.ownPost(req.user, id.parse(req.params.id));
  res.json({ history: await service.history(post.post_id) });
});

module.exports = router;
