# Messaging module

## Purpose

Private Messaging module (Table 7, FR-7): one conversation per approved claim, between the claimant (the owner of the item) and the finder.  A conversation is identified by its claim.

Requirements: FR-6.12, FR-7, FR-7.1, FR-7.2, FR-7.3, FR-7.4, FR-7.5, FR-7.6, FR-7.7, FR-8.5, FR-15, FR-15.2.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/conversations` | signed in |
| GET | `/api/conversations/:id` | signed in |
| POST | `/api/conversations/:id/messages` | signed in |
| POST | `/api/messages/:id/report` | signed in |

Functions exported to other modules and jobs: `list`, `get`, `send`, `report`.

Events published (`src/lib/events.js`): `report.created`.

## Dependencies

- Other modules: `notifications`, `search`.
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `audit_log`, `claims`, `messages`, `posts`, `reports`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
