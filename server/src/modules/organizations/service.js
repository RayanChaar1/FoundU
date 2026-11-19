/* Organization management (FR-18): access requests and their activation by a platform administrator, the email
   domains of an organization, its karma and QR tag switches, and its own identity provider.  Campuses, buildings,
   drop-off points and categories are managed on the administration page of FR-16. */
const { query, transaction } = require('../../db/pool');
const { encrypt, decrypt, randomToken } = require('../../lib/crypto');
const { sendMail } = require('../../lib/mailer');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { txtRecords } = require('./dns');
const config = require('../../config');
const { testConnection, SsoError } = require('./oidc');

/** Free email providers: anyone can get an address there, so they never identify an organization. */
const PUBLIC_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com'];

const record = (token) => `foundu-verify=${token}`;
const domainOf = (email) => email.split('@')[1].toLowerCase();

const audit = (db, actor, organizationId, action, targetType, targetId, reason = null) => db.query(
  `INSERT INTO audit_log (organization_id, actor_id, action, target_type, target_id, reason)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [organizationId, actor?.user_id ?? null, action, targetType, targetId, reason && String(reason).slice(0, 500)],
);

/** One domain may belong to one organization only; rejected requests release theirs.  Call inside the lock. */
async function domainsInUse(db, domains, exceptOrg = null) {
  const { rows } = await db.query(
    `SELECT d FROM organizations o, unnest(o.email_domains) d
      WHERE o.status <> 'REJECTED' AND lower(d) = ANY ($1) AND o.organization_id IS DISTINCT FROM $2`,
    [domains, exceptOrg],
  );
  return rows.map((r) => r.d.toLowerCase());
}

/** Serializes every change to the domains, so two requests can never take the same domain at the same time. */
const lockDomains = (db) => db.query('SELECT pg_advisory_xact_lock(18)');

// ------------------------------------------------------------------------------- FR-18.1 access requests

async function requestAccess({ name, type, domains, campuses, contactName, contactEmail }) {
  const list = [...new Set(domains.map((d) => d.toLowerCase()))];
  const free = list.filter((d) => PUBLIC_DOMAINS.includes(d));
  if (free.length) throw badRequest(`${free[0]} is a public email provider.  Enter your organization's own domain.`);
  if (!list.includes(domainOf(contactEmail))) {
    throw badRequest('The contact administrator\'s email is not at one of the domains.', {
      fields: { contactEmail: `Use an address at ${list.join(' or ')}.` },
    });
  }
  const token = randomToken(16);
  const org = await transaction(async (db) => {
    await lockDomains(db);
    const taken = await domainsInUse(db, list);
    if (taken.length) throw conflict(`${taken[0]} is already in use by another organization.`);
    const { rows: [o] } = await db.query(
      `INSERT INTO organizations (name, type, email_domains, status, contact_name, contact_email, domain_token)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6)
       ON CONFLICT (name) DO NOTHING
       RETURNING organization_id AS id, name, status`,
      [name, type, list, contactName, contactEmail.toLowerCase(), token],
    );
    if (!o) throw conflict(`An organization named ${name} already exists.`);
    for (const c of campuses) {
      await db.query('INSERT INTO campuses (organization_id, name, latitude, longitude) VALUES ($1, $2, $3, $4)',
        [o.id, c.name, c.latitude, c.longitude]);
    }
    await audit(db, null, o.id, 'ORG_REQUESTED', 'ORGANIZATION', o.id, `${name} (${list.join(', ')})`);
    return o;
  });
  await sendMail({
    to: contactEmail,
    subject: 'Your FoundU access request',
    text: `We received the request of ${name}.\n\nTo prove that ${name} controls its email domains, add this TXT `
      + `record to the DNS of ${list.join(' and ')}:\n\n  ${record(token)}\n\nA FoundU administrator then checks it `
      + 'and activates your organization.  You will receive an email when it is done.',
  });
  return { ...org, dnsRecord: record(token) };
}

