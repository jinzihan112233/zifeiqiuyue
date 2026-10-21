import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { getPayload } from 'payload';
import { currentActor } from '../src/modules/access';
import { createContent } from '../src/modules/community';
import { replayPurges } from '../src/modules/content-management';
import { annotationTextVersion, textAnchor } from '../src/modules/annotation-text';

async function main() {
  const source = new URL(process.env.DATABASE_TEST_URL!);
  const target = new URL(process.env.DATABASE_MIGRATION_URL!); target.pathname = '/zifeiqiuyue_restore';
  assert.equal(source.hostname, '127.0.0.1'); assert.equal(source.port, '55432'); assert.equal(source.pathname, '/zifeiqiuyue_test');
  assert.equal(target.hostname, source.hostname); assert.equal(target.port, source.port); assert.equal(target.pathname, '/zifeiqiuyue_restore');
  assert.notEqual(target.pathname, source.pathname);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = path.resolve('backups', `p1-${stamp}.dump`), mediaSource = path.resolve('storage/test-media'), mediaTarget = path.resolve('storage', `restore-${stamp}`);
  assert.ok(mediaTarget.startsWith(path.resolve('storage') + path.sep)); assert.ok(!fs.existsSync(mediaTarget));
  fs.mkdirSync(path.dirname(dump), { recursive: true }); fs.cpSync(mediaSource, mediaTarget, { recursive: true });
  const tool = (name: string) => path.resolve('.local/postgres/pgsql/bin', `${name}.exe`);
  const env = (url: URL) => ({ ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: url.username, PGPASSWORD: decodeURIComponent(url.password) });
  execFileSync(tool('pg_dump'), ['--format=custom', '--schema=community', '--no-owner', '--no-acl', '--file', dump, '--dbname', source.pathname.slice(1)], { env: env(source), stdio: 'pipe', windowsHide: true });
  // --clean is restricted to the explicitly named disposable restore database above.
  execFileSync(tool('pg_restore'), ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', target.pathname.slice(1), dump], { env: env(target), stdio: 'pipe', windowsHide: true });
  const migration = new Client({ connectionString: target.toString() }); await migration.connect();
  try { await migration.query('GRANT USAGE ON SCHEMA community TO zfq_app'); await migration.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA community TO zfq_app'); await migration.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA community TO zfq_app'); } finally { await migration.end(); }
  const restoredRuntime = new URL(source); restoredRuntime.pathname = target.pathname;
  const a = new Client({ connectionString: source.toString() }), b = new Client({ connectionString: restoredRuntime.toString() });
  await a.connect(); await b.connect();
  const tables = (await a.query("SELECT tablename FROM pg_tables WHERE schemaname='community' ORDER BY tablename")).rows.map(row => String(row.tablename));
  const counts: Record<string, number> = {};
  try {
    for (const table of tables) {
      assert.match(table, /^[a-z_]+$/);
      const sourceRows = (await a.query(`SELECT * FROM community.${table} ORDER BY id`)).rows;
      const targetRows = (await b.query(`SELECT * FROM community.${table} ORDER BY id`)).rows;
      assert.deepEqual(targetRows, sourceRows, `Restored rows differ: ${table}`); counts[table] = sourceRows.length;
    }
    assert.ok(counts.annotations > 0 && counts.media > 0 && counts.snapshots > 0, 'Run community tests before restore verification.');
    const hash = (filename: string) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    for (const filename of fs.readdirSync(mediaSource)) assert.equal(hash(path.join(mediaSource, filename)), hash(path.join(mediaTarget, filename)));
    assert.ok((await b.query("SELECT count(*) FROM community.contents WHERE visibility='hidden'")).rows[0].count > 0);
  } finally { await a.end(); await b.end(); }
  process.env.PURGE_LEDGER_DIR = path.resolve('.local/purge-ledger', source.pathname.slice(1));
  assert.ok(fs.existsSync(path.join(process.env.PURGE_LEDGER_DIR, 'manifest.json')), 'The current independent purge ledger is required before restoring.');
  process.env.PURGE_REPLAY = 'true';
  process.env.DATABASE_URL = restoredRuntime.toString(); process.env.MEDIA_ROOT = mediaTarget;
  const { default: config } = await import('../src/payload.config'); const payload = await getPayload({ config });
  try {
    const adminDoc = (await payload.find({ collection: 'users', where: { and: [{ role: { equals: 'admin' } }, { status: { equals: 'active' } }] }, limit: 1, overrideAccess: true })).docs[0];
    const admin = await currentActor(payload, adminDoc); assert.ok(admin); await replayPurges(payload, admin); delete process.env.PURGE_REPLAY;
    const accounts = JSON.parse(fs.readFileSync('.local/p1-test-accounts.json', 'utf8'));
    const login = await payload.login({ collection: 'users', data: accounts.membera }); assert.equal(login.user?.username, 'membera');
    const actor = await currentActor(payload, login.user); assert.ok(actor);
    const probe = await createContent(payload, actor, { slug: `restored-${crypto.randomUUID()}`, title: '恢复后的写入检查', markdown: '独立恢复环境中的合成验证内容。' }); assert.ok(probe.draft.id);
    const annotations = await payload.find({ collection: 'annotations', overrideAccess: true, depth: 0, limit: 10000 });
    for (const note of annotations.docs) {
      const comment = await payload.findByID({ collection: 'comments', id: Number(note.comment), overrideAccess: true, depth: 0 });
      assert.equal(Number(comment.content), Number(note.content));
      if (comment.deleted) { assert.equal(note.quote, '[已删除]'); assert.equal(note.body, ''); continue; }
      const snapshot = await payload.findByID({ collection: 'snapshots', id: Number(note.snapshot), overrideAccess: true, depth: 0 });
      assert.equal(Array.from(String(snapshot.plainText)).slice(Number(note.start), Number(note.end)).join(''), note.quote);
      assert.ok(snapshot.rendererVersion, 'Snapshot must retain its positioning rules.');
      if (snapshot.rendererVersion === annotationTextVersion) {
        const anchor = textAnchor(String(snapshot.plainText), Number(note.start), Number(note.end));
        assert.equal(anchor.prefix, note.prefix); assert.equal(anchor.suffix, note.suffix);
      }
    }
    assert.equal((await payload.db.pool.query(`SELECT count(*)::int AS count FROM community.comments m LEFT JOIN community.comments p ON p.id=m.parent_id
      WHERE m.parent_id IS NOT NULL AND (p.id IS NULL OR p.content_id<>m.content_id OR m.root_id IS DISTINCT FROM COALESCE(p.root_id,p.id))`)).rows[0].count, 0);
    const discussionProbe = await payload.find({ collection: 'comments', overrideAccess: true, depth: 0, limit: 1 });
    assert.ok(discussionProbe.docs.length, 'Run discussion tests before restore verification.');
    await assert.rejects(() => payload.find({ collection: 'comments', overrideAccess: false }));
    const hidden = await payload.find({ collection: 'contents', where: { visibility: { equals: 'hidden' } }, overrideAccess: true, depth: 0, limit: 1 });
    await assert.rejects(() => payload.findByID({ collection: 'snapshots', id: Number(hidden.docs[0].currentSnapshot), overrideAccess: false }));
  } finally { await payload.destroy(); }
  const report = { status: 'passed', database: 'zifeiqiuyue_restore', counts, mediaFiles: fs.readdirSync(mediaSource).length, dump: path.relative(process.cwd(), dump), mediaTarget: path.relative(process.cwd(), mediaTarget), login: 'passed', restoredWrite: 'passed', annotationRanges: 'passed', hiddenContent: 'passed' };
  fs.writeFileSync('.local/p1-restore-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message.replace(/postgresql:\/\/\S+/g, '[redacted]')); process.exit(1); });
