# Search module

## Purpose

Search and Map module (Table 7): feed, keyword search, filters, post details, photos.

Requirements: FR-3.5, FR-3.8, FR-4.1, FR-4.4, FR-4.6, FR-4.7, FR-4.8, FR-4.9, FR-15.3, FR-17.2.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/posts` | signed in |
| GET | `/api/posts/:id` | signed in |
| GET | `/api/photos/:id` | signed in |

Functions exported to other modules and jobs: `searchPosts`, `postDetail`, `badgesOf`, `photoIds`, `photoWithPost`, `isApprovedClaimant`, `PAGE_SIZE`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/storage.js`, `src/middleware/auth.js`.
- Packages: `express`, `zod`.
- Tables: `badges`, `campuses`, `categories`, `claims`, `dropoff_points`, `locations`, `photos`, `posts`, `user_badges`, `users`.

## Files

- `repository.js`: SQL queries
- `routes.js`: HTTP routes and input validation (zod)
