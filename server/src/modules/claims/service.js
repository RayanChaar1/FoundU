/* Claims and Handover module (Table 7): ownership claims (FR-6), status management and handover codes (FR-9). */
const repo = require('./repository');
const { transaction, query } = require('../../db/pool');
const { encrypt, decrypt, hash, verifyHash, randomDigits } = require('../../lib/crypto');
const { canTransition } = require('../../lib/postStatus');
const { isStaff } = require('../../middleware/auth');
const events = require('../../lib/events');
const { notify, notifyAll, staffOf } = require('../notifications/service');
const { badRequest, forbidden, notFound, conflict, HttpError } = require('../../lib/errors');

const MAX_CODE_ATTEMPTS = 5; // FR-9.7
const BLOCK_MINUTES = 15;
const FLAG_REJECTIONS = 3; // FR-6.14

const link = (claimId) => `/claims/${claimId}`;

/** The finder reviews; security officers also review items held at a drop-off point (FR-6.6, FR-6.7). */
const isReviewer = (user, claim) =>
  claim.owner_id === user.user_id || (isStaff(user) && claim.whereabouts === 'DROPOFF');

/** Parties of a handover: the claimant and the finder, plus staff for items held at a drop-off point. */
const isParty = (user, claim) => claim.claimant_id === user.user_id || isReviewer(user, claim);

async function loadClaim(db, user, id, forUpdate) {
  const claim = await repo.claimFor(db, user.organization_id, id, forUpdate);
  if (!claim) throw notFound('This claim does not exist.');
  return claim;
}

/** FR-6.1 to FR-6.6: a user claims an open found post by answering its verification question. */
async function submit(user, postId, { answer, description }) {
  const { claim, post } = await transaction(async (db) => {
    const p = await repo.postFor(db, user.organization_id, postId, true);
    if (!p || p.status === 'REMOVED' || p.is_hidden) throw notFound('This post does not exist.');
    if (p.type !== 'FOUND') throw badRequest('Only found posts can be claimed.  Use "I may have found this" on lost posts.');
    if (p.owner_id === user.user_id) throw forbidden('You cannot claim your own post.'); // FR-6.3
    if (p.status !== 'OPEN') throw conflict('This post is not open for claims.');
    const pending = await db.query(
      `SELECT 1 FROM claims WHERE post_id = $1 AND claimant_id = $2 AND status = 'PENDING'`,
      [postId, user.user_id],
    );
    if (pending.rowCount) throw conflict('You already have a pending claim on this post.'); // FR-6.4
    const c = await repo.insertClaim(db, { postId, claimantId: user.user_id, answer, description });
    const text = `New claim on "${p.title}".  Review the answer to the verification question.`;
    await notify(p.owner_id, 'CLAIM_RECEIVED', text, { link: link(c.claim_id), claimId: c.claim_id, db }); // FR-6.5
    if (p.whereabouts === 'DROPOFF') {
      // FR-6.6: the security office or reception desk holding the item is told as well
      await notifyAll(await staffOf(p.organization_id), 'CLAIM_RECEIVED', text, { link: link(c.claim_id), claimId: c.claim_id, db });
    }
    return { claim: c, post: p };
  });
  events.emit('claim.submitted', { claim, post });
  return claim;
}

/** Shapes a claim for the viewer: reviewers see the expected answer (FR-6.7), only the claimant sees the code (FR-9.3). */
function view(user, c) {
  const reviewer = isReviewer(user, c);
  const out = {
    id: c.claim_id,
    postId: c.post_id,
    postTitle: c.post_title,
    postStatus: c.post_status,
    status: c.status,
    answer: c.answer_text,
    description: c.description,
    rejectionReason: c.rejection_reason,
    cancelReason: c.cancel_reason,
    createdAt: c.created_at,
    decidedAt: c.decided_at,
    returnedAt: c.returned_at,
    claimantName: c.claimant_name ?? undefined,
    finderName: c.finder_name ?? undefined,
    isClaimant: c.claimant_id === user.user_id,
    isReviewer: reviewer,
    hasConversation: ['APPROVED', 'COMPLETED'].includes(c.status), // FR-6.12, FR-7.1
  };
  if (c.verification_question) out.verificationQuestion = c.verification_question;
  if (reviewer && c.verification_answer_enc) out.expectedAnswer = decrypt(c.verification_answer_enc);
  if (c.claimant_id === user.user_id && c.status === 'APPROVED' && c.handover_code_enc) {
    out.handoverCode = decrypt(c.handover_code_enc);
  }
  if (c.status === 'APPROVED' && c.code_locked_until > new Date()) out.codeBlockedUntil = c.code_locked_until;
  return out;
}

async function get(user, id) {
  const claim = await loadClaim({ query }, user, id);
  if (!isParty(user, claim)) throw forbidden('Only the claimant and the reviewer can open this claim.'); // FR-6.7
  const { rows } = await query(
    `SELECT cu.display_name AS claimant_name, ou.display_name AS finder_name
       FROM claims c LEFT JOIN users cu ON cu.user_id = c.claimant_id
       JOIN posts p USING (post_id) LEFT JOIN users ou ON ou.user_id = p.owner_id WHERE c.claim_id = $1`,
    [id],
  );
  return view(user, { ...claim, ...rows[0] });
}

