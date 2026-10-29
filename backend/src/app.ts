import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/common.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/auth/users.routes.js';
import { departmentsRouter, designationsRouter, organizationRouter } from './modules/departments/departments.routes.js';
import { employeesRouter } from './modules/employees/employees.routes.js';
import { payrollRouter } from './modules/payroll/payroll.routes.js';
import { policiesRouter } from './modules/payroll-policies/policies.routes.js';
import { payslipsRouter } from './modules/payslips/payslips.routes.js';
import { correctionReviewRouter, selfRouter } from './modules/payslips/self.routes.js';
import { openApiDocument } from './openapi.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { salaryRouter } from './modules/salary-structures/salary.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as { id?: string }).id ?? '', serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url?.split('?')[0] }) } }));
  app.use(helmet() as unknown as express.RequestHandler);
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token'] }));
  app.use(express.json({ limit: '100kb' }) as unknown as express.RequestHandler);
  app.use(cookieParser());

  app.get('/health', (_req, res) => void res.json({ status: 'ok' }));
  app.get('/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 100_000 : 600, standardHeaders: true, legacyHeaders: false }));
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/organization', organizationRouter);
  api.use('/departments', departmentsRouter);
  api.use('/designations', designationsRouter);
  api.use('/employees', employeesRouter);
  api.use('/payroll-policies', policiesRouter);
  api.use('/payroll', payrollRouter);
  api.use('/payslips', payslipsRouter);
  api.use('/me', selfRouter);
  api.use('/correction-requests', correctionReviewRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/', salaryRouter); // /salary-structures and /employees/:id/salary-revisions
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
