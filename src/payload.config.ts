import path from 'node:path';
import { buildConfig } from 'payload';
import { postgresAdapter } from '@payloadcms/db-postgres';
import sharp from 'sharp';
import { collections } from './collections';
import { assertPurgeLedger } from './modules/content-management';

const secret = process.env.PAYLOAD_SECRET;
if (!secret || secret.length < 32) throw new Error('PAYLOAD_SECRET must contain at least 32 random characters.');

export default buildConfig({
  secret,
  serverURL: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
  csrf: [process.env.APP_ORIGIN || 'http://127.0.0.1:3000'],
  cors: [process.env.APP_ORIGIN || 'http://127.0.0.1:3000'],
  admin: { user: 'users', importMap: { baseDir: path.resolve('src'), importMapFile: path.resolve('src/app/(payload)/admin/importMap.ts') } },
  db: postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL, max: 15 }, schemaName: 'community', push: false, migrationDir: path.resolve('src/migrations') }),
  collections,
  onInit: assertPurgeLedger,
  sharp,
  graphQL: { disable: true },
  typescript: { outputFile: path.resolve('.local/payload-types.ts') },
  telemetry: false,
  email: () => ({ name: 'disabled', defaultFromAddress: 'no-reply@localhost', defaultFromName: '子非秋月', sendEmail: async () => { throw new Error('Email is disabled; use a recovery code to recover your account.'); } }),
});
