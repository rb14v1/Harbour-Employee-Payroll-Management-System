import { Router } from 'express';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/common.js';
import { validate } from '../../middleware/common.js';
import { audit } from '../audit/audit.service.js';
import { PayrollPolicyVersion } from './policy.model.js';

export const policiesRouter = Router();
policiesRouter.use(authenticate);

const paise = z.number().int().min(0);
const slab = z.object({ fromPaise: paise, toPaise: paise.nullable().optional(), amountPaise: paise.optional(), rateBps: z.number().int().min(0).max(10000).optional() });
const bps = z.number().int().min(0).max(10000);

const policyBody = z.object({
  name: z.string().min(1).max(100),
  effectiveFrom: z.coerce.date(),
  isTestOnly: z.boolean(),
  pf: z.object({ enabled: z.boolean(), employeeRateBps: bps.optional(), employerRateBps: bps.optional(), wageCeilingPaise: paise.optional() }).optional(),
  esi: z.object({ enabled: z.boolean(), employeeRateBps: bps.optional(), employerRateBps: bps.optional(), grossThresholdPaise: paise.optional() }).optional(),
  professionalTax: z.object({ enabled: z.boolean(), states: z.array(z.object({ state: z.string().min(1).max(50), slabs: z.array(slab).max(20) })).max(40) }).optional(),
  tds: z.object({ enabled: z.boolean(), regimes: z.array(z.object({ regime: z.enum(['old', 'new']), standardDeductionPaise: paise, cessBps: bps, slabs: z.array(slab).max(20) })).max(2) }).optional(),
  gratuity: z.object({ enabled: z.boolean(), accrualNumerator: z.number().int().min(0), accrualDenominator: z.number().int().min(1) }).optional(),
});

policiesRouter.get('/', requirePermission('policy:manage', 'payroll:read'), asyncHandler(async (req, res) => {
  res.json({ data: await PayrollPolicyVersion.find({ organizationId: orgId(req) }).sort({ effectiveFrom: -1 }).lean() });
}));

// Policies are immutable once created; a change is a new version with a new effective date.
policiesRouter.post('/', requirePermission('policy:manage'), validate({ body: policyBody }), asyncHandler(async (req, res) => {
  const last = await PayrollPolicyVersion.findOne({ organizationId: orgId(req) }).sort({ version: -1 }).lean();
  const doc = await PayrollPolicyVersion.create({ ...(req.body as object), organizationId: orgId(req), version: (last?.version ?? 0) + 1, createdBy: req.auth!.userId });
  await audit(req, { action: 'payroll_policy.create', entityType: 'PayrollPolicyVersion', entityId: doc.id, summary: { version: doc.version, effectiveFrom: doc.effectiveFrom, isTestOnly: doc.isTestOnly } });
  res.status(201).json({ data: doc });
}));