async function list(user) {
  const rows = await repo.listFor(user, isStaff(user));
  return rows.map((c) => view(user, c));
}

/** Claims on one post: the reviewer sees all of them, anyone else only their own. */
async function listForPost(user, postId) {
  const post = await repo.postFor({ query }, user.organization_id, postId);
  if (!post) throw notFound('This post does not exist.');
  const reviewer = isReviewer(user, { owner_id: post.owner_id, whereabouts: post.whereabouts });
  const rows = await repo.listForPost(postId);
  return rows
    .filter((c) => reviewer || c.claimant_id === user.user_id)
    .map((c) => view(user, { ...c, verification_answer_enc: post.verification_answer_enc, verification_question: post.verification_question }));
}

async function decidable(db, user, id) {
  const claim = await loadClaim(db, user, id, true);
  if (!isReviewer(user, claim)) throw forbidden('Only the finder can decide on this claim.'); // FR-6.8
  if (claim.status !== 'PENDING') throw conflict('This claim has already been decided.');
  return claim;
}

/** FR-6.8, FR-6.10 to FR-6.12, FR-9.3: approve a claim, mark the post Claimed, and create the handover code. */
async function approve(user, id) {
  const claim = await transaction(async (db) => {
    const c = await decidable(db, user, id);
    if (!canTransition(c.post_status, 'CLAIMED')) throw conflict('This post is no longer open.');
    const code = randomDigits(4);
    const updated = await repo.updateClaim(db, id, {
      status: 'APPROVED',
      decided_at: new Date(),
      handover_code_hash: await hash(code), // NFR-10.2
      handover_code_enc: encrypt(code),
      failed_attempts: 0,
    });
    await repo.setPostStatus(db, c.post_id, { status: 'CLAIMED' });
    await repo.history(db, c.post_id, user.user_id, { status: { from: c.post_status, to: 'CLAIMED' }, claimId: c.claim_id });
    const others = await repo.rejectOthers(db, c.post_id, c.claim_id, 'Another claim on this item was approved.');
    for (const o of others) {
      await notify(o.claimant_id, 'CLAIM_REJECTED', `Your claim on "${c.post_title}" was not approved: another claim on this item was approved.`,
        { link: link(o.claim_id), claimId: o.claim_id, db }); // FR-6.11
    }
    await notify(c.claimant_id, 'CLAIM_APPROVED',
      `Your claim on "${c.post_title}" was approved.  Open it to see your handover code and message the finder.`,
      { link: link(c.claim_id), claimId: c.claim_id, db });
    return { ...c, ...updated };
  });
  events.emit('claim.approved', claim);
  return get(user, id);
}

/** FR-6.8, FR-6.9, FR-6.14: reject a claim with a reason; three rejections within 30 days flag the claimant. */
async function reject(user, id, reason) {
  await transaction(async (db) => {
    const c = await decidable(db, user, id);
    await repo.updateClaim(db, id, { status: 'REJECTED', rejection_reason: reason, decided_at: new Date() });
    await notify(c.claimant_id, 'CLAIM_REJECTED', `Your claim on "${c.post_title}" was rejected: ${reason}`,
      { link: link(c.claim_id), claimId: c.claim_id, db });
    if (c.claimant_id && (await repo.recentRejections(db, c.claimant_id)) >= FLAG_REJECTIONS) {
      await db.query('UPDATE users SET flagged_for_review = true WHERE user_id = $1', [c.claimant_id]);
    }
  });
  return get(user, id);
}

/** The claimant withdraws a pending claim. */
async function withdraw(user, id) {
  await transaction(async (db) => {
    const c = await loadClaim(db, user, id, true);
    if (c.claimant_id !== user.user_id) throw forbidden('Only the claimant can withdraw this claim.');
    if (c.status !== 'PENDING') throw conflict('Only pending claims can be withdrawn.  Cancel the handover instead.');
    await repo.updateClaim(db, id, { status: 'WITHDRAWN', decided_at: new Date() });
  });
  return get(user, id);
}

