# Payroll rules and verification status

**This system does not certify statutory compliance.** No statutory rate, threshold, slab or date is hard-coded. They live in `PayrollPolicyVersion` documents, are effective-dated, and must be entered and verified by a qualified payroll professional. The seed policy ("TEST-ONLY illustrative policy") exists so the demo and tests have numbers to work with. Its values are illustrative, are flagged `isTestOnly`, and the UI shows a warning when a test-only policy is used in a simulation.

## What is implemented

| Area | Implementation | Verification needed |
|---|---|---|
| Earnings | Each salary component is `annualAmount / 12`, rounded once, then prorated by payable days / total days | Confirm your organisation's proration convention |
| Proration | Calendar days or a fixed day count (organisation setting). Joining and exit dates and approved unpaid leave reduce payable days. Half-day granularity | Same |
| Additional earnings | Approved overtime, variable pay, incentives, adjustments, added unprorated | Taxability of each item |
| Provident Fund | Employee and employer rate in basis points on prorated basic, capped at a configurable wage ceiling. Only for employees flagged `pfApplicable` | Rates, ceiling, which components count as wages, voluntary higher contributions, EPS split |
| ESI | Rates plus a gross threshold. Applies only when the employee is flagged and gross is at or below the threshold | Rates, threshold, contribution period rules |
| Professional tax | Per-state slab table on monthly gross. Missing state rules produce a blocking exception | State slabs, February adjustments, exemptions |
| TDS | Annualised projection: annual fixed earnings minus standard deduction, taxed by slabs for the employee's chosen regime, plus cess, divided by 12 | **Simplified.** No old-regime deductions or exemptions (80C, HRA, and so on), no previous-employer income, no bonus true-up, no mid-year regime changes, no declarations workflow |
| Gratuity | Optional employer accrual line: basic x numerator / denominator | Eligibility (years of service), ceiling, actual liability |
| Other deductions | Approved `deduction` inputs and approved negative adjustments | |
| Employer cost | Gross + employer contributions (structure-defined plus statutory) | |

Structure-defined `employer_contribution` components and statutory employer PF/ESI are additive. If your salary structure already includes an employer PF component, do not also enable PF in the policy, or it will be counted twice.

## Formulas

```
Gross earnings            = sum(prorated earnings) + approved additional earnings
Total employee deductions = fixed deductions + PF(employee) + ESI(employee) + PT + TDS + other approved deductions
Net pay                   = Gross earnings - Total employee deductions
Employer cost             = Gross earnings + employer contributions
```

CTC is not take-home. For a structure, CTC = earnings + employer contributions + variable pay, and the editor blocks saving when the parts do not sum to the declared CTC. Employee deductions are taken from gross and are outside CTC. `variable` components are CTC targets only and are not paid unless an approved input exists.

## Rounding

All arithmetic is on integer paise. Ratios use BigInt and round half away from zero. Rounding happens once per derived amount (each component, each statutory line), so totals are sums of rounded lines and always reconcile exactly: `net = gross - deductions`.

## Exceptions

The engine never guesses. It records an exception per employee:

| Code | Severity | Cause |
|---|---|---|
| NO_SALARY_STRUCTURE | error | No salary revision effective in the period |
| NOT_EMPLOYED | error | Joined after, or left before, the period |
| INVALID_UNPAID_LEAVE, UNPAID_LEAVE_EXCEEDS_DAYS | error | Not whole or half days, or more than employed days |
| NEGATIVE_NET_PAY | error | Deductions exceed gross |
| PF_CONFIG_MISSING, ESI_CONFIG_MISSING, PT_STATE_MISSING, TDS_REGIME_MISSING | error | Employee is flagged for the item but policy lacks the configuration |
| INVALID_ADDITIONAL_EARNING, INVALID_DEDUCTION | error | Non-integer or negative paise |
| NO_POLICY | warning | No policy version effective; statutory items skipped |
| PENDING_INPUTS | warning | Inputs awaiting approval were excluded |
| ESI_ABOVE_THRESHOLD | warning | Flagged for ESI but above the threshold |

Employees with an error are excluded from batch totals and payslips and are listed in the exception report. Submitting with them present requires explicit acknowledgement.

## Versioning and repeatability

The policy in force is the latest version with `effectiveFrom <= period end date`. Each `PayrollEntry` stores `policyVersionId`, `policyVersion`, `salaryRevisionId`, the approved `inputIds` and a full line-item breakdown. Re-running with unchanged data and policy gives byte-identical results (asserted in tests). Recalculation needs a written reason and is audited.

## Illustrative test values in the seed (not legal advice)

PF 12% and 12% with a INR 15,000 wage ceiling, ESI off, PT for state KA with a INR 200 slab at INR 25,000, new-regime TDS with a INR 50,000 standard deduction, slabs of 0% to INR 3,00,000, 5% to INR 7,00,000, 10% above, and 4% cess. These exist only to exercise the engine.

## Verification checklist before real use

1. Load verified rates, ceilings, slabs and effective dates as a new non-test policy version.
2. Parallel-run at least one cycle against your current process and reconcile every employee.
3. Have a payroll professional sign off the TDS approach for your employee population, or replace the TDS module.
4. Confirm filing outputs (challans, returns, Form 16) from another system; this application does not produce them.
