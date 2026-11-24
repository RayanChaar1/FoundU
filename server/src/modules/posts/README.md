# Posts module

## Purpose

Posts module (Table 7): lost and found posts, photos, editing, closing, sensitive items, digit masking.

Requirements: FR-2.1, FR-2.3, FR-2.6, FR-2.8, FR-2.9, FR-2.10, FR-3.1, FR-3.3, FR-3.7, FR-3.9, FR-5.7, FR-10.2, FR-10.3, FR-10.4, FR-10.5, FR-14.1, FR-14.3, FR-17.1, FR-17.4, FR-18.4, NFR-10.1.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/posts/lost` | signed in |
| POST | `/api/posts/found` | signed in |
| PATCH | `/api/posts/:id` | signed in |
| DELETE | `/api/posts/:id` | signed in |
| POST | `/api/posts/:id/close` | signed in |
| POST | `/api/posts/:id/photos` | signed in |
| DELETE | `/api/posts/:id/photos/:photoId` | signed in |
| GET | `/api/posts/:id/history` | signed in |
| ANY | `/api/posts/:id/history/:entry` | anyone (always refused with 405: the history is read-only) |
| DELETE | `/api/posts/:id/history` | anyone (always refused with 405: the history is read-only) |
| PATCH | `/api/posts/:id/history` | anyone (always refused with 405: the history is read-only) |
| PUT | `/api/posts/:id/history` | anyone (always refused with 405: the history is read-only) |

Functions exported to other modules and jobs: `create`, `edit`, `remove`, `close`, `addPhotos`, `deletePhoto`, `history`, `ownPost`.

Events published (`src/lib/events.js`): `post.closed`, `post.published`, `post.updated`.

## Dependencies

- Other modules: none (other modules reach it through events).
- Shared code: `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/events.js`, `src/lib/mask.js`, `src/lib/postStatus.js`, `src/lib/storage.js`, `src/middleware/auth.js`.
- Packages: `express`, `multer`, `zod`.
- Tables: `categories`, `claims`, `dropoff_points`, `locations`, `photos`, `post_history`, `posts`, `users`.

## Files

- `repository.js`: SQL queries
- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules


## In the demo
1. Sign in as sara.k@lau.edu; the six-digit code is in server/outbox/ (development mailer).
2. Open *New post, choose **Lost*, and first publish with the title empty to show the validation message.
3. Fill in "Wireless earbuds in a silver case", category Electronics, Riyad Nassar Library, today, and add a photo.
4. Publish: the post is Open on the feed, and Smart Match compares it with the open found posts at once.
