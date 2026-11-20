# My data module

## Purpose

Personal data rights (FR-17.6, FR-17.7, NFR-22): a user downloads, corrects and deletes their own personal data.  Every function works on the signed-in user only; there is no way to name another user.

Requirements: FR-17.5, FR-17.6, FR-17.7, NFR-10.1, NFR-22.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/me/data` | signed in |
| PATCH | `/api/me/profile` | signed in |
| DELETE | `/api/me` | signed in |

Functions exported to other modules and jobs: `exportData`, `correctProfile`, `deleteData`, `DELETED_TEXT`.

## Dependencies

- Other modules: `notifications`, `retention`.
- Shared code: `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/storage.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `audit_log`, `campuses`, `categories`, `claims`, `karma_events`, `locations`, `messages`, `notifications`, `organizations`, `otp_codes`, `photos`, `post_contacts`, `post_history`, `posts`, `qr_messages`, `qr_tags`, `reports`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
