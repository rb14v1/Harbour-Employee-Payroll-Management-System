import { Schema, model, type InferSchemaType } from 'mongoose';

const orgSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    logoText: { type: String, trim: true, maxlength: 100 },
    currency: { type: String, default: 'INR', uppercase: true, minlength: 3, maxlength: 3 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    financialYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    locations: [{ name: { type: String, required: true }, state: { type: String, required: true } }],
    settings: {
      segregationOfDuties: { type: Boolean, default: true },
      standardMonthDays: { type: Number, min: 28, max: 31, default: 30 },
      prorationBasis: { type: String, enum: ['calendar_days', 'fixed_days'], default: 'calendar_days' },
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type OrganizationDoc = InferSchemaType<typeof orgSchema>;
export const Organization = model('Organization', orgSchema);
