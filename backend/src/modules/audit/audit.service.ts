import type { Request } from 'express';
import type { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { AuditLog } from './audit.model.js';

const SENSITIVE = /password|token|secret|bank|accountnumber|ifsc|pannumber/i;

/** Strip sensitive keys and trim long strings so audit summaries stay safe. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

export interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: unknown;
}

export async function audit(req: Request, input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      organizationId: req.auth?.organizationId,
      actorId: req.auth?.userId,
      actorRole: req.auth?.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: sanitize(input.summary),
      requestId: req.id,
      ip: req.ip,
    });
  } catch (e) {
    logger.error({ err: e, action: input.action }, 'audit write failed');
    throw e;
  }
}

export async function auditSystem(organizationId: Types.ObjectId | string, action: string, entityType?: string, entityId?: string, summary?: unknown) {
  await AuditLog.create({ organizationId, action, entityType, entityId, summary: sanitize(summary) });
}