/** FR-9.4 to FR-9.8: the finder or a security officer enters the claimant's code to confirm the return. */
async function confirmHandover(user, id, code) {
  const outcome = await transaction(async (db) => {
    const c = await loadClaim(db, user, id, true);
    const allowed = c.owner_id === user.user_id || (isStaff(user) && c.claimant_id !== user.user_id);
    if (!allowed) throw forbidden('Only the finder or a security officer can enter the handover code.');
    if (c.status !== 'APPROVED' || c.post_status !== 'CLAIMED') throw conflict('This claim has no handover in progress.');
    if (c.code_locked_until && c.code_locked_until > new Date()) return { blocked: c.code_locked_until };

    if (!(await verifyHash(c.handover_code_hash, code))) {
      const attempts = c.failed_attempts + 1;
      if (attempts < MAX_CODE_ATTEMPTS) {
        await repo.updateClaim(db, id, { failed_attempts: attempts });
        return { wrong: MAX_CODE_ATTEMPTS - attempts };
      }
      const until = new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);
      await repo.updateClaim(db, id, { failed_attempts: 0, code_locked_until: until }); // FR-9.7
      const text = `Five wrong handover codes were entered for "${c.post_title}".  Code entry is blocked for ${BLOCK_MINUTES} minutes.`;
      await notifyAll([c.claimant_id, c.owner_id], 'CODE_BLOCKED', text, { link: link(c.claim_id), claimId: c.claim_id, db }); // FR-9.8
      return { blocked: until, justBlocked: true };
    }

    const now = new Date();
    await repo.updateClaim(db, id, { status: 'COMPLETED', returned_at: now, failed_attempts: 0, handover_code_enc: null });
    await repo.setPostStatus(db, c.post_id, { status: 'RETURNED', returned_at: now }); // FR-9.5, FR-9.6
    await repo.history(db, c.post_id, user.user_id, { status: { from: 'CLAIMED', to: 'RETURNED' }, returnedAt: now.toISOString(), claimId: c.claim_id });
    await notifyAll([c.claimant_id, c.owner_id], 'HANDOVER', `"${c.post_title}" was returned to its owner.  Thank you for using FoundU.`,
      { link: link(c.claim_id), claimId: c.claim_id, db });
    return { returned: now, claim: c };
  });

  if (outcome.blocked) {
    const at = outcome.blocked.toISOString();
    throw new HttpError(423, outcome.justBlocked ? 'Wrong code.  Code entry is now blocked for 15 minutes.' : 'Code entry is blocked.  Try again later.', { blockedUntil: at });
  }
  if (outcome.wrong !== undefined) {
    throw badRequest(`Wrong code.  ${outcome.wrong} ${outcome.wrong === 1 ? 'attempt' : 'attempts'} left before code entry is blocked.`, { attemptsLeft: outcome.wrong });
  }
  events.emit('handover.completed', { ...outcome.claim, returned_at: outcome.returned, confirmed_by: user.user_id });
  return get(user, id);
}

/** FR-9.9, FR-9.10: either party cancels the handover with a reason; the post returns to Open. */
async function cancelHandover(user, id, reason) {
  await transaction(async (db) => {
    const c = await loadClaim(db, user, id, true);
    if (!isParty(user, c)) throw forbidden('Only the claimant and the finder can cancel this handover.');
    if (c.status !== 'APPROVED' || c.post_status !== 'CLAIMED') throw conflict('This handover can no longer be cancelled.');
    await repo.updateClaim(db, id, {
      status: 'WITHDRAWN', cancel_reason: reason, decided_at: new Date(), handover_code_enc: null, handover_code_hash: null,
    });
    await repo.setPostStatus(db, c.post_id, { status: 'OPEN' });
    await repo.history(db, c.post_id, user.user_id, { status: { from: 'CLAIMED', to: 'OPEN' }, cancelReason: reason, claimId: c.claim_id });
    const other = user.user_id === c.claimant_id ? [c.owner_id] : [c.claimant_id, c.owner_id].filter((u) => u !== user.user_id);
    await notifyAll(other, 'HANDOVER_CANCELLED', `The handover of "${c.post_title}" was cancelled: ${reason}`,
      { link: link(c.claim_id), claimId: c.claim_id, db });
  });
  return get(user, id);
}

/** FR-6.13: "I may have found this" message to the owner of a lost post. */
async function contact(user, postId, message) {
  await transaction(async (db) => {
    const p = await repo.postFor(db, user.organization_id, postId);
    if (!p || p.status === 'REMOVED' || p.is_hidden) throw notFound('This post does not exist.');
    if (p.type !== 'LOST') throw badRequest('Use "This is mine" to claim a found post.');
    if (p.owner_id === user.user_id) throw forbidden('You cannot contact yourself about your own post.');
    if (p.status !== 'OPEN') throw conflict('This post is no longer open.');
    await repo.insertContact(db, postId, user.user_id, message);
    await notify(p.owner_id, 'CONTACT', `${user.display_name} may have found "${p.title}": ${message}`, { link: `/posts/${postId}`, db });
  });
}

async function contacts(user, postId) {
  const post = await repo.postFor({ query }, user.organization_id, postId);
  if (!post) throw notFound('This post does not exist.');
  if (post.owner_id !== user.user_id) throw forbidden('Only the owner of the post can read these messages.');
  return repo.contactsOf(postId);
}

/** FR-9.11: daily job; closes posts Returned for 7 days or more. */
async function closeReturnedPosts(now = new Date()) {
  const closed = await transaction(async (db) => {
    const rows = await repo.closeReturned(db, now);
    for (const p of rows) await repo.history(db, p.post_id, null, { status: { from: 'RETURNED', to: 'CLOSED' }, automatic: true });
    return rows;
  });
  for (const p of closed) events.emit('post.closed', p);
  return closed.length;
}

module.exports = {
  submit, get, list, listForPost, approve, reject, withdraw, confirmHandover, cancelHandover, contact, contacts,
  closeReturnedPosts, isReviewer,
};
