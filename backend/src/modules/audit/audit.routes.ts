import { Router } from 'express';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { escapeRegex, pageMeta, paginationSchema } from '../../shared/pagination.js';
import { AuditLog } from './audit.model.js';

export const auditRouter = Router();
// Read-only: no write endpoints exist for audit history.
auditRouter.use(authenticate, requirePermission('audit:view'));

auditRouter.get(
  '/',
  validate({ query: paginationSchema.extend({ action: z.string().max(60).optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(40).optional(), actorId: objectId.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { page: number; limit: number; action?: string; entityType?: string; entityId?: string; actorId?: string; from?: Date; to?: Date };
    const filter: Record<string, unknown> = { organizationId: orgId(req) };
    if (q.action) filter.action = { $regex: `^${escapeRegex(q.action)}` };
    if (q.entityType) filter.entityType = q.entityType;
    if (q.entityId) filter.entityId = q.entityId;
    if (q.actorId) filter.actorId = q.actorId;
    if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('actorId', 'name email').lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
  }),
);
