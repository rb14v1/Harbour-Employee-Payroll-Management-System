import { Schema, model } from 'mongoose';

export const COMPONENT_TYPES = ['earning', 'employer_contribution', 'employee_deduction', 'variable'] as const;

const componentSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: COMPONENT_TYPES, required: true },
    annualAmount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }, // paise
    prorated: { type: Boolean, default: true },
    isBasic: { type: Boolean, default: false },
  },
  { _id: false },
);

const structureSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    components: { type: [componentSchema], validate: (v: unknown[]) => v.length > 0 },
    annualCtc: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }, // paise
    effectiveFrom: { type: Date, required: true },
    effectiveTo: Date,
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);
structureSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const SalaryStructure = model('SalaryStructure', structureSchema);

const revisionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    structureId: { type: Schema.Types.ObjectId, ref: 'SalaryStructure' },
    // Snapshot so later edits to the structure never alter historical payroll.
    components: [componentSchema],
    annualCtc: { type: Number, required: true },
    isOverride: { type: Boolean, default: false },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: Date,
    reason: { type: String, required: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
revisionSchema.index({ organizationId: 1, employeeId: 1, effectiveFrom: -1 });

export const SalaryRevision = model('SalaryRevision', revisionSchema);
