const { query } = require('../../db/pool');

/** Active organization whose registered email domains contain the domain of `email` (FR-1.1, FR-1.5). */
async function findOrganizationForEmail(email) {
  const domain = email.split('@')[1].toLowerCase();
  const { rows } = await query(
    `SELECT organization_id, name, sso_enabled FROM organizations
      WHERE status = 'ACTIVE' AND $1 = ANY (SELECT lower(d) FROM unnest(email_domains) d)`,
    [domain],
  );
  return rows[0];
}

/** FR-1.2: the identity provider settings of an active organization. */
async function ssoOrganization(organizationId) {
  const { rows } = await query(
    `SELECT organization_id, name, sso_enabled, sso_issuer, sso_client_id, sso_secret_enc FROM organizations
      WHERE organization_id = $1 AND status = 'ACTIVE'`,
    [organizationId],
  );
  return rows[0];
}

async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0];
}

async function insertOtp(email, codeHash, expiresAt) {
  const { rows } = await query('INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1, $2, $3) RETURNING otp_id', [email, codeHash, expiresAt]);
  return rows[0].otp_id;
}

async function deleteOtp(otpId) {
  await query('DELETE FROM otp_codes WHERE otp_id = $1', [otpId]);
}

async function latestOtp(email) {
  const { rows } = await query(
    `SELECT * FROM otp_codes WHERE lower(email) = lower($1) AND used_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  return rows[0];
}

const countRecentOtps = async (email) =>
  (await query(
    `SELECT count(*)::int AS n FROM otp_codes WHERE lower(email) = lower($1) AND created_at > now() - interval '10 minutes'`,
    [email],
  )).rows[0].n;

const markOtpUsed = (id) => query('UPDATE otp_codes SET used_at = now() WHERE otp_id = $1', [id]);
const addOtpAttempt = (id) => query('UPDATE otp_codes SET attempts = attempts + 1 WHERE otp_id = $1', [id]);

async function campusesOf(organizationId) {
  const { rows } = await query('SELECT campus_id, name FROM campuses WHERE organization_id = $1 ORDER BY name', [
    organizationId,
  ]);
  return rows;
}

async function createUser({ organizationId, email, fullName, campusId }) {
  const displayName = fullName.trim().split(/\s+/)[0] + (fullName.trim().includes(' ') ? ` ${fullName.trim().split(/\s+/).pop()[0]}.` : '');
  const { rows } = await query(
    `INSERT INTO users (organization_id, email, full_name, display_name, campus_id, role)
     VALUES ($1, lower($2), $3, $4, $5, 'USER') RETURNING *`, // FR-1.7: every new profile is a Registered User
    [organizationId, email, fullName.trim(), displayName, campusId],
  );
  return rows[0];
}

async function updatePreferences(userId, { emailNotifications, hideFromLeaderboard }) {
  const { rows } = await query(
    `UPDATE users SET email_notifications = coalesce($2, email_notifications),
                      hide_from_leaderboard = coalesce($3, hide_from_leaderboard)
      WHERE user_id = $1 RETURNING email_notifications, hide_from_leaderboard`,
    [userId, emailNotifications, hideFromLeaderboard],
  );
  return rows[0];
}

module.exports = {
  findOrganizationForEmail,
  ssoOrganization,
  findUserByEmail,
  insertOtp,
  deleteOtp,
  latestOtp,
  countRecentOtps,
  markOtpUsed,
  addOtpAttempt,
  campusesOf,
  createUser,
  updatePreferences,
};
