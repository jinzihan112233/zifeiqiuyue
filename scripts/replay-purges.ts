import path from 'node:path';
import { getPayload } from 'payload';
import { currentActor } from '../src/modules/access';
import { replayPurges } from '../src/modules/content-management';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || !['/zifeiqiuyue_dev', '/zifeiqiuyue_test', '/zifeiqiuyue_restore'].includes(url.pathname) || !process.argv.includes('--isolated')) throw new Error('Stop the local app first, then explicitly pass --isolated; only dedicated local databases are allowed.');
  const ledger = process.argv.find(arg => arg.startsWith('--ledger='))?.slice(9);
  if (!ledger) throw new Error('Pass the latest independent ledger directory with --ledger=PATH.');
  process.env.PURGE_LEDGER_DIR = path.resolve(ledger); process.env.PURGE_REPLAY = 'true';
  const { default: config } = await import('../src/payload.config'); const payload = await getPayload({ config });
  try { const user = (await payload.find({ collection: 'users', where: { and: [{ role: { equals: 'admin' } }, { status: { equals: 'active' } }] }, limit: 1, overrideAccess: true })).docs[0]; const actor = await currentActor(payload, user); if (!actor) throw new Error('An active administrator is required.'); await replayPurges(payload, actor); console.log('Purge directives replayed. Verify media cleanup and restored data before starting the app.'); } finally { await payload.destroy(); }
}
main().then(() => process.exit(0)).catch(() => { console.error('Purge replay failed; keep the restored service isolated and verify ledger, references and permissions.'); process.exit(1); });
