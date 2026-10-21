import fs from 'node:fs';
import path from 'node:path';
import { getPayload } from 'payload';
import { currentActor } from '../src/modules/access';
import { exportBundle, importBundle, previewImport, readBundle, readLegacy, sealBundle, writeBundle } from '../src/modules/content-transfer';

async function main() {
  const args = process.argv.slice(2), command = args[0];
  const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!['preview', 'import', 'export', 'seal'].includes(command)) throw new Error('Usage: content-transfer preview|import|export|seal [--legacy] --directory=PATH [--report=PATH] [--test] [--include-drafts] [--restore-publication]');
  if (command === 'seal') { if (!option('directory')) throw new Error('seal requires --directory=PATH'); sealBundle(path.resolve(option('directory')!)); console.log('Content manifest verified and refreshed.'); return; }
  const url = new URL(args.includes('--test') ? process.env.DATABASE_TEST_URL! : process.env.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || !['/zifeiqiuyue_dev', '/zifeiqiuyue_test'].includes(url.pathname)) throw new Error('CLI only permits local dev/test databases.');
  process.env.DATABASE_URL = url.toString();
  if (args.includes('--test')) process.env.MEDIA_ROOT = 'storage/test-media';
  const { default: config } = await import('../src/payload.config'); const payload = await getPayload({ config });
  try {
    const user = (await payload.find({ collection: 'users', where: { username: { equals: option('user') || 'admin' } }, overrideAccess: true, depth: 0 })).docs[0];
    const actor = await currentActor(payload, user); if (!actor) throw new Error('Run app:seed before local content commands.');
    const directory = path.resolve(option('directory') || (args.includes('--legacy') ? '.' : '.local/content-export'));
    if (command === 'export') {
      const bundle = await exportBundle(payload, actor, { includeDrafts: args.includes('--include-drafts') }); writeBundle(bundle, directory);
      console.log(JSON.stringify({ directory, articles: bundle.items.length, quotes: bundle.quotes.length, media: bundle.media.length })); return;
    }
    const bundle = args.includes('--legacy') ? await readLegacy(directory) : readBundle(directory);
    if (command === 'preview') {
      const report = await previewImport(payload, actor, bundle);
      const reportFile = path.resolve(option('report') || '.local/p2-import-preview.json'); fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ report: path.relative(process.cwd(), reportFile), counts: report.counts, warnings: report.rows.filter(r => r.warnings.length).map(r => ({ key: r.key, warnings: r.warnings })) }, null, 2));
    } else {
      const reportFile = path.resolve(option('report') || '.local/p2-import-preview.json');
      if (!fs.existsSync(reportFile)) throw new Error('Run preview first and provide its --report path.');
      const expected = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const result = await importBundle(payload, actor, bundle, { expectedDigest: expected.digest, restorePublication: args.includes('--restore-publication') });
      console.log(JSON.stringify({ imported: result.imported, rows: result.rows.map(r => ({ type: r.type, key: r.key, status: r.status })) }, null, 2));
    }
  } catch (error) {
    if (command === 'preview') {
      const reportFile = path.resolve(option('report') || '.local/p2-import-preview.json'); fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, JSON.stringify({ errors: [error instanceof Error ? error.message : '内容包无效。'], rows: [] }, null, 2));
    }
    throw error;
  } finally { await payload.destroy(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message.replace(/postgresql:\/\/\S+/g, '[redacted]')); process.exit(1); });
