# Architecture

## Shape

Modular monolith. One Express API, one React single-page app, one MongoDB database. Domain boundaries are folders under `backend/src/modules/`:

| Module | Responsibility |
|---|---|
| auth | Login, sessions, password reset, user management |
| organizations, departments | Organisation profile and settings, departments, designations |
| employees | Employee records, scoping (self, reporting tree, organisation), CSV import/export |
| salary-structures | Reusable templates and per-employee append-only revisions |
| payroll-policies | Effective-dated statutory configuration |
| payroll | Periods, inputs, calculation orchestration, workflow, adjustments |
| payroll/engine | Pure calculation engine (no database, no I/O) |
| payslips | Payslip records, PDF rendering, employee self-service, correction requests |
| reports | Server-side aggregations, CSV/PDF export |
| audit | Append-only audit log |

Controllers stay thin: route files validate input (Zod), check permission, call model or service code, write an audit event. Calculation lives in `payroll/engine/engine.ts` and `payroll.service.ts`.

## Request pipeline

`requestId` -> `pino-http` -> `helmet` -> `cors` (allow-list) -> JSON body (100 kb limit) -> cookies -> rate limit -> router -> `authenticate` (cookie JWT, server-side session lookup, CSRF header check on non-GET, active-user check) -> `requirePermission` -> `validate` (Zod; unknown keys dropped) -> handler -> central `errorHandler`.

Errors use one format: `{ "error": { "code", "message", "details?", "requestId" } }`. Stack traces and database errors are never returned.

## Authorisation model

Roles map to permissions in `backend/src/shared/permissions.ts`. Permission checks are only half of access control; object-level rules sit on top:

- Every query includes `organizationId` from the session, never from the request.
- Employees see only their own record and payslips. Managers see themselves plus the reporting tree (breadth-first on `managerId`) but not other people's pay.
- Out-of-scope ids return 404, not 403, so existence is not disclosed.
- Staff with an employee record (HR, finance, and so on) can read their own payslips only, unless the role holds `payslip:read_any`.
- Approvers must differ from the preparer (`segregationOfDuties`, on by default). The check inspects the approval history for any `calculate`, `recalculate` or `submit` action by the same user.
- A payroll input cannot be approved by the person who entered it.

## Payroll workflow

States and legal transitions are in `payroll/state-machine.ts`:

```
draft -> processing -> calculated -> pending_approval -> approved -> payment_processing -> reconciliation_pending -> reconciled
                          ^               |                  
                          +-- rejected <--+        cancelled (from draft, calculated, rejected)
```

- `calculate` moves draft/calculated/rejected to `processing`, runs the engine, upserts entries, then sets `calculated`. A failure restores the previous state.
- `submit`: calculated to pending_approval. Blocks if inputs changed after the last calculation or if blocking exceptions exist (unless explicitly acknowledged; those employees are then excluded).
- `approve` / `reject` (finance): pending_approval to approved or rejected. Reject requires a comment.
- `finalize` (payroll): approved to payment_processing. Creates one payslip per payable employee.
- `payment-reference` (finance): records payment and moves to reconciliation_pending. `reconcile` completes the cycle.
- Every transition is an atomic `findOneAndUpdate` filtered on the expected current status. Of N concurrent requests exactly one succeeds; the rest get 409. This is covered by integration tests for approval and finalisation.
- After approval nothing about the batch can be edited. Corrections after finalisation use a `PayrollAdjustment` (request, then approval by a different user) that is applied as a line in a later, still-editable period.

### Transactions

`withTransaction` (backend/src/config/db.ts) uses a MongoDB session when connected to a replica set and runs without one on a standalone server. Finalisation runs inside a transaction when available. On a standalone server the guarded transition still prevents concurrent double finalisation, and a compensation step removes partial payslips if a later step fails. Use a replica set for production.

### Calculation engine

`calculatePayroll(input)` is a pure function: same input gives the same output. All amounts are integer paise. `mulDiv` uses BigInt and rounds half away from zero, applied once per derived amount. Proration works at half-day granularity. Missing or inconsistent data produces exceptions (`error` blocks the employee from the batch, `warning` is informational) rather than guesses. Each stored entry records the policy version and the inputs used.

## Background jobs

None. Payroll runs synchronously inside the request. Calculation for the seeded scale takes milliseconds; the design assumes organisations in the low thousands of employees. If batches grow beyond what a single request can finish, introduce a job queue with idempotent job keys, using the `processing` state as the lock. Not built because it is not needed yet.

## Not implemented

- Multi-factor authentication (an identity provider such as OIDC is the intended route).
- Outbound email. Password reset tokens are generated and hashed, but delivery is only logged outside production.
- Field-level encryption of bank account and PAN values. They are excluded from default queries, masked in responses and omitted from logs and audit entries, but are stored as plain strings. Rely on MongoDB encryption at rest or add application-level encryption before production.
- Form 16 and other tax certificates. The employee portal states this.
- Full TDS (old-regime exemptions, previous employer income, quarterly reconciliation). See [payroll-rules.md](payroll-rules.md).
- Automated retention and archival jobs. The policy is documented in [database-design.md](database-design.md).
- Code-splitting in the frontend (main bundle is about 910 kB before gzip).
- Salary changes inside a month are not split; the revision effective at the period end date is used for the whole period.