// --------------------------------------------------------------------------- FR-18.2 review and activation

async function requests(status) {
  const { rows } = await query(
    `SELECT o.organization_id AS id, o.name, o.type, o.email_domains AS domains, o.status,
            o.contact_name AS "contactName", o.contact_email AS "contactEmail", o.domain_token AS token,
            o.created_at AS "requestedAt", o.reviewed_at AS "reviewedAt", o.rejection_reason AS "rejectionReason",
            coalesce((SELECT json_agg(c.name ORDER BY c.name) FROM campuses c WHERE c.organization_id = o.organization_id), '[]') AS campuses
       FROM organizations o
      WHERE ($1::text IS NULL OR o.status = $1)
      ORDER BY o.status = 'PENDING' DESC, o.created_at DESC`,
    [status || null],
  );
  return rows.map(({ token, ...o }) => ({ ...o, dnsRecord: token ? record(token) : null }));
}

async function pendingOrg(db, id) {
  const { rows: [o] } = await db.query('SELECT * FROM organizations WHERE organization_id = $1 FOR UPDATE', [id]);
  if (!o) throw notFound('This request does not exist.');
  if (o.status !== 'PENDING') throw conflict(`${o.name} is already ${o.status === 'ACTIVE' ? 'active' : 'rejected'}.`);
  return o;
}

/** Checks the TXT record on every domain of the request.  Returns [{ domain, verified }]. */
async function checkDomains(id) {
  const { rows: [o] } = await query('SELECT email_domains, domain_token FROM organizations WHERE organization_id = $1', [id]);
  if (!o) throw notFound('This request does not exist.');
  return Promise.all(o.email_domains.map(async (domain) => ({
    domain,
    verified: (await txtRecords(domain)).includes(record(o.domain_token)),
  })));
}

/** FR-18.2: activates the organization only when every one of its domains carries the TXT record.  The contact
    becomes the organization's first administrator. */
async function activate(platformAdmin, id) {
  const checks = await checkDomains(id);
  const missing = checks.filter((c) => !c.verified).map((c) => c.domain);
  const org = await transaction(async (db) => {
    const o = await pendingOrg(db, id);
    if (missing.length) {
      throw conflict(`The domain is not verified: ${missing.join(', ')} has no TXT record ${record(o.domain_token)}.`, { checks });
    }
    await db.query(
      `UPDATE organizations SET status = 'ACTIVE', reviewed_at = now(), reviewed_by = $2 WHERE organization_id = $1`,
      [id, platformAdmin.user_id],
    );
    const { rows: [campus] } = await db.query('SELECT campus_id FROM campuses WHERE organization_id = $1 ORDER BY campus_id LIMIT 1', [id]);
    const [first, last = ''] = o.contact_name.split(' ');
    await db.query(
      `INSERT INTO users (organization_id, email, full_name, display_name, role, campus_id)
       SELECT $1, $2::text, $3, $4, 'ORG_ADMIN', $5
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($2::text))`,
      [id, o.contact_email, o.contact_name, `${first} ${last ? `${last[0]}.` : ''}`.trim().slice(0, 60), campus?.campus_id ?? null],
    );
    await audit(db, platformAdmin, id, 'ORG_ACTIVATED', 'ORGANIZATION', id, `Domains verified: ${o.email_domains.join(', ')}`);
    return o;
  });
  await sendMail({
    to: org.contact_email,
    subject: `${org.name} is now on FoundU`,
    text: `${org.name} is active on FoundU.  Sign in with ${org.contact_email}: you are its administrator, and every `
      + `member with an address at ${org.email_domains.join(' or ')} can now sign in.`,
  });
  return { id, name: org.name, status: 'ACTIVE' };
}

