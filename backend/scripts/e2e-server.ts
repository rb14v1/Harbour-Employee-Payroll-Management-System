/**
 * Starts an isolated in-memory MongoDB replica set, seeds synthetic demo data and serves the API.
 * Used by the Playwright suite; never connects to a real database.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'e2e-only-secret-e2e-only-secret-0123456789';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOG_LEVEL = 'warn';
process.env.PORT = process.env.E2E_API_PORT ?? '4000';

const { connectDb } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { seedDemo } = await import('../src/seed-data.js');
const mongoose = (await import('mongoose')).default;

await connectDb(repl.getUri('payroll_e2e'));
await mongoose.syncIndexes();
await seedDemo('Demo-Password-123');
createApp().listen(Number(process.env.PORT), () => console.log(`E2E API ready on :${process.env.PORT}`));

const stop = async () => {
  await mongoose.disconnect();
  await repl.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
