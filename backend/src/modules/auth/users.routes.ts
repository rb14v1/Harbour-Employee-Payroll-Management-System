import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { conflict, notFound } from '../../shared/errors.js';
import { pageMeta, paginationSchema } from '../../shared/pagination.js';
import { ROLES } from '../../shared/permissions.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { passwordSchema } from './auth.routes.js';
import { Session, User } from './user.model.js';

export const usersRouter = Router();
usersRouter.use(authenticate, requirePermission('user:manage'));

const present = (u: InstanceType<typeof User>) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  employeeId: u.employeeId,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt,
});

usersRouter.get(
  '/',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const filter = { organizationId: orgId(req) };
    const [rows, total] = await Promise.all([
      User.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ data: rows.map(present), meta: pageMeta(page, limit, total) });
  }),
);

usersRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().min(1).max(200),
      email: z.string().email().max(254),
      role: z.enum(ROLES),
      password: passwordSchema,
      employeeId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body as { name: string; email: string; role: (typeof ROLES)[number]; password: string; employeeId?: string };
    if (b.employeeId && !(await Employee.exists({ _id: b.employeeId, organizationId: orgId(req) }))) throw notFound('Employee not found');
    if (b.role === 'employee' && !b.employeeId) throw conflict('Employee-role users must be linked to an employee record');
    const user = await User.create({
      organizationId: orgId(req),
      name: b.name,
      email: b.email,
      role: b.role,
      employeeId: b.employeeId,
      passwordHash: await argon2.hash(b.password),
    });
    await audit(req, { action: 'user.create', entityType: 'User', entityId: user.id, summary: { email: user.email, role: user.role } });
    res.status(201).json({ data: present(user) });
  }),
);

usersRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: objectId }),
    body: z.object({ name: z.string().min(1).max(200).optional(), role: z.enum(ROLES).optional(), isActive: z.boolean().optional() }),
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, organizationId: orgId(req) });
    if (!user) throw notFound('User not found');
    const b = req.body as { name?: string; role?: (typeof ROLES)[number]; isActive?: boolean };
    if (user.id === req.auth!.userId && (b.isActive === false || (b.role && b.role !== user.role))) {
      throw conflict('You cannot deactivate or change the role of your own account');
    }
    const before = { role: user.role, isActive: user.isActive };
    Object.assign(user, b);
    await user.save();
    if (b.isActive === false || (b.role && b.role !== before.role)) {
      await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
    }
    await audit(req, { action: 'user.update', entityType: 'User', entityId: user.id, summary: { before, after: b } });
    res.json({ data: present(user) });
  }),
);

usersRouter.post(
  '/:id/revoke-sessions',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, organizationId: orgId(req) });
    if (!user) throw notFound('User not found');
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
    await audit(req, { action: 'user.sessions_revoked', entityType: 'User', entityId: user.id });
    res.status(204).end();
  }),
);
