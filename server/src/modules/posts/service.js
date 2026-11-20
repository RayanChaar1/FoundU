/* Posts module (Table 7): lost and found posts, photos, editing, closing, sensitive items, digit masking. */
const repo = require('./repository');
const { transaction } = require('../../db/pool');
const { encrypt } = require('../../lib/crypto');
const { maskDigits } = require('../../lib/mask');
const { canTransition } = require('../../lib/postStatus');
const storage = require('../../lib/storage');
const events = require('../../lib/events');
const { badRequest, forbidden, notFound, conflict } = require('../../lib/errors');

const MAX_PHOTOS = 5; // FR-2.3, FR-3.3

/** Checks that the referenced category, building, and drop-off point belong to the user's organization. */
async function resolveReferences(org, input, currentLocationId) {
  const fields = {};
  const category = input.categoryId && (await repo.getCategory(org, input.categoryId));
  if (input.categoryId && !category) fields.categoryId = 'Choose a category.';
  const location = input.locationId && (await repo.getLocation(org, input.locationId));
  if (input.locationId && !location) fields.locationId = 'Choose a building.';
  if (input.whereabouts === 'DROPOFF') {
    const dropoff = await repo.getDropoff(org, input.dropoffId);
    const where = location || (currentLocationId && (await repo.getLocation(org, currentLocationId)));
    if (!dropoff) fields.dropoffId = 'Choose the drop-off point from the official list.'; // FR-3.7
    else if (where && (await repo.getLocation(org, dropoff.location_id)).campus_id !== where.campus_id) {
      fields.dropoffId = 'Choose a drop-off point on the campus where the item was found.'; // FR-14.1
    }
  }
  if (Object.keys(fields).length) throw badRequest('Some fields are missing or invalid.', { fields });
  return { category, location };
}

/** FR-2.1 to FR-2.8, FR-3.1 to FR-3.9, FR-17.1, FR-17.4: validates, stores the photos, and publishes as Open. */
async function create(user, type, input, files = []) {
  if (files.length > MAX_PHOTOS) throw badRequest(`At most ${MAX_PHOTOS} photos.`);
  const org = user.organization_id;
  const { category } = await resolveReferences(org, input);
  const isSensitive = category.is_sensitive_default; // FR-17.1
  const description = isSensitive ? maskDigits(input.description) : input.description;
  const title = isSensitive ? maskDigits(input.title) : input.title;

  const saved = [];
  try {
    for (const file of files) saved.push(await storage.savePhoto(file, { blur: isSensitive }));
    const post = await transaction(async (db) => {
      const p = await repo.insertPost(db, {
        organizationId: org,
        ownerId: user.user_id,
        type,
        title,
        description,
        categoryId: input.categoryId,
        locationId: input.locationId,
        eventDatetime: input.eventDatetime,
        isSensitive,
        whereabouts: type === 'FOUND' ? input.whereabouts : null,
        verificationQuestion: type === 'FOUND' ? input.verificationQuestion : null,
        verificationAnswerEnc: type === 'FOUND' ? encrypt(input.verificationAnswer.trim()) : null, // NFR-10.1
        dropoffId: type === 'FOUND' && input.whereabouts === 'DROPOFF' ? input.dropoffId : null,
      });
      for (const [i, s] of saved.entries()) await repo.insertPhoto(db, p.post_id, s, i + 1);
      return p;
    });
    events.emit('post.published', post); // FR-2.9: Smart Match starts as soon as the post is published
    return post;
  } catch (err) {
    for (const s of saved) storage.remove(s.storagePath, s.blurredPath);
    throw err;
  }
}

async function ownPost(user, id) {
  const post = await repo.findPost(user.organization_id, id);
  if (!post) throw notFound('This post does not exist.');
  if (post.owner_id !== user.user_id) throw forbidden('Only the author can change this post.');
  return post;
}

const EDITABLE = {
  title: 'title',
  description: 'description',
  categoryId: 'category_id',
  locationId: 'location_id',
  eventDatetime: 'event_datetime',
  verificationQuestion: 'verification_question',
  whereabouts: 'whereabouts',
  dropoffId: 'dropoff_id',
};

