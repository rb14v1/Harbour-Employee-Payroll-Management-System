# Database design

MongoDB via Mongoose. Models sit in each module folder (`*.model.ts`). Every business collection carries `organizationId` and every query filters on it.

## Collections

| Collection | Key fields | Indexes |
|---|---|---|
| organizations | name, currency, timezone, financialYearStartMonth, locations[], settings{segregationOfDuties, standardMonthDays, prorationBasis}, isDemo | |
| users | organizationId, email, role, employeeId?, passwordHash (select:false), failedLogins, lockedUntil, resetTokenHash (select:false) | unique `email`; `organizationId` |
| sessions | userId, csrfToken, expiresAt, revokedAt | TTL on `expiresAt`; `userId` |
| departments | name, code | unique `(organizationId, code)` |
| designations | title, level | unique `(organizationId, title)` |
| employees | employeeCode, names, workEmail, departmentId, designationId, managerId, joiningDate, exitDate, status, statutory{}, bank{} and panNumber (select:false) | unique `(organizationId, employeeCode)`, unique `(organizationId, workEmail)`, `(org, departmentId, status)`, `(org, managerId)`, `(org, firstName, lastName)` |
| counters | `_id = employee:<orgId>`, seq | atomic `$inc` generates employee codes |
| salarystructures | name, components[], annualCtc, version | unique `(organizationId, name)` |
| salaryrevisions | employeeId, structureId, components[] (snapshot), annualCtc, isOverride, effectiveFrom/To, reason | `(org, employeeId, effectiveFrom desc)` |
| payrollpolicyversions | version, effectiveFrom, isTestOnly, pf, esi, professionalTax, tds, gratuity | unique `(organizationId, version)`; `(org, effectiveFrom desc)` |
| payrollperiods | year, month, start/end/cutoff, status, totals, calculationRun, preparedBy, approvedBy/At, finalizedAt, paymentStatus, reconciliationStatus | unique `(organizationId, year, month)`; `(org, status)` |
| payrollentries | periodId, employeeId, snapshot{}, earnings[], deductions[], employerContributions[], totals, exceptions[], policyVersion, inputIds | unique `(periodId, employeeId)`; `(org, employeeId, createdAt)`; `(org, periodId, snapshot.departmentId)` |
| payrollinputs | periodId, employeeId, type, value, source, status, enteredBy, approvedBy | `(org, periodId, employeeId)` |
| payrolladjustments | originalPeriodId, targetPeriodId, employeeId, amount, reason, status | |
| approvalrecords | periodId, action, actorId, fromStatus, toStatus, comment, totalsSnapshot | `(periodId, createdAt)`; update and delete hooks throw |
| paymentrecords | periodId, reference, paymentDate, amount | unique `(organizationId, reference)` |
| payslips | periodId, employeeId, entryId | unique `(periodId, employeeId)`; `(org, employeeId, createdAt)` |
| correctionrequests | employeeId, periodId?, subject, description, status | `(org, employeeId, createdAt)` |
| auditlogs | actorId, actorRole, action, entityType, entityId, summary, requestId, ip | `(org, createdAt)`, `(org, entityType, entityId)`, `(org, action, createdAt)`; update, delete and replace hooks throw |

## References versus embedding

- **Snapshots are embedded on purpose.** `salaryrevisions.components` copies the structure at assignment time; `payrollentries.snapshot` copies employee name, department and designation at calculation time. Later edits to templates or employee records do not alter historical payroll.
- Everything else uses ObjectId references (employee to department, entry to period, and so on).
- Salary structure components are an embedded array because they are always read with their parent.

## Money

All amounts are integers in paise (`Number`, validated with `Number.isSafeInteger`). Ratios are applied with BigInt arithmetic. Basis points (1% = 100 bps) are used for rates.

## Uniqueness and duplicate prevention

- One entry per employee per period is enforced by a unique index, so a second payroll run for the same employee and period cannot create a duplicate. Recalculation replaces the entry (`replaceOne` upsert) and is audited.
- One payslip per employee per period (unique index) protects against double finalisation even if application checks fail.
- Employee email is unique within an organisation; user email is unique globally because login is by email alone.

## Transaction boundaries

- Finalisation: period transition, payslip creation, adjustment status update and approval record, in one transaction on a replica set.
- Everything else is a single-document atomic update or a sequence where each step is individually safe (guarded transition first, then dependent writes).
- Period documents use `optimisticConcurrency`.

## Tenant isolation

`organizationId` is taken from the authenticated session. Route handlers include it in every filter and reject request-supplied references that do not belong to the same organisation (departments, managers, structures). Integration tests create a second organisation and assert 404 for reads and writes across the boundary.

## Retention and archival (policy, not automated)

| Data | Suggested retention | Notes |
|---|---|---|
| Payroll entries, payslips, approval records, payment records | 8 years after the financial year end, or the period your jurisdiction requires | Confirm with your auditors |
| Audit logs | 7 years | Append-only; archive to cold storage by `createdAt` range |
| Sessions | Auto-expire via TTL index | |
| Employee records after exit | Retain with payroll history; anonymise non-payroll personal data on request where law allows | |

No archival job exists. Add one that exports by date range and verifies the export before deleting anything.

## Encryption

Bank account and PAN are stored as plain strings, excluded by `select: false`, masked in API responses and kept out of logs and audit summaries. Enable encryption at rest at the storage layer (for example MongoDB Atlas or disk-level encryption) or add field-level encryption before handling real data.
