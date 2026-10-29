import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { authenticate, COOKIE_NAME, signSession } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/common.js';
import { badRequest, unauthorized } from '../../shared/errors.js';
import { audit, auditSystem } from '../audit/audit.service.js';
import { Session, User } from './user.model.js';

export const authRouter = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a digit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: env.SESSION_TTL_HOURS * 3600 * 1000,
});

// Verified against when the user does not exist, so timing does not reveal account existence.
const dummyHash = argon2.hash('dummy-password-for-timing');

authRouter.post(
  '/login',
  limiter,
  validate({ body: z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }) }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    const fail = async (reason: string) => {
      if (user) await auditSystem(user.organizationId, 'auth.login_failed', 'User', user.id, { reason });
      throw unauthorized('Invalid email or password');
    };

    if (!user) {
      await argon2.verify(await dummyHash, password);
      return fail('unknown');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return fail('locked');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok || !user.isActive) {
      if (!ok) {
        user.failedLogins += 1;
        if (user.failedLogins >= MAX_FAILED) {
          user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
          user.failedLogins = 0;
        }
        await user.save();
      }
      return fail(ok ? 'inactive' : 'bad_password');
    }

    user.failedLogins = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    const csrfToken = randomBytes(24).toString('hex');
    const session = await Session.create({
      userId: user._id,
      csrfToken,
      expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000),
      userAgent: req.get('user-agent')?.slice(0, 200),
    });
    res.cookie(COOKIE_NAME, signSession(session.id, user.id), cookieOptions());
    req.auth = { userId: user.id, sessionId: session.id, organizationId: user.organizationId.toString(), role: user.role, email: user.email, name: user.name };
    await audit(req, { action: 'auth.login', entityType: 'User', entityId: user.id });
    res.json({ data: { csrfToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, employeeId: user.employeeId } } });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await Session.updateOne({ _id: req.auth!.sessionId }, { revokedAt: new Date() });
    await audit(req, { action: 'auth.logout', entityType: 'User', entityId: req.auth!.userId });
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const session = await Session.findById(req.auth!.sessionId);
    const a = req.auth!;
    res.json({ data: { id: a.userId, name: a.name, email: a.email, role: a.role, employeeId: a.employeeId, organizationId: a.organizationId, csrfToken: session?.csrfToken } });
  }),
);

authRouter.post(
  '/forgot-password',
  limiter,
  validate({ body: z.object({ email: z.string().email().max(254) }) }),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: (req.body as { email: string }).email.toLowerCase(), isActive: true });
    let devToken: string | undefined;
    if (user) {
      const token = randomBytes(32).toString('hex');
      await User.updateOne({ _id: user._id }, { resetTokenHash: sha256(token), resetTokenExpires: new Date(Date.now() + 30 * 60_000) });
      await auditSystem(user.organizationId, 'auth.password_reset_requested', 'User', user.id);
      // No SMTP provider is wired in. Replace this with an email send in staging/production.
      if (env.NODE_ENV !== 'production') logger.warn({ email: user.email, resetPath: `/reset-password?token=${token}` }, 'DEV ONLY: password reset link');
      if (env.NODE_ENV === 'test') devToken = token;
    }
    // Same response whether or not the account exists.
    res.json({ data: { message: 'If the account exists, a reset link has been sent.' }, ...(devToken ? { devToken } : {}) });
  }),
);

authRouter.post(
  '/reset-password',
  limiter,
  validate({ body: z.object({ token: z.string().length(64), newPassword: passwordSchema }) }),
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    const user = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
    if (!user) throw badRequest('Reset link is invalid or has expired');
    user.passwordHash = await argon2.hash(newPassword);
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
    await auditSystem(user.organizationId, 'auth.password_reset', 'User', user.id);
    res.json({ data: { message: 'Password updated. Please sign in.' } });
  }),
);
