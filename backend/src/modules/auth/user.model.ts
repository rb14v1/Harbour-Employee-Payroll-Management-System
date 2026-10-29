import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLES } from '../../shared/permissions.js';

const userSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    isActive: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    userAgent: String,
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model('Session', sessionSchema);
