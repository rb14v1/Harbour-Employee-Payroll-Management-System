# Deployment and CI

## Environments

Set `NODE_ENV` to `development`, `test`, `staging` or `production`. Production refuses to start with `COOKIE_SECURE=false` or a `JWT_SECRET` under 32 characters. Seeding refuses to run in production. The frontend reads `VITE_API_URL` at build time (default `/api/v1`, same origin); no localhost URL is compiled in.

## Topology

```
browser -> reverse proxy / ingress (TLS)
             ├─ /          -> static frontend (nginx image in frontend/Dockerfile)
             └─ /api       -> backend (Node 22, port 4000)  -> MongoDB replica set
```

Serve the frontend and API on the same origin so the session cookie stays first-party. If you must split origins, set `CORS_ORIGINS`, use `SameSite=None` with HTTPS (requires a code change in `auth.routes.ts`) and review CSRF handling.

## Docker Compose (development and demo)

`docker compose up --build` starts a single-node MongoDB replica set, the API on 4000 and the web container on 8080 (nginx proxies `/api` to the API). Provide `JWT_SECRET` and `SEED_DEMO_PASSWORD` through your shell or a root `.env`. The compose file runs the API with `NODE_ENV=development` so demo seeding is allowed. Seed with `docker compose exec api node dist/seed.js`. Do not use this compose file as a production definition.

## Production checklist

1. MongoDB as a replica set (three nodes or a managed service), authentication on, TLS, encryption at rest, backups with a tested restore.
2. Secrets from a secret manager, not files in the image. Rotate `JWT_SECRET` to invalidate all sessions.
3. Two or more API replicas behind the proxy are fine: sessions are in MongoDB. Replace the in-memory rate limiter store with a shared one first.
4. `COOKIE_SECURE=true`, TLS everywhere, HSTS at the proxy.
5. Create the first system administrator by a one-off script (not the demo seed), then create real users in the UI.
6. Load verified payroll policy versions (see [payroll-rules.md](payroll-rules.md)) and remove or deactivate demo data.
7. Ship logs (pino JSON with `requestId`) and audit events to your logging platform. Alert on 5xx rate, `/ready` failures and failed-login spikes.
8. Configure an email provider for password reset.
9. Implement the retention and archival policy in [database-design.md](database-design.md).

## Health checks

- Liveness: `GET /health` returns 200 while the process runs.
- Readiness: `GET /ready` returns 200 when MongoDB is connected, otherwise 503.
- Shutdown: SIGTERM stops accepting connections, closes the HTTP server, disconnects MongoDB, and force-exits after 10 seconds.

## CI

`.github/workflows/ci.yml` runs on push and pull request: install, lint, type check, backend tests (in-memory replica set), frontend tests, build, `npm audit --omit=dev`, then Playwright. Recommended additions: dependency update bot, container image scanning, a staging deploy gated on the main branch, and a nightly job that runs the full suite against a MongoDB container.

## Backups and recovery

Payroll data is the system of record. Take point-in-time backups, test restores, and never restore over a live replica set without stopping writers. Finalised batches are immutable in the application; a restore must not resurrect a batch in an earlier state after payments were released.
