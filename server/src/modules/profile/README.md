# Profile module

## Purpose

My Posts and Profile module (Table 7, FR-10): the user's activity dashboard and public profiles.

Requirements: FR-7.6, FR-10, FR-10.1, FR-10.6, FR-10.7, FR-18.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/me/activity` | signed in |
| GET | `/api/users/:id` | signed in |

Functions exported to other modules and jobs: `activity`, `profile`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/lib/errors.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `badges`, `campuses`, `claims`, `locations`, `organizations`, `photos`, `posts`, `user_badges`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
