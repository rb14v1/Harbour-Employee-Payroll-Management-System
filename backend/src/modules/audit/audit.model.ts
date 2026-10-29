import { Schema, model } from 'mongoose';

const auditSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    action: { type: String, required: true },
    entityType: String,
    entityId: String,
    summary: Schema.Types.Mixed,
    requestId: String,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ organizationId: 1, createdAt: -1 });
auditSchema.index({ organizationId: 1, entityType: 1, entityId: 1 });
auditSchema.index({ organizationId: 1, action: 1, createdAt: -1 });

// Append-only: normal application code cannot alter or delete audit history.
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'replaceOne'] as const) {
  auditSchema.pre(op, function () {
    throw new Error('AuditLog is append-only');
  });
}
auditSchema.pre('save', function () {
  if (!this.isNew) throw new Error('AuditLog is append-only');
});

export const AuditLog = model('AuditLog', auditSchema);
