import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Session, User } from '../modules/auth/user.model.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import { hasPermission, type Permission, type Role } from '../shared/permissions.js';

export const COOKIE_NAME = 'pms_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthContext {
  userId: string;
  sessionId: string;
  organizationId: string;
  role: Role;
  employeeId?: string;
  email: string;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    id?: string;
  }
}

export function signSession(sessionId: string, userId: string): string {
  return jwt.sign({ sid: sessionId, uid: userId }, env.JWT_SECRET, { expiresIn: `${env.SESSION_TTL_HOURS}h`, algorithm: 'HS256' });
}

/** Authenticates via signed cookie, validates the server-side session, enforces CSRF on unsafe methods. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (!token) throw unauthorized();
    let payload: { sid?: string; uid?: string };
    try {
      payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as typeof payload;
    } catch {
      throw unauthorized('Session expired');
    }
    if (!payload.sid || !Types.ObjectId.isValid(payload.sid)) throw unauthorized();

    const session = await Session.findById(payload.sid);
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) throw unauthorized('Session expired');

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.get('x-csrf-token');
      if (!header || header !== session.csrfToken) throw forbidden('Invalid CSRF token');
    }

    const user = await User.findById(session.userId);
    if (!user || !user.isActive) throw unauthorized('Account disabled');

    req.auth = {
      userId: user.id,
      sessionId: session.id,
      organizationId: user.organizationId.toString(),
      role: user.role as Role,
      employeeId: user.employeeId?.toString(),
      email: user.email,
      name: user.name,
    };
    next();
  } catch (e) {
    next(e);
  }
};

export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) return next(unauthorized());
    if (!perms.some((p) => hasPermission(auth.role, p))) return next(forbidden());
    next();
  };

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

export const orgId = (req: Request): Types.ObjectId => new Types.ObjectId(req.auth!.organizationId);
