import { Schema, model } from 'mongoose';

const slab = new Schema({ fromPaise: Number, toPaise: Number, amountPaise: Number }, { _id: false });
const taxSlab = new Schema({ fromPaise: Number, toPaise: Number, rateBps: Number }, { _id: false });

/**
 * Effective-dated, versioned statutory/policy configuration. All numbers are configuration,
 * never code. Seed data is flagged isTestOnly and is NOT verified statutory content.
 */
const policySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true },
    version: { type: Number, required: true },
    effectiveFrom: { type: Date, required: true },
    isTestOnly: { type: Boolean, default: true },
    pf: {
      enabled: { type: Boolean, default: false },
      employeeRateBps: Number,
      employerRateBps: Number,
      wageCeilingPaise: Number,
    },
    esi: {
      enabled: { type: Boolean, default: false },
      employeeRateBps: Number,
      employerRateBps: Number,
      grossThresholdPaise: Number,
    },
    professionalTax: {
      enabled: { type: Boolean, default: false },
      states: [{ state: String, slabs: [slab] }],
    },
    tds: {
      enabled: { type: Boolean, default: false },
      regimes: [
        {
          regime: { type: String, enum: ['old', 'new'] },
          standardDeductionPaise: Number,
          slabs: [taxSlab],
          cessBps: Number,
        },
      ],
    },
    gratuity: { enabled: { type: Boolean, default: false }, accrualNumerator: Number, accrualDenominator: Number },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
policySchema.index({ organizationId: 1, effectiveFrom: -1 });
policySchema.index({ organizationId: 1, version: 1 }, { unique: true });

export const PayrollPolicyVersion = model('PayrollPolicyVersion', policySchema);
