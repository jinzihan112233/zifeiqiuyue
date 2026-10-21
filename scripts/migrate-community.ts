import { getPayload } from 'payload';

async function main() {
  const url = new URL(process.env.DATABASE_MIGRATION_URL!);
  const isTest = process.argv.includes('--test');
  if (isTest) url.pathname = '/zifeiqiuyue_test';
  if (process.argv.includes('--restore')) url.pathname = '/zifeiqiuyue_restore';
  if (url.hostname !== '127.0.0.1' || !['/zifeiqiuyue_dev', '/zifeiqiuyue_test', ...(process.argv.includes('--restore') ? ['/zifeiqiuyue_restore'] : [])].includes(url.pathname)) throw new Error('Migration target must be a dedicated local dev/test database or explicitly selected restore database.');
  if (isTest) process.env.MEDIA_ROOT = 'storage/test-media';
  process.env.DATABASE_URL = url.toString();
  process.env.PAYLOAD_MIGRATING = 'true';
  const { default: config } = await import('../src/payload.config');
  const create = process.argv.includes('--create');
  const payload = await getPayload({ config, disableDBConnect: create });
  try {
    if (create) await payload.db.createMigration({ payload, migrationName: process.argv.find(arg => arg.startsWith('--name='))?.slice(7) || 'content_foundation', forceAcceptWarning: true, skipEmpty: true });
    else await payload.db.migrate();
  } finally { await payload.destroy(); }
}
// shortcut: Payload 3.91 retains its initial connection; remove explicit CLI exit when the adapter releases it.
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
