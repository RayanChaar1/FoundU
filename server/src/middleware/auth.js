/* Authentication and authorization in the interface layer (5.1, NFR-12.1, NFR-12.2).
   The session is a signed token in an HTTP-only cookie, so application servers stay stateless (NFR-14.3).
   Every authenticated request renews the token, so a session ends after 30 minutes of inactivity (FR-1.9). */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');
const { unauthorized, forbidden } = require('../lib/errors');

const COOKIE = 'foundu_session';
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: !config.isTest && process.env.NODE_ENV === 'production',
  maxAge: config.sessionMinutes * 60 * 1000,
});

function startSession(res, userId) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: `${config.sessionMinutes}m` });
  res.cookie(COOKIE, token, cookieOptions());
}

function endSession(res) {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/** Loads req.user when a valid session exists; never fails. */
async function loadUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      `SELECT u.user_id, u.organization_id, u.email, u.full_name, u.display_name, u.role, u.campus_id,
              u.karma_points, u.status, u.email_notifications, u.hide_from_leaderboard,
              o.karma_enabled, o.qr_enabled
         FROM users u LEFT JOIN organizations o USING (organization_id)
        WHERE u.user_id = $1`,
      [sub],
    );
    const user = rows[0];
    if (user && user.status === 'ACTIVE') {
      req.user = user;
      startSession(res, user.user_id); // sliding expiry
    } else {
      endSession(res);
    }
  } catch {
    endSession(res); // expired or tampered token
  }
  next();
}

const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));

/** Role check against Table 10.  Staff = security officers and administrators. */
const ROLE_SETS = {
  staff: ['SECURITY', 'ORG_ADMIN', 'PLATFORM_ADMIN'],
  admin: ['ORG_ADMIN', 'PLATFORM_ADMIN'],
  platform: ['PLATFORM_ADMIN'],
};

function requireRole(set) {
  const roles = ROLE_SETS[set];
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const isStaff = (user) => ROLE_SETS.staff.includes(user?.role);

module.exports = { loadUser, requireAuth, requireRole, startSession, endSession, isStaff, COOKIE };
