# Accounts module

## Purpose

Accounts module (Table 7, FR-1): passwordless sign-in with a 6-digit code sent to the organization email address, single sign-on through the organization identity provider when it is enabled, the first-sign-in profile, sessions in an HTTP-only cookie renewed on use, and sign-out on every device.

Requirements: FR-1.1, FR-1.2, FR-1.3, FR-1.4, FR-1.5, FR-1.6, FR-1.7, FR-1.8, FR-1.11, FR-13.5, NFR-25.1.

## Interface

HTTP routes, mounted by `src/app.js` under `/api`:

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/start` | anyone |
| GET | `/api/auth/sso/start` | anyone |
| GET | `/api/auth/sso/callback` | anyone |
| GET | `/api/auth/pending` | anyone |
| POST | `/api/auth/verify` | anyone |
| POST | `/api/auth/profile` | anyone |
| POST | `/api/auth/logout` | anyone |
| GET | `/api/auth/me` | signed in |
| PATCH | `/api/me/preferences` | signed in |

Functions exported to other modules and jobs: `startSignIn`, `verifyCode`, `completeProfile`, `updatePreferences`, `beginSso`, `finishSso`, `pendingProfile`, `SsoFailure`.

## Dependencies

- Other modules: `organizations`.
- Shared code: `src/config.js`, `src/db/pool.js`, `src/lib/crypto.js`, `src/lib/errors.js`, `src/lib/mailer.js`, `src/middleware/auth.js`.
- Packages: `express`, `jsonwebtoken`, `zod`.
- Tables: `campuses`, `organizations`, `otp_codes`, `users`.

## Files

- `repository.js`: SQL queries
- `routes.js`: HTTP routes and input validation (zod)
- `service.js`: business rules
