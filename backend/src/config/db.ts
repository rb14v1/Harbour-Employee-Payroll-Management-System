import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export async function connectDb(uri: string = env.MONGODB_URI): Promise<void> {
  // sanitizeFilter is deliberately NOT enabled: it rewrites the application's own $in/$gte operators.
  // Operator injection is prevented by Zod-parsed inputs; no raw request data is used as a query filter.
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 10000 });
  logger.info('MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

let txSupported: boolean | undefined;

/** Transactions need a replica set. Detect once; fall back to guarded atomic updates otherwise. */
export async function supportsTransactions(): Promise<boolean> {
  if (txSupported !== undefined) return txSupported;
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  txSupported = Boolean(hello.setName);
  return txSupported;
}

export async function withTransaction<T>(fn: (session: mongoose.ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}
