import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { getPayload } from 'payload';
import { seed } from './seed-community';
import { currentActor } from '../src/modules/access';
import { exportBundle, importBundle, previewImport, readBundle, writeBundle } from '../src/modules/content-transfer';

async function main() {
  if (!process.argv.includes('--worker')) {
    const source = fs.readFileSync('.local/p2-roundtrip-source.txt', 'utf8').trim();
    assert.ok(fs.existsSync(path.join(source, 'manifest.json')), 'Run test:content-community first.');
    const target = new URL(process.env.DATABASE_MIGRATION_URL!); target.pathname = '/zifeiqiuyue_restore';
    assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/zifeiqiuyue_restore');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.resolve('backups', `p2-before-roundtrip-${stamp}.dump`); fs.mkdirSync(path.dirname(backup), { recursive: true });
    execFileSync(path.resolve('.local/postgres/pgsql/bin/pg_dump.exe'), ['--format=custom', '--schema=community', '--no-owner', '--no-acl', '--file', backup, '--dbname', target.pathname.slice(1)], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port, PGUSER: target.username, PGPASSWORD: decodeURIComponent(target.password) } });
    const client = new Client({ connectionString: target.toString() }); await client.connect();
    try {
      // Only the explicitly named disposable restore database is reset, after its backup above.
      assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'zifeiqiuyue_restore');
      await client.query('DROP SCHEMA IF EXISTS community CASCADE'); await client.query('CREATE SCHEMA community AUTHORIZATION zfq_migrate'); await client.query('GRANT USAGE ON SCHEMA community TO zfq_app');
    } finally { await client.end(); }
    execFileSync(process.execPath, ['--env-file=.env.local', '--import', 'tsx', 'scripts/migrate-community.ts', '--restore'], { windowsHide: true, stdio: 'pipe' });
    const grant = new Client({ connectionString: target.toString() }); await grant.connect();
    try { await grant.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA community TO zfq_app'); await grant.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA community TO zfq_app'); } finally { await grant.end(); }
    const media = path.resolve('storage', `p2-roundtrip-${stamp}`), output = path.resolve('.local', `p2-roundtrip-${stamp}`); fs.mkdirSync(media, { recursive: true });
    const runtime = new URL(process.env.DATABASE_TEST_URL!); runtime.pathname = '/zifeiqiuyue_restore';
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/content-roundtrip.ts', '--worker', source, output], { windowsHide: true, stdio: 'inherit', env: { ...process.env, DATABASE_URL: runtime.toString(), MEDIA_ROOT: media } });
    return;
  }
  const source = process.argv[3], output = process.argv[4];
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/zifeiqiuyue_restore');
  const { default: config } = await import('../src/payload.config'); const payload = await getPayload({ config });
  try {
    await seed(payload, '.local/p2-roundtrip-accounts.json');
    const actor = await currentActor(payload, (await payload.find({ collection: 'users', where: { username: { equals: 'admin' } }, overrideAccess: true, depth: 0 })).docs[0]); assert.ok(actor);
    const bundle = readBundle(source), preview = await previewImport(payload, actor, bundle);
    assert.equal(preview.counts.conflict, 0); const applied = await importBundle(payload, actor, bundle, { expectedDigest: preview.digest, restorePublication: true });
    const repeat = await previewImport(payload, actor, bundle); assert.equal(repeat.counts.unchanged, repeat.rows.length); assert.equal((await importBundle(payload, actor, bundle, { expectedDigest: repeat.digest, restorePublication: true })).imported, 0);
    const exported = await exportBundle(payload, actor, { includeDrafts: true }); writeBundle(exported, output); const restored = readBundle(output);
    const canonical = (b: typeof bundle) => ({
      items: b.items.map(i => ({ stableId: i.stableId, slug: i.slug, kind: i.kind, visibility: i.visibility, currentSnapshot: i.currentSnapshot, work: { title: i.work.title, markdown: i.work.markdown, metadata: i.work.metadata }, snapshots: i.snapshots.map(s => ({ stableId: s.stableId, title: s.title, markdown: s.markdown, metadata: s.metadata, plainText: s.plainText, rendererVersion: s.rendererVersion, publishedAt: s.publishedAt })).sort((a, c) => a.stableId.localeCompare(c.stableId)) })).sort((a, c) => a.stableId.localeCompare(c.stableId)),
      quotes: b.quotes.map(q => ({ stableId: q.stableId, text: q.text, attribution: q.attribution, sourceUrl: q.sourceUrl, demo: q.demo, order: q.order, enabled: q.enabled, content: q.content, snapshot: q.snapshot })).sort((a, c) => a.stableId.localeCompare(c.stableId)),
      media: b.media.map(m => ({ stableId: m.stableId, hash: m.hash, alt: m.alt })).sort((a, c) => a.stableId.localeCompare(c.stableId)), home: b.home,
    });
    assert.deepEqual(canonical(restored), canonical(bundle));
    const report = { status: 'passed', database: 'zifeiqiuyue_restore', imported: applied.imported, articlesAndPosts: bundle.items.length, snapshots: bundle.items.reduce((n, i) => n + i.snapshots.length, 0), quotes: bundle.quotes.length, media: bundle.media.length, repeatedImport: 'passed', contentAndMetadata: 'passed', historicalVersions: 'passed', mediaHashes: 'passed', source: path.relative(process.cwd(), source), output: path.relative(process.cwd(), output) };
    fs.writeFileSync('.local/p2-roundtrip-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await payload.destroy(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message.replace(/postgresql:\/\/\S+/g, '[redacted]')); process.exit(1); });
