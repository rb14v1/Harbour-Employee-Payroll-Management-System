import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { z, ZodError, type ZodType } from 'zod';
import { logger } from '../config/logger.js';
import { AppError, badRequest } from '../shared/errors.js';

export const requestId: RequestHandler = (req, res, next) => {
  const id = randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
};

export const objectId = z.string().refine((v) => Types.ObjectId.isValid(v) && /^[a-f\d]{24}$/i.test(v), 'Invalid id');

type Source = 'body' | 'query' | 'params';

/** Validates and replaces the request source with the parsed (stripped) value. Unknown keys are dropped. */
export const validate =
  (schemas: Partial<Record<Source, ZodType>>): RequestHandler =>
  (req, _res, next) => {
    try {
      for (const source of ['params', 'query', 'body'] as const) {
        const schema = schemas[source];
        if (!schema) continue;
        const parsed = schema.parse(req[source]);
        if (source === 'query') Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
        else (req as unknown as Record<string, unknown>)[source] = parsed;
      }
      next();
    } catch (e) {
      next(e);
    }
  };

export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with the same unique value already exists';
  } else if (err?.name === 'CastError') {
    logger.warn({ path: err.path, kind: err.kind, requestId: req.id, url: req.originalUrl.split('?')[0] }, 'cast error');
    const e = badRequest('Invalid identifier');
    ({ status, code, message } = e);
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed JSON';
  } else if (err?.name === 'VersionError') {
    status = 409;
    code = 'CONCURRENT_MODIFICATION';
    message = 'Record was modified by another request; reload and retry';
  }

  if (status >= 500) logger.error({ err, requestId: req.id }, 'unhandled error');
  res.status(status).json({ error: { code, message, details, requestId: req.id } });
};