/** FR-10.2, FR-10.3: the author edits an open post (never its type); every change is kept in the history. */
async function edit(user, id, input) {
  const post = await ownPost(user, id);
  if (post.status !== 'OPEN') throw conflict('Only open posts can be edited.');
  if (post.type === 'LOST' && ['verificationQuestion', 'verificationAnswer', 'whereabouts', 'dropoffId'].some((k) => k in input)) {
    throw badRequest('Lost posts have no verification question or whereabouts.');
  }
  if (post.received_at && ['whereabouts', 'dropoffId', 'locationId'].some((k) => k in input)) {
    throw conflict('The item is already held at the drop-off point.'); // FR-14.3
  }
  const merged = { whereabouts: post.whereabouts, dropoffId: post.dropoff_id, ...input };
  if (merged.whereabouts === 'FINDER') merged.dropoffId = null;
  const { category } = await resolveReferences(user.organization_id, {
    categoryId: input.categoryId,
    locationId: input.locationId,
    whereabouts: merged.whereabouts,
    dropoffId: merged.dropoffId,
  }, post.location_id);
  const isSensitive = category ? category.is_sensitive_default : post.is_sensitive;

  const fields = {};
  const changes = {};
  for (const [key, col] of Object.entries(EDITABLE)) {
    if (!(key in input) && !(key === 'dropoffId' && 'whereabouts' in input)) continue;
    let value = key === 'dropoffId' ? merged.dropoffId : input[key];
    if (isSensitive && (key === 'description' || key === 'title')) value = maskDigits(value);
    const before = post[col] instanceof Date ? post[col].toISOString() : post[col];
    const after = value instanceof Date ? value.toISOString() : value;
    if (before !== after) {
      fields[col] = value;
      changes[key] = { from: before, to: after };
    }
  }
  if (input.verificationAnswer) {
    fields.verification_answer_enc = encrypt(input.verificationAnswer.trim());
    changes.verificationAnswer = { changed: true }; // the answer itself is never written to the history
  }
  if (isSensitive !== post.is_sensitive) {
    fields.is_sensitive = isSensitive;
    if (isSensitive) {
      if (!('description' in fields)) fields.description = maskDigits(post.description);
      if (!('title' in fields)) fields.title = maskDigits(post.title);
    }
    changes.sensitive = { from: post.is_sensitive, to: isSensitive };
  }
  if (!Object.keys(fields).length) return post;

  const updated = await transaction(async (db) => {
    const p = await repo.updatePost(db, id, fields);
    await repo.insertHistory(db, id, user.user_id, changes);
    if (isSensitive && !post.is_sensitive) {
      for (const photo of await repo.photosOf(id, db)) {
        const blurredPath = await storage.blurExisting(photo.storage_path);
        await db.query('UPDATE photos SET blurred_path = $2, is_blurred = true WHERE photo_id = $1', [photo.photo_id, blurredPath]);
      }
    }
    return p;
  });
  events.emit('post.updated', updated); // FR-5.7: Smart Match runs again after an edit
  return updated;
}

/** FR-10.4, FR-10.5: delete a post without an approved claim; otherwise it can only be closed. */
async function remove(user, id) {
  await ownPost(user, id); // only the owner can delete
  if (await repo.hasApprovedClaim(id)) throw conflict('This post has an approved claim.  Close it instead.');
  const photos = await repo.photosOf(id);
  await repo.deletePost(id);
  for (const p of photos) storage.remove(p.storage_path, p.blurred_path);
}

/** FR-2.10: the author closes a post (Open or Returned to Closed, Figure 5). */
async function close(user, id) {
  const post = await ownPost(user, id);
  if (!canTransition(post.status, 'CLOSED')) {
    throw conflict(post.status === 'CLAIMED' ? 'Confirm or cancel the handover first.' : 'This post cannot be closed.');
  }
  const updated = await transaction((db) => repo.updatePost(db, id, { status: 'CLOSED', closed_at: new Date() }));
  events.emit('post.closed', updated);
  return updated;
}

async function addPhotos(user, id, files) {
  const post = await ownPost(user, id);
  if (post.status !== 'OPEN') throw conflict('Only open posts can be edited.');
  const existing = await repo.photosOf(id);
  if (existing.length + files.length > MAX_PHOTOS) throw badRequest(`At most ${MAX_PHOTOS} photos.`);
  const saved = [];
  try {
    for (const f of files) saved.push(await storage.savePhoto(f, { blur: post.is_sensitive }));
    await transaction(async (db) => {
      const used = new Set(existing.map((p) => p.position));
      let position = 1;
      for (const s of saved) {
        while (used.has(position)) position += 1;
        used.add(position);
        await repo.insertPhoto(db, id, s, position);
      }
      await repo.insertHistory(db, id, user.user_id, { photos: { added: saved.length } });
    });
  } catch (err) {
    for (const s of saved) storage.remove(s.storagePath, s.blurredPath);
    throw err;
  }
}

async function deletePhoto(user, id, photoId) {
  const post = await ownPost(user, id);
  if (post.status !== 'OPEN') throw conflict('Only open posts can be edited.');
  const removed = await transaction(async (db) => {
    const { rows } = await db.query('DELETE FROM photos WHERE photo_id = $1 AND post_id = $2 RETURNING *', [photoId, id]);
    if (rows[0]) await repo.insertHistory(db, id, user.user_id, { photos: { removed: 1 } });
    return rows[0];
  });
  if (!removed) throw notFound('This photo does not exist.');
  storage.remove(removed.storage_path, removed.blurred_path);
}

module.exports = { create, edit, remove, close, addPhotos, deletePhoto, history: repo.historyOf, ownPost };
