# Moderation module

## Purpose

Reporting and moderation (FR-15): reports of posts and messages, automatic hiding, the moderators' queue, the four actions, the author's notification, and the audit log.

Requirements: FR-15, FR-15.1, FR-15.2, FR-15.3, FR-15.4, FR-15.5, FR-15.6, FR-15.7.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/reports` | signed in |
| GET | `/api/moderation/reports` | security officer or administrator |
| POST | `/api/moderation/reports/:id` | security officer or administrator |
| GET | `/api/audit` | organization administrator |
| ANY other | `/api/audit`, `/api/audit/:id` | organization administrator (always refused with 405: the audit log is append-only) |

Functions exported to other modules and jobs: `report`, `queue`, `act`, `auditLog`, `AUTO_HIDE_REPORTERS`, `REMOVED_MESSAGE`.

Events published (`src/lib/events.js`): `content.removed`, `report.created`, `report.upheld`.

## Dependencies

- Other modules: `notifications`.
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/lib/postStatus.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `audit_log`, `claims`, `messages`, `post_history`, `posts`, `reports`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