async function reject(platformAdmin, id, reason) {
  const org = await transaction(async (db) => {
    const o = await pendingOrg(db, id);
    await db.query(
      `UPDATE organizations SET status = 'REJECTED', reviewed_at = now(), reviewed_by = $2, rejection_reason = $3
        WHERE organization_id = $1`,
      [id, platformAdmin.user_id, reason],
    );
    await audit(db, platformAdmin, id, 'ORG_REJECTED', 'ORGANIZATION', id, reason);
    return o;
  });
  await sendMail({
    to: org.contact_email,
    subject: 'Your FoundU access request',
    text: `The request of ${org.name} was not accepted: ${reason}`,
  });
  return { id, name: org.name, status: 'REJECTED' };
}

// ------------------------------------------------------------------------------------ FR-18.5 email domains

/** The organization's verification token; organizations created before FR-18 get one the first time it is needed. */
async function tokenOf(organizationId) {
  const { rows: [o] } = await query(
    `UPDATE organizations SET domain_token = coalesce(domain_token, $2) WHERE organization_id = $1 RETURNING domain_token`,
    [organizationId, randomToken(16)],
  );
  return o.domain_token;
}

async function domains(admin) {
  const token = await tokenOf(admin.organization_id);
  const { rows: [o] } = await query(
    `SELECT o.email_domains,
            (SELECT json_object_agg(d, (SELECT count(*) FROM users u WHERE u.organization_id = o.organization_id
                                          AND lower(split_part(u.email, '@', 2)) = lower(d)))
               FROM unnest(o.email_domains) d) AS users
       FROM organizations o WHERE o.organization_id = $1`,
    [admin.organization_id],
  );
  return {
    domains: o.email_domains.map((d) => ({ domain: d, users: Number(o.users?.[d] ?? 0) })),
    dnsRecord: record(token),
  };
}

/** A new domain needs the same TXT record as at activation; otherwise an administrator could take any domain. */
async function addDomain(admin, domain) {
  domain = domain.toLowerCase();
  if (PUBLIC_DOMAINS.includes(domain)) throw badRequest(`${domain} is a public email provider.  Enter your organization's own domain.`);
  const token = await tokenOf(admin.organization_id);
  if (!(await txtRecords(domain)).includes(record(token))) {
    throw badRequest(`Add the TXT record ${record(token)} to ${domain}, then add the domain again.`, {
      fields: { domain: `${domain} has no TXT record ${record(token)}.` },
    });
  }
  await transaction(async (db) => {
    await lockDomains(db);
    if ((await domainsInUse(db, [domain])).length) throw conflict(`${domain} is already in use.`);
    await db.query('UPDATE organizations SET email_domains = array_append(email_domains, $2) WHERE organization_id = $1',
      [admin.organization_id, domain]);
    await audit(db, admin, admin.organization_id, 'DOMAIN_ADDED', 'ORGANIZATION', admin.organization_id, domain);
  });
  return domains(admin);
}

