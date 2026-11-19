const jwt = require('jsonwebtoken');
const config = require('../../config');
const repo = require('./repository');
const { hash, verifyHash, randomDigits, decrypt } = require('../../lib/crypto');
const oidc = require('../organizations/oidc');
const { sendMail } = require('../../lib/mailer');
const { badRequest, forbidden, unauthorized, HttpError } = require('../../lib/errors');

const MAX_CODE_ATTEMPTS = 5;

/**
 * FR-1.2, FR-1.3: an organization with a connected identity provider signs its users in there; any other registered
 * organization gets a six-digit one-time code by email.
 */
async function startSignIn(email) {
  const org = await repo.findOrganizationForEmail(email);
  if (!org) throw forbidden('Your organization is not registered on FoundU.'); // FR-1.1, FR-1.5
  const existing = await repo.findUserByEmail(email);
  if (existing && existing.status !== 'ACTIVE') throw forbidden('This account is suspended.');
  if (org.sso_enabled) return { organization: org.name, organizationId: org.organization_id, sso: true };
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

/* ---------------------------------------------------------------- FR-1.2 single sign-on (OpenID Connect) */

/** A sign-in through the identity provider that cannot go on; the code tells the sign-in page what to show. */
class SsoFailure extends Error {
  constructor(code, reason) {
    super(reason || code);
    this.code = code; // denied, expired, invalid, unavailable, unreachable, other-org, suspended
  }
}

const redirectUri = () => `${config.clientUrl.replace(/\/+$/, '')}/api/auth/sso/callback`;

async function providerOf(organizationId) {
  const org = await repo.ssoOrganization(organizationId);
  if (!org?.sso_enabled || !org.sso_issuer) throw new SsoFailure('unavailable');
  let meta;
  try {
    meta = await oidc.discover(org.sso_issuer);
  } catch (err) {
    throw new SsoFailure('unreachable', err.message);
  }
  return { org, meta };
}

/** Starts the authorization code flow: returns the provider's sign-in address and the values to keep until the callback. */
async function beginSso({ email, org: organizationId }) {
  const { org, meta } = await providerOf(organizationId);
  const flow = { org: org.organization_id, state: oidc.randomToken(16), nonce: oidc.randomToken(16), verifier: oidc.randomToken(32) };
  const url = oidc.authorizationUrl(meta, { clientId: org.sso_client_id, redirectUri: redirectUri(), loginHint: email, ...flow });
  return { url, flow };
}

/** The address the provider vouches for: the email claim, or the user name when it is an address (Entra ID). */
function emailOf(claims) {
  if (claims.email_verified === false) return null;
  const candidate = [claims.email, claims.preferred_username, claims.upn].find((v) => typeof v === 'string' && /^[^@\s]+@[^@\s]+$/.test(v));
  return candidate ? candidate.trim().toLowerCase() : null;
}

/**
 * Finishes the flow at the callback: checks state, exchanges the code, verifies the ID token and finds the user.
 * Returns { user } for a known user, or { pendingToken, fullName } on first sign-in (FR-1.6).
 */
async function finishSso(flow, { code, state, error }) {
  if (!flow) throw new SsoFailure('expired');
  if (error) throw new SsoFailure('denied', String(error));
  if (!code || !state || state !== flow.state) throw new SsoFailure('invalid', 'The state does not match this sign-in.');
  const { org, meta } = await providerOf(flow.org);
  let claims;
  try {
    const idToken = await oidc.exchangeCode(meta, {
      clientId: org.sso_client_id, clientSecret: decrypt(org.sso_secret_enc), code: String(code), redirectUri: redirectUri(), verifier: flow.verifier,
    });
    claims = await oidc.verifyIdToken(meta, idToken, { issuer: org.sso_issuer, clientId: org.sso_client_id, nonce: flow.nonce });
  } catch (err) {
    if (err instanceof oidc.SsoError) throw new SsoFailure('invalid', err.message);
    throw err;
  }
  const email = emailOf(claims);
  if (!email) throw new SsoFailure('invalid', 'The ID token holds no verified email address.');
  const emailOrg = await repo.findOrganizationForEmail(email);
  if (!emailOrg || emailOrg.organization_id !== org.organization_id) throw new SsoFailure('other-org');
  const user = await repo.findUserByEmail(email);
  if (user) {
    if (user.status !== 'ACTIVE') throw new SsoFailure('suspended');
    return { user };
  }
  const fullName = typeof claims.name === 'string' ? claims.name.trim().slice(0, 100) : '';
  const pendingToken = jwt.sign({ email, org: org.organization_id, pending: true, name: fullName }, config.jwtSecret, { expiresIn: '15m' });
  return { pendingToken, fullName };
}

/** FR-1.6 after single sign-on: who is creating a profile, and the campuses to choose from. */
async function pendingProfile(pendingToken) {
  let claims;
  try {
    claims = jwt.verify(pendingToken, config.jwtSecret);
  } catch {
    throw unauthorized('Your sign-in has expired.  Start again.');
  }
  if (!claims.pending) throw unauthorized();
  return { email: claims.email, fullName: claims.name || '', campuses: await repo.campusesOf(claims.org) };
}

module.exports = {
  startSignIn, verifyCode, completeProfile, updatePreferences: repo.updatePreferences,
  beginSso, finishSso, pendingProfile, SsoFailure,
};
