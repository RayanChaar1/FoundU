/* FoundU QR tags API (FR-12).
   - The owner's routes need a session and work only on the owner's own tags (403 otherwise).
   - The finder's routes (GET /tags/:token, POST /tags/:token/messages) are public: scanning needs no account (FR-12.4). */
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const service = require('./service');
const { requireAuth } = require('../../middleware/auth');
const { badRequest, forbidden, notFound } = require('../../lib/errors');

const router = express.Router();
const id = z.coerce.number().int().positive();
const text = (max, message) => z.string({ error: message }).trim().min(1, message).max(max, `At most ${max} characters.`);

// A token is 22 or more base64url characters; anything else is not looked up at all
const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
const token = z.string().regex(TOKEN, 'Tag not found.');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const photo = (req, res, next) =>
  upload.single('photo')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest('One photo at most.'));
    next(err);
  });

const tagSchema = z.object({
  label: text(80, 'Enter a label, for example "Black laptop".'),
  categoryId: id.optional().or(z.literal('').transform(() => undefined)),
});
const messageSchema = z.object({
  message: text(500, 'Write a message to the owner.'),
  contact: z.string().trim().max(200, 'At most 200 characters.').optional().or(z.literal('').transform(() => undefined)),
});
const idList = z.string().regex(/^\d+(,\d+)*$/).transform((s) => s.split(',').map(Number)).optional().catch(undefined);

// ------------------------------------------------------------------------------------------- the owner

router.get('/tags', requireAuth, async (req, res) => res.json({ tags: await service.list(req.user) }));

router.post('/tags', requireAuth, photo, async (req, res) => {
  res.status(201).json(await service.create(req.user, tagSchema.parse(req.body), req.file));
});

/** FR-12.3: the sticker sheet of the signed-in user.  Asking for another user's sheet is refused (TC-FR-12.3-D). */
router.get('/tags/sheet', requireAuth, async (req, res) => {
  if (req.query.user !== undefined && Number(req.query.user) !== req.user.user_id) {
    throw forbidden('You can only print your own stickers.');
  }
  const pdf = await service.stickerSheet(req.user, idList.parse(req.query.ids));
  res.set('Cache-Control', 'private, no-store');
  res.type('application/pdf').set('Content-Disposition', 'inline; filename="foundu-stickers.pdf"').send(pdf);
});

router.get('/tags/:id/messages', requireAuth, async (req, res) => {
  res.json({ messages: await service.messages(req.user, id.parse(req.params.id)) });
});
router.get('/tags/:id/qr.svg', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.type('image/svg+xml').send(await service.qrSvg(req.user, id.parse(req.params.id)));
});
router.get('/tags/:id/photo', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.type('image/webp').sendFile(await service.photoPath(req.user, id.parse(req.params.id)));
});
router.post('/tags/:id/deactivate', requireAuth, async (req, res) => {
  res.json(await service.setActive(req.user, id.parse(req.params.id), false)); // FR-12.10
});
router.post('/tags/:id/activate', requireAuth, async (req, res) => {
  res.json(await service.setActive(req.user, id.parse(req.params.id), true)); // FR-12.11
});
router.delete('/tags/:id', requireAuth, async (req, res) => {
  await service.remove(req.user, id.parse(req.params.id));
  res.status(204).end();
});

// ------------------------------------------------------------------------------------------ the finder

const tokenOf = (req) => {
  const r = token.safeParse(req.params.token);
  if (!r.success) throw notFound('Tag not found.');
  return r.data;
};

router.get('/tags/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await service.publicTag(tokenOf(req)));
});

router.post('/tags/:token/messages', async (req, res) => {
  const t = tokenOf(req);
  const body = messageSchema.parse(req.body);
  res.status(201).json(await service.sendMessage(t, body, service.deviceHash(req.ip, req.get('user-agent'))));
});

module.exports = router;
