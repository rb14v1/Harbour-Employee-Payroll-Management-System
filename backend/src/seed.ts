import mongoose from 'mongoose';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { DEMO_USERS, seedDemo } from './seed-data.js';

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const password = env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error('Set SEED_DEMO_PASSWORD (min 12 chars) in .env before seeding');
  await connectDb();
  if (process.argv.includes('--reset')) await mongoose.connection.dropDatabase();
  else if (await mongoose.connection.collection('organizations').countDocuments()) {
    throw new Error('Database is not empty. Re-run with --reset to drop it first (dev databases only).');
  }
  await mongoose.syncIndexes();
  const { org } = await seedDemo(password);
  console.log(`Seeded "${org.name}". Demo users (password from SEED_DEMO_PASSWORD):\n${DEMO_USERS.map((u) => `  ${u.role.padEnd(18)} ${u.email}`).join('\n')}`);
  await disconnectDb();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
