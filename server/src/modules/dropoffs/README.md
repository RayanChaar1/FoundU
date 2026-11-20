# Dropoffs module

## Purpose

Drop-off points (FR-14): the official list, items received and held, and posts for finders without an account.  The release itself is the handover of the claims module, with the ID check of FR-14.5.

Requirements: FR-14, FR-14.1, FR-14.2, FR-14.3, FR-14.4, FR-14.5, FR-14.7.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/dropoffs` | signed in |
| POST | `/api/dropoffs` | organization administrator |
| GET | `/api/dropoffs/:id/items` | security officer or administrator |
| POST | `/api/dropoffs/:id/items` | security officer or administrator |
| POST | `/api/dropoffs/:id/posts` | security officer or administrator |

Functions exported to other modules and jobs: `list`, `point`, `create`, `items`, `receive`, `postForVisitor`.

Events published (`src/lib/events.js`): `dropoff.received`.

## Dependencies

- Other modules: `posts`.
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `audit_log`, `campuses`, `categories`, `claims`, `dropoff_points`, `locations`, `post_history`, `posts`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
