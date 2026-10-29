import { Schema, model } from 'mongoose';

const departmentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    headEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
departmentSchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const Department = model('Department', departmentSchema);

const designationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    level: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
designationSchema.index({ organizationId: 1, title: 1 }, { unique: true });

export const Designation = model('Designation', designationSchema);
