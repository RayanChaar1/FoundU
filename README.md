# FoundU

Smart, secure lost and found for every campus.  FoundU is a web platform where members of an organization post lost and found items, get notified of likely matches, prove ownership through a verification question, and complete the handover with a one-time code.

CSC490 Software Engineering, Lebanese American University, Fall 2026 (Dr. Ramzi Haraty).
Team AJMR²: Rayan El Chaar, Jean-Marie Agha, Ramez Naba, Adam Jaat, Mohammad Moubarak.

## Stack

| Layer | Technology |
| --- | --- |
| Client | React 19 single-page application built with Vite |
| Server | Node.js 24, Express 5 REST API, zod validation |
| Database | PostgreSQL 18 (full-text search with `tsvector`) |
| Security | Email one-time codes, JWT in an httpOnly cookie, argon2id hashes, AES-256-GCM encryption, helmet, rate limiting |
| Photos | multer, sharp (WebP, at most 1 MB), heic-convert |
| Tests | Jest and supertest, named after the Phase III test case IDs |

The architecture follows Chapter 5 of the Phase II report: an interface layer (`server/src/app.js`), one folder per module under `server/src/modules/` (routes, service, repository), and a data layer (`server/src/db/`).

## Getting started

Requirements: Node.js 24 or later and PostgreSQL 18 running on `localhost:5432`.

```bash
git clone https://github.com/RayanChaar1/FoundU.git
cd FoundU
npm install
cp server/.env.example server/.env
```

Edit `server/.env` and replace `JWT_SECRET` and `DATA_KEY` with random values (64 hex characters each):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the database, load the demo data and start both servers:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:5173.  The API runs on http://localhost:4000.

> npm 11 may warn that install scripts were skipped for `argon2` and `@parcel/watcher`.  Both still work through their prebuilt binaries, so the warning is safe to ignore.

### Signing in during development

With `SMTP_HOST` empty, emails are written to `server/outbox/` instead of being sent.  Enter one of the seeded addresses, open the newest file in `server/outbox/`, and type the 6-digit code.

| Email | Name | Role |
| --- | --- | --- |
| sara.k@lau.edu | Sara Khoury | User |
| omar.h@lau.edu | Omar Haddad | User |
| lea.n@lau.edu | Lea Nassar | User |
| k.saad@lau.edu | Karim Saad | Security officer |
| maya.azar@lau.edu | Maya Azar | Organization administrator |
| john@acme.com | John Doe | User (Acme Corp, a second organization) |
| pa@foundu.app | Platform Admin | Platform administrator |

Any other `@lau.edu` or `@lau.edu.lb` address creates a new account on first sign-in.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API (port 4000) and the client (port 5173) with live reload |
| `npm test` | Run the server test suite against a separate `foundu_test` database |
| `npm run db:migrate` | Apply new migrations from `server/src/db/migrations/` |
| `npm run db:seed` | Replace all data with the demo organizations, users and categories |
| `npm run db:reset` | Drop every table, migrate again and seed |

## Project structure

```
client/                 React application
  src/pages/            One component per screen
  src/components/       Shared components (layout, form fields, post cards)
  src/api.js            Fetch wrapper for the REST API
server/
  src/app.js            Express application and route mounting
  src/modules/<name>/   routes.js, service.js, repository.js per module
  src/lib/              Encryption, email, photo storage, status rules
  src/middleware/       Authentication, roles and error handling
  src/db/migrations/    Numbered SQL migrations
  tests/                Jest tests, one file per requirement group
```

## How we work

1. Pick an issue from the GitHub project board and assign it to yourself.
2. Create a branch from `main`: `git checkout -b fr-7-messaging`.
3. Commit in small steps and push the branch.
4. Open a pull request that references the issue (`Closes #12`) and lists the test cases it satisfies.
5. Another member reviews the pull request before it is merged.  Nobody pushes to `main` directly.

Each test is named after its Phase III test case, for example `TC-FR-6.4-D`, so the test run maps one to one onto the Chapter 9 test suite.  Add a migration as a new numbered file; never edit a migration that is already on `main`.
