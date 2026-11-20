# Claims module

## Purpose

Claims and Handover module (Table 7): ownership claims (FR-6), status management and handover codes (FR-9).

Requirements: FR-6, FR-6.1, FR-6.2, FR-6.3, FR-6.4, FR-6.5, FR-6.6, FR-6.7, FR-6.8, FR-6.9, FR-6.10, FR-6.11, FR-6.12, FR-6.13, FR-6.14, FR-7.1, FR-9, FR-9.3, FR-9.4, FR-9.5, FR-9.6, FR-9.7, FR-9.8, FR-9.9, FR-9.10, FR-9.11, FR-14.5, FR-14.6, FR-18.4, NFR-10.2.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/posts/:id/claims` | signed in |
| GET | `/api/posts/:id/claims` | signed in |
| POST | `/api/posts/:id/contact` | signed in |
| GET | `/api/posts/:id/contacts` | signed in |
| GET | `/api/claims` | signed in |
| GET | `/api/claims/:id` | signed in |
| POST | `/api/claims/:id/approve` | signed in |
| POST | `/api/claims/:id/reject` | signed in |
| POST | `/api/claims/:id/withdraw` | signed in |
| POST | `/api/claims/:id/handover` | signed in |
| POST | `/api/claims/:id/cancel` | signed in |

Functions exported to other modules and jobs: `submit`, `get`, `list`, `listForPost`, `approve`, `reject`, `withdraw`, `confirmHandover`, `cancelHandover`, `contact`, `contacts`, `closeReturnedPosts`, `isReviewer`.

Background jobs (`jobs.js`, started by `src/server.js`): `close-returned`.

Events published (`src/lib/events.js`): `claim.approved`, `claim.submitted`, `handover.completed`, `post.closed`.

## Dependencies

- Other modules: `notifications`.
- Shared code: `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/lib/postStatus.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `claims`, `post_contacts`, `post_history`, `posts`, `users`.

## Files

- `jobs.js`: background jobs
- `repository.js`: SQL queries
- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
