# Tags module

## Purpose

FoundU QR tags (FR-12): a user registers a belonging, prints its QR sticker, and a finder who scans it sends the owner an anonymous message.  The public side never reveals who the owner is (FR-12.6).  Nothing works while the owner's organization has QR tags turned off (FR-18.7).

Requirements: FR-8, FR-12, FR-12.1, FR-12.2, FR-12.3, FR-12.4, FR-12.6, FR-12.7, FR-12.9, FR-12.10, FR-12.11, FR-18.7.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/tags` | signed in |
| POST | `/api/tags` | signed in |
| GET | `/api/tags/sheet` | signed in |
| GET | `/api/tags/:id/messages` | signed in |
| GET | `/api/tags/:id/qr.svg` | signed in |
| GET | `/api/tags/:id/photo` | signed in |
| POST | `/api/tags/:id/deactivate` | signed in |
| POST | `/api/tags/:id/activate` | signed in |
| DELETE | `/api/tags/:id` | signed in |
| GET | `/api/tags/:token` | anyone |
| POST | `/api/tags/:token/messages` | anyone |

Functions exported to other modules and jobs: `TOKEN_BYTES`, `MESSAGES_PER_HOUR`, `tagUrl`, `list`, `create`, `setActive`, `remove`, `messages`, `photoPath`, `qrSvg`, `stickerSheet`, `publicTag`, `sendMessage`, `deviceHash`.

## Dependencies

- Other modules: `notifications`.
- Shared code: `src/config.js`, `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/storage.js`, `src/middleware/auth.js`.
- Packages: `express`, `multer`, `pdfkit`, `qrcode`, `zod`.
- Tables: `categories`, `organizations`, `qr_messages`, `qr_tags`, `users`.

## Files

- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
