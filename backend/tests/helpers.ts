import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';
import { seedDemo } from '../src/seed-data.js';

export const PASSWORD = 'Demo-Password-123';
let repl: MongoMemoryReplSet | undefined;

/** Starts an isolated in-memory replica set (so transactions are exercised) unless TEST_MONGODB_URI is set. */
export async function startDb(): Promise<void> {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = repl.getUri('payroll_test');
  } else if (!/test/i.test(uri)) {
    throw new Error('TEST_MONGODB_URI must contain "test" to protect real databases');
  }
  await connectDb(uri); // same connection setup as production
  await mongoose.connection.dropDatabase();
  await mongoose.syncIndexes();
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect();
  await repl?.stop();
}

export async function resetAndSeed() {
  await mongoose.connection.dropDatabase();
  await mongoose.syncIndexes();
  return seedDemo(PASSWORD);
}

export interface Client {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

export async function loginAs(app: Express, email: string, password = PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.data.csrfToken as string;
  return {
    get: (u) => agent.get(`/api/v1${u}`),
    post: (u, b) => agent.post(`/api/v1${u}`).set('X-CSRF-Token', csrf).send(b ?? {}),
    patch: (u, b) => agent.patch(`/api/v1${u}`).set('X-CSRF-Token', csrf).send(b ?? {}),
  };
}

export const app = () => createApp();
