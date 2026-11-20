# Organizations module

## Purpose

Organization management (FR-18): access requests and their activation by a platform administrator, the email domains of an organization, its karma and QR tag switches, and its own identity provider.  Campuses, buildings, drop-off points and categories are managed on the administration page of FR-16.

Requirements: FR-1.2, FR-16, FR-18, FR-18.1, FR-18.2, FR-18.5, FR-18.6, FR-18.7, FR-18.8, NFR-25.1.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/organizations/requests` | anyone |
| GET | `/api/platform/organizations` | platform administrator |
| GET | `/api/platform/organizations/:id/dns` | platform administrator |
| POST | `/api/platform/organizations/:id/activate` | platform administrator |
| POST | `/api/platform/organizations/:id/reject` | platform administrator |
| GET | `/api/org/domains` | organization administrator |
| POST | `/api/org/domains` | organization administrator |
| DELETE | `/api/org/domains/:domain` | organization administrator |
| GET | `/api/org/settings` | organization administrator |
| PATCH | `/api/org/settings` | organization administrator |
| GET | `/api/org/sso` | organization administrator |
| PUT | `/api/org/sso` | organization administrator |
| DELETE | `/api/org/sso` | organization administrator |

Functions exported to other modules and jobs: `PUBLIC_DOMAINS`, `record`, `requestAccess`, `requests`, `checkDomains`, `activate`, `reject`, `domains`, `addDomain`, `removeDomain`, `settings`, `updateSettings`, `sso`, `connectSso`, `disconnectSso`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/config.js`, `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/mailer.js`, `src/middleware/auth.js`.
- Packages: `express`, `node:crypto`, `zod`.
- Tables: `audit_log`, `campuses`, `organizations`, `users`.

## Files

- `dns.js`: DNS check of the email domain
- `oidc.js`: OpenID Connect client for single sign-on
- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