/** Refused for the last domain, and for a domain that members still sign in with: they would be locked out. */
async function removeDomain(admin, domain) {
  domain = domain.toLowerCase();
  await transaction(async (db) => {
    const { rows: [o] } = await db.query('SELECT email_domains FROM organizations WHERE organization_id = $1 FOR UPDATE',
      [admin.organization_id]);
    const current = o.email_domains.find((d) => d.toLowerCase() === domain);
    if (!current) throw notFound(`${domain} is not a domain of your organization.`);
    if (o.email_domains.length === 1) throw conflict(`${domain} is your only domain, so it cannot be removed.`);
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM users WHERE organization_id = $1 AND status <> 'DELETED'
          AND lower(split_part(email, '@', 2)) = $2`,
      [admin.organization_id, domain],
    );
    if (n) throw conflict(`${n} ${n === 1 ? 'member signs' : 'members sign'} in with ${domain}, so it cannot be removed.`);
    await db.query('UPDATE organizations SET email_domains = array_remove(email_domains, $2) WHERE organization_id = $1',
      [admin.organization_id, current]);
    await audit(db, admin, admin.organization_id, 'DOMAIN_REMOVED', 'ORGANIZATION', admin.organization_id, domain);
  });
  return domains(admin);
}

// ------------------------------------------------------------------- FR-18.6, FR-18.7 karma and QR switches

const FEATURES = { karmaEnabled: ['karma_enabled', 'Karma points'], qrEnabled: ['qr_enabled', 'QR tags'] };

async function settings(admin) {
  const { rows: [o] } = await query(
    `SELECT name, karma_enabled AS "karmaEnabled", qr_enabled AS "qrEnabled", sso_enabled AS "ssoEnabled"
       FROM organizations WHERE organization_id = $1`,
    [admin.organization_id],
  );
  return o;
}

async function updateSettings(admin, changes) {
  await transaction(async (db) => {
    const { rows: [before] } = await db.query(
      'SELECT karma_enabled, qr_enabled FROM organizations WHERE organization_id = $1 FOR UPDATE', [admin.organization_id]);
    for (const [key, value] of Object.entries(changes)) {
      const [column, label] = FEATURES[key];
      if (before[column] === value) continue;
      await db.query(`UPDATE organizations SET ${column} = $2 WHERE organization_id = $1`, [admin.organization_id, value]);
      await audit(db, admin, admin.organization_id, 'SETTINGS_CHANGED', 'ORGANIZATION', admin.organization_id,
        `${label} ${value ? 'enabled' : 'disabled'}`);
    }
  });
  return settings(admin);
}

// --------------------------------------------------------------------------------- FR-18.8 single sign-on

async function sso(admin) {
  const { rows: [o] } = await query(
    `SELECT sso_issuer AS issuer, sso_client_id AS "clientId", sso_secret_enc IS NOT NULL AS "hasSecret",
            sso_enabled AS enabled, sso_checked_at AS "checkedAt"
       FROM organizations WHERE organization_id = $1`,
    [admin.organization_id],
  );
  // FR-1.2: the address to register at the provider, where it sends users back after they sign in
  return { ...o, redirectUri: `${config.clientUrl.replace(/\/+$/, '')}/api/auth/sso/callback` };
}

/** Tests the settings first; they are saved and switched on only if the test sign-in succeeds.  A blank secret keeps
    the one already saved, so the administrator never has to see it again. */
async function connectSso(admin, { issuer, clientId, clientSecret }) {
  let secret = clientSecret;
  if (!secret) {
    const { rows: [o] } = await query('SELECT sso_secret_enc FROM organizations WHERE organization_id = $1', [admin.organization_id]);
    if (!o.sso_secret_enc) throw badRequest('Enter the client secret.', { fields: { clientSecret: 'Enter the client secret.' } });
    secret = decrypt(o.sso_secret_enc);
  }
  try {
    await testConnection({ issuer, clientId, clientSecret: secret });
  } catch (err) {
    if (err instanceof SsoError) throw badRequest(`The test sign-in failed: ${err.message}  Nothing was changed.`);
    throw err;
  }
  await transaction(async (db) => {
    await db.query(
      `UPDATE organizations SET sso_issuer = $2, sso_client_id = $3, sso_secret_enc = $4, sso_enabled = true, sso_checked_at = now()
        WHERE organization_id = $1`,
      [admin.organization_id, issuer, clientId, encrypt(secret)],
    );
    await audit(db, admin, admin.organization_id, 'SSO_CONNECTED', 'ORGANIZATION', admin.organization_id, issuer);
  });
  return sso(admin);
}

async function disconnectSso(admin) {
  await transaction(async (db) => {
    await db.query(
      `UPDATE organizations SET sso_issuer = NULL, sso_client_id = NULL, sso_secret_enc = NULL, sso_enabled = false,
              sso_checked_at = NULL
        WHERE organization_id = $1`,
      [admin.organization_id],
    );
    await audit(db, admin, admin.organization_id, 'SSO_DISCONNECTED', 'ORGANIZATION', admin.organization_id);
  });
  return sso(admin);
}

module.exports = {
  PUBLIC_DOMAINS, record, requestAccess, requests, checkDomains, activate, reject,
  domains, addDomain, removeDomain, settings, updateSettings, sso, connectSso, disconnectSso,
};
