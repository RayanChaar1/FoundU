const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { startSession, endSession, requireAuth } = require('../../middleware/auth');

const router = express.Router();
const PENDING_COOKIE = 'foundu_pending';

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(120);

router.post('/auth/start', async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  const result = await service.startSignIn(body.email);
  res.json({ sent: true, organization: result.organization });
});

router.post('/auth/verify', async (req, res) => {
  const body = z.object({ email, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse(req.body);
  const result = await service.verifyCode(body.email, body.code);
  if (result.user) {
    startSession(res, result.user.user_id);
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
  startSession(res, user.user_id);
  res.status(201).json({ signedIn: true });
});

router.post('/auth/logout', (req, res) => {
  endSession(res); // FR-1.8
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
