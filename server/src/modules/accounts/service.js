const jwt = require('jsonwebtoken');
const config = require('../../config');
const repo = require('./repository');
const { hash, verifyHash, randomDigits } = require('../../lib/crypto');
const { sendMail } = require('../../lib/mailer');
const { badRequest, forbidden, unauthorized, HttpError } = require('../../lib/errors');

const MAX_CODE_ATTEMPTS = 5;

/** FR-1.3: send a six-digit one-time code to an address of a registered organization. */
async function startSignIn(email) {
  const org = await repo.findOrganizationForEmail(email);
  if (!org) throw forbidden('Your organization is not registered on FoundU.'); // FR-1.1, FR-1.5
  const existing = await repo.findUserByEmail(email);
  if (existing && existing.status !== 'ACTIVE') throw forbidden('This account is suspended.');
  if ((await repo.countRecentOtps(email)) >= 5) throw new HttpError(429, 'Too many codes requested.  Try again later.');
  const code = randomDigits(6);
  const expiresAt = new Date(Date.now() + config.otpMinutes * 60 * 1000); // FR-1.4
  await repo.insertOtp(email, await hash(code), expiresAt);
  await sendMail({
    to: email,
    subject: 'Your FoundU sign-in code',
    text: `Your FoundU code is ${code}.  It expires in ${config.otpMinutes} minutes.\nIf you did not ask for it, ignore this email.`,
  });
  return { organization: org.name };
}

/** Checks the code.  Returns { user } for a known user, or { pendingToken, campuses } on first sign-in (FR-1.6). */
async function verifyCode(email, code) {
  const otp = await repo.latestOtp(email);
  if (!otp || otp.expires_at < new Date() || otp.attempts >= MAX_CODE_ATTEMPTS) {
    throw unauthorized('The code has expired.  Request a new one.');
  }
  if (!(await verifyHash(otp.code_hash, code))) {
    await repo.addOtpAttempt(otp.otp_id);
    throw unauthorized('Wrong code.');
  }
  await repo.markOtpUsed(otp.otp_id);
  const user = await repo.findUserByEmail(email);
  if (user) {
    if (user.status !== 'ACTIVE') throw forbidden('This account is suspended.');
    return { user };
  }
  const org = await repo.findOrganizationForEmail(email);
  if (!org) throw forbidden('Your organization is not registered on FoundU.');
  const pendingToken = jwt.sign({ email, org: org.organization_id, pending: true }, config.jwtSecret, { expiresIn: '15m' });
  return { pendingToken, campuses: await repo.campusesOf(org.organization_id) };
}

/** FR-1.6, FR-1.7: create the profile after the first verified sign-in. */
async function completeProfile(pendingToken, { fullName, campusId }) {
  let claims;
  try {
    claims = jwt.verify(pendingToken, config.jwtSecret);
  } catch {
    throw unauthorized('Your sign-in has expired.  Start again.');
  }
  if (!claims.pending) throw unauthorized();
  const campuses = await repo.campusesOf(claims.org);
  if (!campuses.some((c) => c.campus_id === campusId)) throw badRequest('Choose a campus of your organization.');
  const existing = await repo.findUserByEmail(claims.email);
  if (existing) return existing;
  return repo.createUser({ organizationId: claims.org, email: claims.email, fullName, campusId });
}

module.exports = { startSignIn, verifyCode, completeProfile, updatePreferences: repo.updatePreferences };
