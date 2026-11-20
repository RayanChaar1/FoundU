const express = require('express');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const service = require('./service');
const { startSession, signOut, requireAuth } = require('../../middleware/auth');

const router = express.Router();
const PENDING_COOKIE = 'foundu_pending';
const SSO_COOKIE = 'foundu_sso'; // the sign-in under way with the identity provider (FR-1.2)
const SSO_MINUTES = 10;
const ssoCookie = { httpOnly: true, sameSite: 'lax', path: '/api/auth', secure: !config.isTest && process.env.NODE_ENV === 'production' };

const setSso = (res, data) =>
  res.cookie(SSO_COOKIE, jwt.sign({ ...data, sso: true }, config.jwtSecret, { expiresIn: `${SSO_MINUTES}m` }),
    { ...ssoCookie, maxAge: SSO_MINUTES * 60 * 1000 });
const readSso = (req) => {
  try {
    const data = jwt.verify(req.cookies?.[SSO_COOKIE] || '', config.jwtSecret);
    return data.sso ? data : null;
  } catch {
    return null;
  }
};
/** Back to the sign-in page of the client, with what happened. */
const toClient = (res, path) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(302, `${config.clientUrl.replace(/\/+$/, '')}${path}`);
};

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(120);

router.post('/auth/start', async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  const result = await service.startSignIn(body.email);
  if (result.sso) { // FR-1.2: no code; the browser goes to the organization's identity provider
    setSso(res, { email: body.email, org: result.organizationId });
    return res.json({ sso: true, organization: result.organization });
  }
  res.json({ sent: true, organization: result.organization });
});

// FR-1.2, NFR-25.1: sends the browser to the identity provider (authorization code flow with PKCE)
router.get('/auth/sso/start', async (req, res) => {
  const hint = readSso(req);
  if (!hint?.email) return toClient(res, '/signin?sso=expired');
  try {
    const { url, flow } = await service.beginSso(hint);
    setSso(res, { ...flow, email: hint.email });
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, url);
  } catch (err) {
    if (err instanceof service.SsoFailure) return toClient(res, `/signin?sso=${err.code}`);
    throw err;
  }
});

// The identity provider sends the browser back here with a code (or an error) and the state
router.get('/auth/sso/callback', async (req, res) => {
  const flow = readSso(req);
  res.clearCookie(SSO_COOKIE, ssoCookie); // a state works once
  const pick = (k) => (typeof req.query[k] === 'string' ? req.query[k] : undefined);
  try {
    const result = await service.finishSso(flow?.state ? flow : null, { code: pick('code'), state: pick('state'), error: pick('error') });
    if (result.user) {
      startSession(res, result.user);
      return toClient(res, '/');
    }
    res.cookie(PENDING_COOKIE, result.pendingToken, { httpOnly: true, sameSite: 'lax', maxAge: 15 * 60 * 1000 });
    return toClient(res, '/signin?step=profile');
  } catch (err) {
    if (err instanceof service.SsoFailure) return toClient(res, `/signin?sso=${err.code}`);
    throw err;
  }
});

// FR-1.6 after single sign-on: the profile step asks for the name (filled from the provider) and the campus
router.get('/auth/pending', async (req, res) => {
  res.json(await service.pendingProfile(req.cookies[PENDING_COOKIE]));
});

router.post('/auth/verify', async (req, res) => {
  const body = z.object({ email, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse(req.body);
  const result = await service.verifyCode(body.email, body.code);
  if (result.user) {
    startSession(res, result.user);
    return res.json({ signedIn: true });
  }
  res.cookie(PENDING_COOKIE, result.pendingToken, { httpOnly: true, sameSite: 'lax', maxAge: 15 * 60 * 1000 });
  res.json({ signedIn: false, needsProfile: true, campuses: result.campuses });
});

router.post('/auth/profile', async (req, res) => {
  const body = z
    .object({
      fullName: z.string().trim().min(2, 'Enter your full name.').max(100),
      campusId: z.coerce.number().int().positive('Choose your campus.'),
    })
    .parse(req.body);
  const user = await service.completeProfile(req.cookies[PENDING_COOKIE], body);
  res.clearCookie(PENDING_COOKIE);
  startSession(res, user);
  res.status(201).json({ signedIn: true });
});

router.post('/auth/logout', async (req, res) => {
  await signOut(req, res); // FR-1.8
  res.json({ signedOut: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const { user_id, email, full_name, display_name, role, campus_id, karma_points, email_notifications,
    hide_from_leaderboard, organization_id, karma_enabled, qr_enabled } = req.user;
  res.json({ user: { id: user_id, email, fullName: full_name, displayName: display_name, role, campusId: campus_id,
    karmaPoints: karma_points, emailNotifications: email_notifications, hideFromLeaderboard: hide_from_leaderboard,
    organizationId: organization_id, karmaEnabled: karma_enabled, qrEnabled: qr_enabled } });
});

router.patch('/me/preferences', requireAuth, async (req, res) => {
  const body = z
    .object({ emailNotifications: z.boolean().optional(), hideFromLeaderboard: z.boolean().optional() })
    .parse(req.body);
  res.json(await service.updatePreferences(req.user.user_id, body)); // FR-1.11, FR-13.5
});

module.exports = router;
