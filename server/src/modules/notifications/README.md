# Notifications module

## Purpose

Notifications module (Table 7, FR-8).  Foundation used by every other module: creates the in-application notification; a sweep emails it when the user has enabled email notifications (FR-1.11, FR-8.2).

Requirements: FR-1.11, FR-6.6, FR-8, FR-8.2, FR-8.3, FR-8.4, FR-8.5, FR-17.7.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/notifications` | signed in |
| GET | `/api/notifications/unread` | signed in |
| PATCH | `/api/notifications/:id` | signed in |
| POST | `/api/notifications/read` | signed in |

Functions exported to other modules and jobs: `notify`, `notifyAll`, `sendPendingEmails`, `staffOf`.

Background jobs (`jobs.js`, started by `src/server.js`): `emails`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/config.js`, `src/db/pool.js`, `src/lib/errors.js`, `src/lib/mailer.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `notifications`, `users`.

## Files

- `jobs.js`: background jobs
- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
