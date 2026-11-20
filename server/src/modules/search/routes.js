/* Search and Map module (Table 7): feed, keyword search, filters, post details, photos. */
const express = require('express');
const { z } = require('zod');
const repo = require('./repository');
const { requireAuth, isStaff } = require('../../middleware/auth');
const { decrypt } = require('../../lib/crypto');
const storage = require('../../lib/storage');
const { notFound } = require('../../lib/errors');

const router = express.Router();
const id = z.coerce.number().int().positive();
const optionalId = id.optional().or(z.literal('').transform(() => undefined));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined));

const searchSchema = z.object({
  q: z.string().trim().max(100, 'Search with at most 100 characters.').optional().transform((v) => v || undefined),
  type: z.enum(['LOST', 'FOUND']).optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['OPEN', 'CLAIMED', 'RETURNED', 'CLOSED']).optional().or(z.literal('').transform(() => undefined)),
  categoryId: optionalId,
  campusId: optionalId,
  locationId: optionalId,
  from: day,
  to: day,
  page: z.coerce.number().int().min(1).max(1000).default(1),
}).refine((f) => !f.from || !f.to || f.to >= f.from, { path: ['to'], message: 'The end date is before the start date.' }); // FR-4.4

router.get('/posts', requireAuth, async (req, res) => {
  const filters = searchSchema.parse(req.query);
  res.json(await repo.searchPosts(req.user.organization_id, filters, { staff: isStaff(req.user), userId: req.user.user_id }));
});

/** FR-4.7, FR-4.8, FR-3.8: public information of a post; the expected answer is never sent (FR-3.5). */
router.get('/posts/:id', requireAuth, async (req, res) => {
  const p = await repo.postDetail(req.user.organization_id, id.parse(req.params.id));
  const staff = isStaff(req.user);
  const isOwner = p?.owner_id === req.user.user_id;
  if (!p || (p.status === 'REMOVED' && !staff && !isOwner) || (p.is_hidden && !staff && !isOwner)) {
    throw notFound('This post does not exist.');
  }
  const post = {
    id: p.post_id,
    type: p.type,
    title: p.title,
    description: p.description,
    status: p.status,
    hidden: p.is_hidden,
    sensitive: p.is_sensitive,
    category: p.category,
    categoryId: p.category_id,
    campus: p.campus,
    campusId: p.campus_id,
    building: p.building,
    locationId: p.location_id,
    coordinates: [Number(p.latitude), Number(p.longitude)],
    eventDatetime: p.event_datetime,
    createdAt: p.created_at,
    poster: p.poster ? { id: p.poster_id, displayName: p.poster, badges: await repo.badgesOf(p.poster_id) } : { displayName: 'Former user', badges: [] },
    photoIds: await repo.photoIds(p.post_id),
    isOwner,
  };
  if (p.type === 'FOUND') {
    post.whereabouts = p.whereabouts;
    post.verificationQuestion = p.verification_question;
    if (p.dropoff_id) {
      post.dropoff = { id: p.dropoff_id, name: p.dropoff_name, building: p.dropoff_building, openingHours: p.dropoff_hours, contactNumber: p.dropoff_contact };
    }
    if (isOwner) post.verificationAnswer = decrypt(p.verification_answer_enc); // only the finder sees it (FR-3.5)
  }
  res.json({ post });
});

/** Serves a photo; sensitive photos are blurred except for the poster, the approved claimant, and staff (FR-17.2). */
router.get('/photos/:id', requireAuth, async (req, res) => {
  const photo = await repo.photoWithPost(id.parse(req.params.id));
  if (!photo || photo.organization_id !== req.user.organization_id) throw notFound();
  let file = photo.storage_path;
  if (photo.is_sensitive && photo.blurred_path) {
    const clear = photo.owner_id === req.user.user_id || isStaff(req.user)
      || (await repo.isApprovedClaimant(photo.post_id, req.user.user_id));
    if (!clear) file = photo.blurred_path;
  }
  res.set('Cache-Control', 'private, no-store');
  res.type('image/webp').sendFile(storage.filePath(file));
});

module.exports = router;
