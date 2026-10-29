# Security

Scope: what is implemented, how it is tested, and what remains the deployer's job. Nothing here is a certification.

## Authentication and sessions

- Passwords hashed with argon2 (library defaults, argon2id). Policy: 12 to 128 characters with lower case, upper case and a digit.
- Login returns a signed JWT in an httpOnly cookie (SameSite=Lax, `Secure` when `COOKIE_SECURE=true`, enforced in production). The JWT carries only a session id; the server loads the session and user on every request. Logout, password reset, deactivation and role change revoke sessions immediately.
- Login lockout: five consecutive failures lock the account for 15 minutes. Login, forgot-password and reset-password are limited to 20 requests per 15 minutes per IP. Unknown accounts take the same code path as wrong passwords (dummy hash verification) and return the same message.
- Password reset: random 32-byte token, only its SHA-256 hash is stored, 30 minute expiry, single use. The reset link is **not emailed**; outside production it is logged. Wire an email provider before use.
- CSRF: per-session token required in the `X-CSRF-Token` header on every non-GET request, on top of SameSite=Lax.
- MFA: not implemented. Put the app behind an identity provider that enforces MFA, or add OIDC.

## Authorisation

Permission checks on every protected route, plus object-level scoping described in [architecture.md](architecture.md). Out-of-scope records return 404. Mass assignment is blocked because Zod schemas whitelist fields: client-sent `organizationId`, `role`, `employeeCode`, `status` on create, and similar are dropped.

## Input handling

- Zod validation of body, query and path on all routes; ObjectIds checked by pattern.
- NoSQL injection: query operators arrive as unknown keys and are stripped by Zod; no raw request object is ever passed to a query. Search text is regex-escaped. (Mongoose's `sanitizeFilter` is not enabled because it breaks the application's own operators.)
- 100 kb JSON limit. CSV uploads: `.csv` only, 1 MB, row caps, memory storage (never written to disk), parsed with a size limit per record.
- CSV exports contain no sensitive identifiers.

## Transport and headers

Helmet defaults, CORS restricted to `CORS_ORIGINS` with credentials, `x-powered-by` disabled, `trust proxy` set to 1 only in production. Terminate TLS in front of the API.

## Data protection

- Bank account number, IFSC, account holder and PAN are `select: false`, masked in responses (last four characters), shown only to `employee:sensitive` holders and the employee, and redacted in audit summaries and log output (`pino` redaction paths).
- **Not encrypted at the application level.** Use storage encryption at rest.
- Payslips are generated on demand from the finalised entry and streamed only after an authenticated ownership check. No files are stored and no public URLs exist. Sample organisations produce a visible "SAMPLE - TEST DATA" watermark.

## Auditing

`auditlogs` and `approvalrecords` reject update, delete and replace operations at the model layer, and no HTTP route writes to them. This stops accidental or application-level changes; it does not stop someone with database credentials. Restrict database access, and ship audit events to external immutable storage for stronger guarantees.

Recorded: logins and failures, user and role changes, employee changes, salary revisions, policy versions, input create and review, simulate, calculate, recalculate, submit, approve, reject, finalise, payment, reconciliation, adjustments, payslip downloads, report and employee exports.

## Tests that cover security properties

`backend/tests/auth.test.ts` and `payroll.test.ts` assert: generic login errors, httpOnly cookie, CSRF required, session revocation on logout and reset, lockout, role boundaries, employee and manager scoping, sensitive fields absent from lists and masked in detail, operator-injection keys ignored, mass-assignment ignored, cross-organisation 404s, segregation of duties, single winner under concurrent approve and finalise, immutability after approval and finalisation, audit redaction and append-only behaviour. The Playwright run adds UI checks that a preparer sees no approval controls and an employee cannot reach payroll data.

## Dependency scanning

`npm audit` reported 0 vulnerabilities for production dependencies at the time of writing. The CI workflow runs it on every push. Add Dependabot or Renovate for ongoing updates.

## Known gaps

No MFA, no email delivery, no application-level field encryption, no idle-timeout beyond the fixed session TTL, no IP allow-listing, and rate limits are per process (use a shared store when running several replicas). The password-reset flow was not exercised against a real mail provider.
