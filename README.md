# FoundU

Smart, secure lost and found for every campus.  FoundU is a web platform where members of an organization post lost and found items, get notified of likely matches, prove ownership through a verification question, and complete the handover with a one-time code.

CSC490 Software Engineering, Lebanese American University, Fall 2026 (Dr. Ramzi Haraty).
Team AJMR²: Rayan El Chaar, Jean-Marie Agha, Ramez Naba, Adam Jaat, Mohamad Moubarak.

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

### Single sign-on during development

`server/dev/idp.js` is a small OpenID Connect provider that plays the part of LAU's identity provider (FR-1.2, NFR-25.1).

1. Start it with `npm run idp --workspace server`.  It listens on http://localhost:4001.
2. Sign in as maya.azar@lau.edu and open Admin › Organization › Single sign-on.  Enter the issuer `http://localhost:4001`, the client ID `foundu` and the client secret `dev-secret`, then choose **Test and connect**.
3. Sign out.  LAU addresses now get a **Sign in with Lebanese American University** button instead of a code.  On the provider's page, any LAU address signs in with the password `demo-password`.

Choose **Disconnect** on the same panel to go back to sign-in codes.

### Email through SMTP during development

Without SMTP settings, emails are written to `server/outbox/`.  To send them through SMTP (NFR-25.2), `server/dev/smtp.js` plays the part of the organization's mail server: STARTTLS with its own certificate, then a user name and password.

1. Start it with `npm run smtp --workspace server`.  It listens on localhost:2587 and prints the path of its certificate.
2. Start the API with `SMTP_HOST=localhost SMTP_PORT=2587 SMTP_USER=foundu SMTP_PASS=dev-smtp-pass NODE_EXTRA_CA_CERTS=<that path>`.
3. Every email (sign-in codes, notifications) now appears in the SMTP server's window.  With a wrong password the server answers 535: the API logs the error and sends the notification at its next sweep, 20 seconds later.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API (port 4000) and the client (port 5173) with live reload |
| `npm test` | Run the server test suite against a separate `foundu_test` database |
| `npm run lint` | Check the server and client code with ESLint (`eslint.config.js`); it must report no error before a pull request |
| `npm run test:ci --workspace server` | Run the tests as the pipeline does, with the coverage of the business logic (service and repository files), which must stay at 70% of lines or more |
| `npm run db:migrate` | Apply new migrations from `server/src/db/migrations/` |
| `npm run db:seed` | Replace all data with the demo organizations, users and categories |
| `npm run db:reset` | Drop every table, migrate again and seed |
| `npm run db:demo` | After `db:reset`, add the presentation data: posts on both campuses, a finished return, a QR tag and a report (photos from `server/demo/photos/`) |
| `npm run idp --workspace server` | Start the development identity provider for single sign-on (port 4001) |
| `npm run smtp --workspace server` | Start the development SMTP server (port 2587) |

## Security and performance

The results of the security and performance checks are in [docs/security-performance.md](docs/security-performance.md).

The execution results of the 420 Phase III test cases, one signed sheet per member, are in [docs/test-results/](docs/test-results/).

**HTTPS (NFR-9).**  The demo runs over HTTP on the laptop.  To serve the API over HTTPS (TLS 1.2 or later only), set `TLS_CERT` and `TLS_KEY` in `server/.env` to a certificate and its key.  A certificate for local tests:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=localhost"
```

**Performance (NFR-1 to NFR-3).**  The scripts in `server/perf/` fill a separate database with 50,000 posts and measure searches, Smart Match and 200 users browsing at once.  The seed refuses any database whose name does not contain `perf`.

```bash
createdb -U postgres foundu_perf
```

```bash
cd server && export DATABASE_URL=postgres://postgres@localhost:5432/foundu_perf && npm run db:migrate && npm run db:seed && npm run perf:seed
```

Then start the API on that database with `PORT=4100 node --env-file=.env src/server.js` (same `DATABASE_URL`, which takes precedence over `.env`) and, in a second terminal with the same `DATABASE_URL`, run `npm run perf:search`, `npm run perf:match` (50 posts) and `npm run perf:load -- 200 900` (200 users for 15 minutes).

## Project structure

```
client/                 React application
  src/pages/            One component per screen
  src/components/       Shared components (layout, form fields, post cards)
  src/modules/<name>/   Self-contained feature modules picked up by registry.js
  src/api.js            Fetch wrapper for the REST API
server/
  src/app.js            Express application and route mounting
  src/modules/<name>/   routes.js, service.js, repository.js per module
  src/lib/              Encryption, email, photo storage, status rules
  src/middleware/       Authentication, roles and error handling
  src/db/migrations/    Numbered SQL migrations
  tests/                Jest tests, one file per requirement group
  perf/                 Performance data and load scripts (NFR-1 to NFR-3)
```

## Adding a module

Modules are discovered automatically, so a new module only adds files and never edits a shared list:

- **Server:** `server/src/modules/<name>/routes.js` is mounted under `/api`; an optional `jobs.js` exports background jobs (`[{ name, everyMs, run }]`).  Modules talk to each other through events (`lib/events.js`), for example `post.published` or `handover.completed`.
- **Client:** `client/src/modules/<name>/index.jsx` exports its routes, nav links, top-bar items and panels for the post and claim pages (see `client/src/modules/registry.js`).  Keep the module's styles in its own CSS file imported by `index.jsx`.
- **Database:** add a migration with the module's number range, for example `010_messaging.sql`; migrations run once each, in any order.
- **Tests:** add `server/tests/frNN-<name>.test.js` with tests named after the Phase III test cases.
- **Documentation:** add `server/src/modules/<name>/README.md` with the sections Purpose, Interface and Dependencies (NFR-15.3); `npm test` fails without it.

## How we work

1. Pick an issue from the GitHub project board and assign it to yourself.
2. Create a branch from `main`: `git checkout -b fr-7-messaging`.
3. Commit in small steps and push the branch.
4. Open a pull request that references the issue (`Closes #12`) and lists the test cases it satisfies.
5. Another member reviews the pull request before it is merged.  Nobody pushes to `main` directly.

**Continuous integration.**  GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs three checks on every pull request: **Lint** (ESLint on the server and the client), **Tests and coverage** (the server tests on PostgreSQL, failing under 70% line coverage of the business logic), and **Task reference** (the description names a GitHub issue or an OpenProject work package).  Lint and Tests and coverage are required by the ruleset of `main`, so a pull request that fails either cannot be merged; Task reference flags the pull request for the reviewer.

Each test is named after its Phase III test case, for example `TC-FR-6.4-D`, so the test run maps one to one onto the Chapter 9 test suite.  Add a migration as a new numbered file; never edit a migration that is already on `main`.
