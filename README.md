# Harbour Payroll

Employee payroll management for a single or multi-organisation deployment. MERN stack (MongoDB, Express, React, Node), TypeScript throughout. Money is held as integer paise. All demo data is synthetic.

**Status:** working application with automated tests. The India statutory rules shipped in the seed are **test-only illustrations and are not verified**. Have a qualified payroll professional configure and verify rules before any real payroll run. See [docs/payroll-rules.md](docs/payroll-rules.md).

## Prerequisites

- Node.js 22 LTS (tested on 22.22.2) and npm 10
- MongoDB 7 or later, **run as a replica set** so payroll finalisation is transactional. A standalone `mongod` also works but finalisation then falls back to guarded updates with compensation (see [docs/architecture.md](docs/architecture.md)).
  - Easiest: `docker compose up -d mongo` (single-node replica set, defined in `docker-compose.yml`)
  - Local install: start `mongod --replSet rs0` and run `rs.initiate()` once in `mongosh`

## Setup

```bash
npm install                       # installs both workspaces
cp .env.example backend/.env      # then edit: set JWT_SECRET and SEED_DEMO_PASSWORD
cp .env.example frontend/.env     # only VITE_API_URL is read here
npm run seed                      # synthetic org, 6 demo users, 8 employees (add -- --reset to wipe a dev DB)
npm run dev:backend               # http://localhost:4000  (docs at /api/docs)
npm run dev:frontend              # http://localhost:5173  (proxies /api to :4000)
```

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

### Demo users

All use the password you set in `SEED_DEMO_PASSWORD`. For the local development database seeded on this machine, that password is `Demo2b8296b326b6Aa1` (also in `backend/.env`). Do not reuse it outside local development.

| Role | Email |
|---|---|
| System Administrator | admin@example.test |
| HR Administrator | hr@example.test |
| Payroll Administrator | payroll@example.test |
| Manager | manager@example.test |
| Finance Approver | finance@example.test |
| Employee | employee@example.test |

To run locally, start `npm run dev:backend` and `npm run dev:frontend` in separate terminals. The UI is at http://localhost:5173.

Suggested first walk-through: sign in as **payroll**, create a period (Payroll Processing), then Calculate. Sign out, sign in as **finance** to approve, back to **payroll** to finalise, **finance** to record payment, and **employee** to download the payslip.

## Commands

| Task | Command |
|---|---|
| Backend unit + integration tests | `npm test -w backend` (starts an in-memory MongoDB replica set; first run downloads a MongoDB binary) |
| Frontend unit tests | `npm test -w frontend` |
| End-to-end (Playwright) | `cd frontend && npx playwright install chromium && npx playwright test` (starts its own in-memory DB, API and Vite) |
| Lint | `npm run lint` |
| Type check | `npm run typecheck -w backend` / `npm run typecheck -w frontend` |
| Build | `npm run build` (outputs `backend/dist`, `frontend/dist`) |
| Run built backend | `npm start -w backend` |

Tests never touch a real database. To run integration tests against your own server set `TEST_MONGODB_URI`; its name must contain "test".

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test`, `staging`, `production` | `development` |
| `PORT` | API port | `4000` |
| `MONGODB_URI` | Connection string | `mongodb://127.0.0.1:27017/payroll` |
| `JWT_SECRET` | Signs session cookies, 32+ characters, required | none |
| `SESSION_TTL_HOURS` | Session lifetime | `8` |
| `CORS_ORIGINS` | Comma-separated trusted origins | `http://localhost:5173` |
| `COOKIE_SECURE` | `true` in production (enforced) | `false` |
| `LOG_LEVEL` | pino level | `info` |
| `SEED_DEMO_PASSWORD` | Password for demo users (12+ chars); seeding refuses to run in production | none |
| `VITE_API_URL` | API base used by the built frontend | `/api/v1` |

## Docker

```bash
docker compose up --build        # mongo (replica set), api on :4000, web on :8080
```

Compose reads `JWT_SECRET` and `SEED_DEMO_PASSWORD` from your shell or a root `.env`; it has no embedded secrets.

## Health checks

- `GET /health`: process is up
- `GET /ready`: returns 503 until MongoDB is connected

## Documentation

- [Architecture](docs/architecture.md), [Database design](docs/database-design.md), [API specification](docs/api-specification.md)
- [Payroll rules and verification status](docs/payroll-rules.md), [Security](docs/security.md), [Deployment and CI](docs/deployment.md)
- Interactive API reference: `/api/docs` when the backend runs

## Selected dependency versions

Backend: Express 5.3.0, Mongoose 9.11.4, Zod 4.6.7, Pino 10.4.0, Helmet 8.3.0, argon2 0.45.1, PDFKit 0.20.2, Vitest 5.0.5, TypeScript 6.0.3.
Frontend: React 19.3.1, Vite 8.3.5, Tailwind CSS 4.3.3, TanStack Query 5.105.0, React Hook Form 7.91.0, Recharts 3.10.1, Playwright 1.64.1, TypeScript 7.0.2.
Exact versions are pinned in `package-lock.json`.

## Known limitations

See the "Not implemented" section of [docs/architecture.md](docs/architecture.md). Notably: no MFA, no outbound email (password reset links are logged in development only), no field-level encryption of bank and PAN values, no Form 16 generation, and simplified TDS.
