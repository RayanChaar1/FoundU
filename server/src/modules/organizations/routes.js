/* Organization management API (FR-18).
   - The access request is public: the organization has no account yet (FR-18.1).
   - Reviewing requests is for platform administrators only (FR-18.2).
   - Domains, feature switches and single sign-on are for the organization's own administrators (FR-18.5 to FR-18.8). */
const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { requireRole } = require('../../middleware/auth');

const router = express.Router();
const platform = requireRole('platform');
const admin = requireRole('admin');
const id = z.coerce.number().int().positive();
const text = (max, message) => z.string({ error: message }).trim().min(1, message).max(max, `At most ${max} characters.`);
const coordinate = (max, label) => z.coerce.number({ error: `Enter the ${label}.` })
  .min(-max, `The ${label} is between -${max} and ${max}.`).max(max, `The ${label} is between -${max} and ${max}.`);

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const domain = z.string({ error: 'Enter a domain.' }).trim().toLowerCase()
  .regex(DOMAIN, 'Enter a domain such as lau.edu, without @ or www.');

const requestSchema = z.object({
  name: text(100, 'Enter the name of the organization.'),
  type: z.enum(['UNIVERSITY', 'COMPANY'], { error: 'Choose University or Company.' }),
  domains: z.array(domain, { error: 'Enter at least one email domain.' })
    .min(1, 'Enter at least one email domain.').max(10, 'At most 10 domains.'),
  campuses: z.array(z.object({
    name: text(60, 'Enter the name of the campus.'),
    latitude: coordinate(90, 'latitude'),
    longitude: coordinate(180, 'longitude'),
  }), { error: 'Enter at least one campus.' }).min(1, 'Enter at least one campus.').max(20, 'At most 20 campuses.'),
  contactName: text(100, 'Enter the name of the contact administrator.'),
  contactEmail: z.email({ error: 'Enter a valid email address.' }).max(120),
});

/** HTTPS only, except a provider on this computer outside production (the demo and the tests). */
const issuer = z.url({ error: 'Enter the issuer URL, for example https://login.example.com.' }).max(200)
  .refine((u) => {
    if (!URL.canParse(u)) return true; // already reported by z.url()
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:'
      || (process.env.NODE_ENV !== 'production' && protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname));
  }, 'The issuer URL starts with https://.');
const ssoSchema = z.object({
  issuer,
  clientId: text(200, 'Enter the client ID.'),
  clientSecret: z.string().max(500).optional().default(''),
});
const settingsSchema = z.object({ karmaEnabled: z.boolean().optional(), qrEnabled: z.boolean().optional() }).strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');

// FR-18.1: no account needed
router.post('/organizations/requests', async (req, res) => {
  res.status(201).json(await service.requestAccess(requestSchema.parse(req.body)));
});

// FR-18.2: platform administrators
router.get('/platform/organizations', platform, async (req, res) => {
  const status = z.enum(['PENDING', 'ACTIVE', 'REJECTED']).optional().catch(undefined).parse(req.query.status);
  res.json({ organizations: await service.requests(status) });
});
router.get('/platform/organizations/:id/dns', platform, async (req, res) => {
  res.json({ checks: await service.checkDomains(id.parse(req.params.id)) });
});
router.post('/platform/organizations/:id/activate', platform, async (req, res) => {
  res.json(await service.activate(req.user, id.parse(req.params.id)));
});
router.post('/platform/organizations/:id/reject', platform, async (req, res) => {
  const { reason } = z.object({ reason: text(500, 'Give the reason for the rejection.') }).parse(req.body);
  res.json(await service.reject(req.user, id.parse(req.params.id), reason));
});

// FR-18.5: email domains
router.get('/org/domains', admin, async (req, res) => res.json(await service.domains(req.user)));
router.post('/org/domains', admin, async (req, res) => {
  res.status(201).json(await service.addDomain(req.user, z.object({ domain }).parse(req.body).domain));
});
router.delete('/org/domains/:domain', admin, async (req, res) => {
  res.json(await service.removeDomain(req.user, domain.parse(req.params.domain)));
});

// FR-18.6, FR-18.7: karma points and QR tags
router.get('/org/settings', admin, async (req, res) => res.json(await service.settings(req.user)));
router.patch('/org/settings', admin, async (req, res) => {
  res.json(await service.updateSettings(req.user, settingsSchema.parse(req.body)));
});

// FR-18.8: the organization's identity provider
router.get('/org/sso', admin, async (req, res) => res.json(await service.sso(req.user)));
router.put('/org/sso', admin, async (req, res) => res.json(await service.connectSso(req.user, ssoSchema.parse(req.body))));
router.delete('/org/sso', admin, async (req, res) => res.json(await service.disconnectSso(req.user)));

module.exports = router;
