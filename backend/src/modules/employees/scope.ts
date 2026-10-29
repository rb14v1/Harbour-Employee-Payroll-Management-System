import type { Request } from 'express';
import { Types } from 'mongoose';
import { forbidden, notFound } from '../../shared/errors.js';
import { Employee } from './employee.model.js';

/** Employee ids visible to the requester: self for employees, self + reporting tree for managers, all for others. */
export async function visibleEmployeeIds(req: Request): Promise<Types.ObjectId[] | null> {
  const auth = req.auth!;
  const own = auth.employeeId ? [new Types.ObjectId(auth.employeeId)] : [];
  if (auth.role === 'employee') return own;
  if (auth.role !== 'manager') return null; // unrestricted within the organisation

  const seen = new Set<string>(own.map(String));
  let frontier = own;
  while (frontier.length) {
    const reports = await Employee.find({ organizationId: auth.organizationId, managerId: { $in: frontier } }, { _id: 1 }).lean();
    frontier = reports.map((r) => r._id).filter((id) => !seen.has(String(id)));
    frontier.forEach((id) => seen.add(String(id)));
  }
  return [...seen].map((s) => new Types.ObjectId(s));
}

export async function scopeFilter(req: Request): Promise<Record<string, unknown>> {
  const ids = await visibleEmployeeIds(req);
  return { organizationId: new Types.ObjectId(req.auth!.organizationId), ...(ids ? { _id: { $in: ids } } : {}) };
}

/** Throws 404 (not 403) for out-of-scope records so existence is not leaked. */
export async function assertEmployeeAccess(req: Request, employeeId: string): Promise<void> {
  const ids = await visibleEmployeeIds(req);
  if (ids && !ids.some((i) => i.equals(employeeId))) throw notFound('Employee not found');
  if (!(await Employee.exists({ _id: employeeId, organizationId: req.auth!.organizationId }))) throw notFound('Employee not found');
}

export function requireOwnOrPermission(req: Request, employeeId: string, allowed: boolean): void {
  if (allowed) return;
  if (req.auth?.employeeId !== employeeId) throw forbidden();
}
