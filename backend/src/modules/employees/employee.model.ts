import { Schema, model, type InferSchemaType } from 'mongoose';

export const EMPLOYMENT_STATUS = ['active', 'on_notice', 'inactive'] as const;
export const EMPLOYMENT_TYPE = ['full_time', 'part_time', 'contract', 'intern'] as const;

const employeeSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    employeeCode: { type: String, required: true },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    workEmail: { type: String, required: true, lowercase: true, trim: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    designationId: { type: Schema.Types.ObjectId, ref: 'Designation', required: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    joiningDate: { type: Date, required: true },
    exitDate: Date,
    status: { type: String, enum: EMPLOYMENT_STATUS, default: 'active' },
    employmentType: { type: String, enum: EMPLOYMENT_TYPE, default: 'full_time' },
    workLocation: { type: String, required: true },
    payFrequency: { type: String, enum: ['monthly'], default: 'monthly' },
    statutory: {
      taxRegime: { type: String, enum: ['old', 'new'], default: 'new' },
      pfApplicable: { type: Boolean, default: false },
      esiApplicable: { type: Boolean, default: false },
      ptApplicable: { type: Boolean, default: false },
      ptState: String,
    },
    // Sensitive: excluded from default queries and list responses.
    bank: {
      accountHolder: { type: String, select: false },
      accountNumber: { type: String, select: false },
      ifsc: { type: String, select: false },
    },
    panNumber: { type: String, select: false, uppercase: true },
  },
  { timestamps: true },
);
employeeSchema.index({ organizationId: 1, employeeCode: 1 }, { unique: true });
employeeSchema.index({ organizationId: 1, workEmail: 1 }, { unique: true });
employeeSchema.index({ organizationId: 1, departmentId: 1, status: 1 });
employeeSchema.index({ organizationId: 1, managerId: 1 });
employeeSchema.index({ organizationId: 1, firstName: 1, lastName: 1 });

export type EmployeeDoc = InferSchemaType<typeof employeeSchema>;
export const Employee = model('Employee', employeeSchema);

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

export async function nextEmployeeCode(organizationId: string): Promise<string> {
  const c = await Counter.findOneAndUpdate(
    { _id: `employee:${organizationId}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return `EMP${String(c.seq).padStart(5, '0')}`;
}
