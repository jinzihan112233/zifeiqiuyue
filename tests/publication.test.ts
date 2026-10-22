import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { before, after, test } from 'node:test';
import { getPayload, type Payload } from 'payload';
import sharp from 'sharp';
import { seed } from '../scripts/seed-community';
import { currentActor, writeContext, type Actor } from '../src/modules/access';
import { addAnnotation, createContent, decideSubmission, saveDraft, setVisibility, submitDraft, uploadMedia } from '../src/modules/community';
import { assertPurgeLedger, cleanupMedia, frozenPreview, ledgerDirectory, managementDetail, managementList, purgeContent, purgePreview, replayPurges } from '../src/modules/content-management';
import { exportBundle, importBundle, previewImport } from '../src/modules/content-transfer';
import { publicArchive, publicArticle } from '../src/modules/public-reading';
import { saveQuote } from '../src/modules/editorial';
import { changeAccount, signIn } from '../src/modules/accounts';

let payload: Payload, admin: Actor, member: Actor, other: Actor, editor: Actor, accounts: Record<string, { username: string; password: string }>, server: ChildProcess;
const origin = 'http://127.0.0.1:3100';
const title = 'P5 合成验证稿', text = '字里行间，有故事。';
const denied = (run: () => Promise<unknown>, codes = [400, 401, 403, 404, 409, 410]) => assert.rejects(run, error => codes.includes((error as { status: number }).status));
const create = (body = text, actor = member) => createContent(payload, actor, { slug: `p5-${randomUUID()}`, title, markdown: body });
async function publish(body = text, actor = member) { const result = await create(body, actor), submission = await submitDraft(payload, actor, Number(result.content.id), 1); const decision = await decideSubmission(payload, admin, Number(submission.id), 'approved'); return { ...result, submission, snapshot: decision.snapshot! }; }
async function media() { return uploadMedia(payload, member, await sharp({ create: { width: 20, height: 20, channels: 3, background: '#d7cbb6' } }).png().toBuffer(), '合成线描'); }
async function http(url: string, cookie = '', data?: unknown, method?: string) { return fetch(origin + url, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual' }); }
async function login(name: string) { const result = await http('/api/users/login', '', accounts[name]); assert.equal(result.status, 200); return result.headers.get('set-cookie')!.split(';')[0]; }
before(async () => {
  const url = new URL(process.env.DATABASE_TEST_URL!); assert.equal(url.pathname, '/zifeiqiuyue_test'); assert.equal(url.hostname, '127.0.0.1'); process.env.DATABASE_URL = url.toString(); process.env.MEDIA_ROOT = 'storage/test-media'; process.env.APP_ORIGIN = origin;
  const { default: config } = await import('../src/payload.config'); payload = await getPayload({ config }); accounts = await seed(payload, '.local/p1-test-accounts.json');
  const actor = async (username: string) => (await currentActor(payload, (await payload.find({ collection: 'users', where: { username: { equals: username } }, overrideAccess: true })).docs[0]))!;
  admin = await actor('admin'); member = await actor('membera'); other = await actor('memberb'); editor = await actor('editor'); await payload.db.pool.query('DELETE FROM community.auth_limits');
});
after(async () => { server?.kill(); if (payload) await payload.destroy(); });

test('retry keys bind submission identity and do not duplicate submissions or publication', async () => {
  const result = await create(), id = Number(result.content.id), key = randomUUID();
  const responses = await Promise.all([submitDraft(payload, member, id, 1, key), submitDraft(payload, member, id, 1, key)]); assert.equal(responses[0].id, responses[1].id);
  await denied(() => submitDraft(payload, member, id, 2, key), [409]);
  const decisionKey = randomUUID(); const first = await decideSubmission(payload, admin, Number(responses[0].id), 'approved', '', 'pending', decisionKey); const second = await decideSubmission(payload, admin, Number(responses[0].id), 'approved', '', 'pending', decisionKey); assert.equal(first.snapshot!.id, second.snapshot!.id);
  assert.equal((await payload.count({ collection: 'snapshots', where: { submission: { equals: responses[0].id } }, overrideAccess: true })).totalDocs, 1);
  await denied(() => decideSubmission(payload, admin, Number(responses[0].id), 'returned', '其他决定', 'pending', decisionKey), [409]);
});
test('database partial index prevents two pending submissions even through trusted writes', async () => {
  const result = await create(), sub = await submitDraft(payload, member, Number(result.content.id), 1);
  await assert.rejects(() => payload.create({ collection: 'submissions', data: { content: result.content.id, author: member.id, title, markdown: text, revision: 2, status: 'pending' }, context: writeContext(), overrideAccess: true }));
  await decideSubmission(payload, member, Number(sub.id), 'withdrawn');
});
test('return reasons are explicit and invalid media cannot block returning or withdrawal', async () => {
  const file = await media(), result = await create(`![线描](media:${file.id})`), sub = await submitDraft(payload, member, Number(result.content.id), 1);
  const target = path.resolve(process.env.MEDIA_ROOT!, file.filename), bytes = fs.readFileSync(target); fs.writeFileSync(target, 'invalid');
  try { await denied(() => decideSubmission(payload, admin, Number(sub.id), 'approved'), [409]); await denied(() => decideSubmission(payload, admin, Number(sub.id), 'returned', ''), [400]); await denied(() => decideSubmission(payload, admin, Number(sub.id), 'returned', 'a'.repeat(1001)), [400]); await decideSubmission(payload, admin, Number(sub.id), 'returned', '请更换图片'); }
  finally { fs.writeFileSync(target, bytes); }
  await denied(() => submitDraft(payload, member, Number(result.content.id), 1), [409]);
  await saveDraft(payload, member, Number(result.content.id), { title, markdown: `![线描](media:${file.id})\n\n修改后重送。`, revision: 1 });
  const next = await submitDraft(payload, member, Number(result.content.id), 2); fs.writeFileSync(target, 'invalid');
  try { await decideSubmission(payload, member, Number(next.id), 'withdrawn'); } finally { fs.writeFileSync(target, bytes); }
});
test('administrators cannot seize other members media; approvals validate frozen author media', async () => {
  const file = await media(); await denied(() => create(`![借图](media:${file.id})`, admin), [403]); const result = await publish(`![线描](media:${file.id})`); assert.ok(result.snapshot.html.includes('/api/media/file/'));
  assert.ok(result.snapshot.mediaManifest.length === 1); const preview = await frozenPreview(payload, admin, Number(result.content.id), Number(result.submission.id)); assert.equal(preview.html, result.snapshot.html);
});
test('trusted archive imports also refuse new bindings to another members media', async () => {
  const file = await media(); const home = (await payload.find({ collection: 'home', overrideAccess: true, depth: 0, limit: 1 })).docs[0];
  if (home) await payload.delete({ collection: 'home', id: home.id, context: writeContext(), overrideAccess: true });
  try {
    const bundle: any = { version: 1, items: [{ stableId: randomUUID(), slug: `import-${randomUUID()}`, kind: 'post', work: { title, markdown: `![线描](asset:${file.stableId})`, metadata: { demo: true } }, snapshots: [], currentSnapshot: null, visibility: 'unpublished' }], quotes: [], home: { introduction: '合成导入验证', featured: [] }, media: [{ stableId: file.stableId, alt: '线描', hash: file.bodyHash, bytes: fs.readFileSync(path.resolve(process.env.MEDIA_ROOT!, file.filename)) }] };
    const preview = await previewImport(payload, admin, bundle); await denied(() => importBundle(payload, admin, bundle, { expectedDigest: preview.digest }), [403]);
  } finally { if (home) { const { id, createdAt, updatedAt, ...data } = home; await payload.create({ collection: 'home', data, context: writeContext(), overrideAccess: true }); } }
});
test('frozen image metadata cannot change unnoticed', async () => {
  const file = await media(), result = await create(`![线描](media:${file.id})`), sub = await submitDraft(payload, member, Number(result.content.id), 1);
  await payload.update({ collection: 'media', id: file.id, data: { alt: '被改写的说明' }, context: writeContext(), overrideAccess: true });
  await denied(() => decideSubmission(payload, admin, Number(sub.id), 'approved'), [409]);
  await decideSubmission(payload, member, Number(sub.id), 'withdrawn');
});
test('a frozen version stays independent of the changed draft; admin notes remain private', async () => {
  const result = await create('冻结 A'), id = Number(result.content.id), sub = await submitDraft(payload, member, id, 1);
  await saveDraft(payload, member, id, { title: '工作稿 B', markdown: '后来修改 B', revision: 1 });
  await decideSubmission(payload, admin, Number(sub.id), 'approved', '公开反馈', 'pending', randomUUID(), '管理员私密备注');
  const own = await managementDetail(payload, member, id, Number(sub.id)); assert.equal(own.submission!.markdown, '冻结 A'); assert.equal(own.draft!.markdown, '后来修改 B'); assert.ok(!JSON.stringify(own).includes('管理员私密备注'));
  const privileged = await managementDetail(payload, admin, id); assert.ok(JSON.stringify(privileged).includes('管理员私密备注')); await denied(() => managementDetail(payload, other, id)); const staffView = await managementDetail(payload, editor, id); assert.ok(JSON.stringify(staffView).includes('管理员私密备注'));
});
test('banned authors cannot be approved and rollback includes audit records', async () => {
  const result = await create(), sub = await submitDraft(payload, member, Number(result.content.id), 1);
  await payload.update({ collection: 'users', id: member.id, data: { status: 'banned' }, context: writeContext(), overrideAccess: true });
  try { await denied(() => decideSubmission(payload, admin, Number(sub.id), 'approved'), [409]); } finally { await payload.update({ collection: 'users', id: member.id, data: { status: 'active' }, context: writeContext(), overrideAccess: true }); }
  const hook = () => { throw new Error('P5 audit rollback'); }, hooks = payload.collections['content-events'].config.hooks.beforeChange; hooks.push(hook);
  try { await assert.rejects(() => decideSubmission(payload, admin, Number(sub.id), 'approved'), /P5 audit rollback/); } finally { hooks.splice(hooks.indexOf(hook), 1); }
  assert.equal((await payload.findByID({ collection: 'submissions', id: sub.id, overrideAccess: true })).status, 'pending'); assert.equal((await payload.count({ collection: 'snapshots', where: { submission: { equals: sub.id } }, overrideAccess: true })).totalDocs, 0);
});
test('management lists paginate in the database and never include another members private work', async () => {
  for (let i = 0; i < 13; i++) { const created = await create(); await submitDraft(payload, member, Number(created.content.id), 1, randomUUID()); }
  const own = await managementList(payload, other, 'contents', 1); assert.ok(own.items.every((item: any) => item.slug)); assert.ok(own.items.length <= 12);
  const mine = await managementList(payload, member, 'submissions', 1, 'pending', 'post'); assert.ok(mine.items.every((item: any) => item.status === 'pending')); assert.ok(mine.pages > 1);
  await denied(() => managementList(payload, member, 'users', 1));
});
test('posts use publication time, remain separate from articles, and hidden versions stay hidden', async () => {
  const result = await publish(), id = Number(result.content.id), slug = result.content.slug;
  assert.equal((await publicArticle(payload, slug, undefined, 'post')).snapshot.id, result.snapshot.id); await denied(() => publicArticle(payload, slug), [404]);
  const list = await publicArchive(payload, '1', 'post'); assert.ok(list.items.some((item: any) => item.slug === slug));
  await setVisibility(payload, admin, id, 'hidden', '合成下架'); await denied(() => publicArticle(payload, slug, undefined, 'post'), [404]);
  await saveDraft(payload, member, id, { title, markdown: text + ' 新版', revision: 1 }); const sub = await submitDraft(payload, member, id, 2); await decideSubmission(payload, admin, Number(sub.id), 'approved'); assert.equal((await payload.findByID({ collection: 'contents', id, overrideAccess: true })).visibility, 'hidden');
  await setVisibility(payload, admin, id, 'public', '恢复合成稿', 'hidden');
});
test('purge preview rejects stale confirmations and shared media references', async () => {
  const file = await media(), first = await publish(`![线描](media:${file.id})`), second = await publish(`![同图](media:${file.id})`);
  const preview = await purgePreview(payload, admin, Number(first.content.id)); assert.ok(preview.counts.sharedReferences > 0);
  await denied(() => purgeContent(payload, admin, Number(first.content.id), { token: preview.token, confirm: '永久清除', reason: '合成测试' }), [409]);
  const fresh = await create(), old = await purgePreview(payload, admin, Number(fresh.content.id)); await saveDraft(payload, member, Number(fresh.content.id), { title, markdown: '范围已变化', revision: 1 }); await denied(() => purgeContent(payload, admin, Number(fresh.content.id), { token: old.token, confirm: '永久清除', reason: '合成测试' }), [409]);
  assert.ok(second.content.id);
});
test('purge removes historical bodies, quotations, annotations, private exports and all exclusive media', async () => {
  const marker = `SENSITIVE-${randomUUID()}`, file = await media(), result = await publish(`${marker}\n\n![线描](media:${file.id})`), id = Number(result.content.id);
  await saveDraft(payload, member, id, { title: marker, markdown: `${marker} 工作稿`, revision: 1 });
  await addAnnotation(payload, member, { snapshot: result.snapshot.id, start: 0, end: marker.length, quote: marker, body: marker });
  await saveQuote(payload, admin, { stableId: `p5-${randomUUID()}`, text: marker, attribution: marker, sourceUrl: '', demo: true, order: 1, enabled: true, content: id, snapshot: result.snapshot.id });
  const preview = await purgePreview(payload, admin, id); assert.ok(preview.counts.versions > 0); await denied(() => purgeContent(payload, member, id, { token: preview.token, confirm: '永久清除', reason: marker }), [403]);
  const cleanup = await purgeContent(payload, admin, id, { token: preview.token, confirm: '永久清除', reason: marker }); assert.equal(cleanup.status, 'done');
  assert.ok(!fs.existsSync(path.resolve(process.env.MEDIA_ROOT!, file.filename))); assert.equal((await payload.findByID({ collection: 'contents', id, overrideAccess: true })).visibility, 'purged');
  for (const table of ['drafts', '_drafts_v', 'submissions', 'snapshots', 'annotations', 'quotes', 'content_events']) { const rows = await payload.db.pool.query(`SELECT count(*)::int AS count FROM community.${table} t WHERE row_to_json(t)::text LIKE $1`, [`%${marker}%`]); assert.equal(rows.rows[0].count, 0, table); }
  assert.ok(!JSON.stringify(await exportBundle(payload, admin, { includeDrafts: true })).includes(marker));
  await denied(() => saveDraft(payload, member, id, { title, markdown: text, revision: 2 }), [410]); await denied(() => setVisibility(payload, admin, id, 'public'), [410]); await denied(() => managementDetail(payload, admin, id), [410]);
  await assertPurgeLedger(payload); const record = fs.readFileSync(path.join(ledgerDirectory(), `${result.content.stableId}.json`), 'utf8'); assert.ok(!record.includes(marker));
});
test('failed file deletion persists retryable work and never exposes purged media', async () => {
  const file = await media(), result = await publish(`![线描](media:${file.id})`), id = Number(result.content.id), preview = await purgePreview(payload, admin, id), unlink = fs.unlinkSync;
  fs.unlinkSync = ((target: fs.PathLike) => { if (String(target).endsWith(file.filename)) throw new Error('Synthetic file permission failure'); return unlink(target); }) as typeof fs.unlinkSync;
  try { const result = await purgeContent(payload, admin, id, { token: preview.token, confirm: '永久清除', reason: '合成故障' }); assert.equal(result.status, 'pending'); } finally { fs.unlinkSync = unlink; }
  await denied(() => payload.findByID({ collection: 'media', id: file.id, user: member, overrideAccess: false }));
  assert.equal((await cleanupMedia(payload, admin)).status, 'done'); assert.equal((await cleanupMedia(payload, admin)).pending, 0);
});
test('repeated purge confirmation preserves the independent media directive', async () => {
  const file = await media(), result = await publish(`![线描](media:${file.id})`), id = Number(result.content.id);
  for (let i = 0; i < 2; i++) { const preview = await purgePreview(payload, admin, id); await purgeContent(payload, admin, id, { token: preview.token, confirm: '永久清除', reason: '重复请求合成验证' }); }
  const ledger = JSON.parse(fs.readFileSync(path.join(ledgerDirectory(), `${result.content.stableId}.json`), 'utf8')); assert.ok(ledger.media.includes(file.stableId));
});
test('a session accepted before password change is rechecked inside the writing transaction', async () => {
  await signIn(payload, accounts.membera, new Headers());
  const row = await payload.findByID({ collection: 'users', id: member.id, depth: 0, overrideAccess: true }); const sid = row.sessions.at(-1).id;
  const accepted = await currentActor(payload, { id: member.id, _sid: sid }); assert.ok(accepted);
  try { await changeAccount(payload, accepted, 'password', { currentPassword: accounts.membera.password, password: 'P5-synthetic-password-change', confirmPassword: 'P5-synthetic-password-change' }); await denied(() => create(text, accepted), [403]); }
  finally { await payload.update({ collection: 'users', id: member.id, data: { password: accounts.membera.password, sessions: [] }, context: writeContext(), overrideAccess: true }); }
});
test('independent purge ledger blocks restored old visibility until directives are replayed', async () => {
  const result = await publish(), id = Number(result.content.id), preview = await purgePreview(payload, admin, id); await purgeContent(payload, admin, id, { token: preview.token, confirm: '永久清除', reason: '合成恢复验证' });
  await payload.db.pool.query("UPDATE community.contents SET visibility='hidden' WHERE id=$1", [id]);
  await assert.rejects(() => assertPurgeLedger(payload), /Pending purge directive/); await replayPurges(payload, admin); await assertPurgeLedger(payload);
});
test('an actual pre-purge database backup cannot reopen cleared text after isolated restore', async () => {
  const marker = `BACKUP-SECRET-${randomUUID()}`, result = await publish(marker), source = new URL(process.env.DATABASE_TEST_URL!), migrate = new URL(process.env.DATABASE_MIGRATION_URL!); migrate.pathname = '/zifeiqiuyue_restore';
  assert.equal(source.hostname, '127.0.0.1'); assert.equal(migrate.hostname, source.hostname); assert.equal(source.port, migrate.port); assert.equal(source.pathname, '/zifeiqiuyue_test');
  const stamp = randomUUID(), dump = path.resolve('.local', `p5-before-purge-${stamp}.dump`), mediaRoot = path.resolve('storage', `p5-restored-${stamp}`);
  const dbEnv = (url: URL) => ({ ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: url.username, PGPASSWORD: decodeURIComponent(url.password) });
  const bin = (name: string) => path.resolve('.local/postgres/pgsql/bin', `${name}.exe`);
  execFileSync(bin('pg_dump'), ['--schema=community', '--format=custom', '--no-owner', '--no-acl', '--file', dump, '--dbname', source.pathname.slice(1)], { env: dbEnv(source), stdio: 'pipe', windowsHide: true });
  const preview = await purgePreview(payload, admin, Number(result.content.id)); await purgeContent(payload, admin, Number(result.content.id), { token: preview.token, confirm: '永久清除', reason: '合成备份恢复演练' });
  fs.cpSync(path.resolve(process.env.MEDIA_ROOT!), mediaRoot, { recursive: true });
  // Only the explicitly named disposable restore database is overwritten.
  execFileSync(bin('pg_restore'), ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', 'zifeiqiuyue_restore', dump], { env: dbEnv(migrate), stdio: 'pipe', windowsHide: true });
  const { Client } = await import('pg'); const adminDB = new Client({ connectionString: migrate.toString() }); await adminDB.connect();
  try { await adminDB.query('GRANT USAGE ON SCHEMA community TO zfq_app'); await adminDB.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA community TO zfq_app'); await adminDB.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA community TO zfq_app'); } finally { await adminDB.end(); }
  const runtime = new URL(source); runtime.pathname = migrate.pathname;
  const env = { ...process.env, DATABASE_URL: runtime.toString(), MEDIA_ROOT: mediaRoot, PURGE_LEDGER_DIR: ledgerDirectory() };
  const run = (code: string) => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env, stdio: 'pipe', windowsHide: true, timeout: 20000 });
  run(`import {getPayload} from 'payload';const {default:config}=await import('./src/payload.config.ts');try{await getPayload({config});process.exit(2);}catch(e){process.exit(e.message.includes('Pending purge directive')?0:3);}`);
  run(`process.env.PURGE_REPLAY='true';import {getPayload} from 'payload';import {currentActor} from './src/modules/access.ts';import {replayPurges} from './src/modules/content-management.ts';const {default:config}=await import('./src/payload.config.ts');const p=await getPayload({config});const a=(await p.find({collection:'users',where:{username:{equals:'admin'}},overrideAccess:true})).docs[0];await replayPurges(p,await currentActor(p,a));const r=await p.db.pool.query('SELECT visibility FROM community.contents WHERE id=$1',[${result.content.id}]);if(r.rows[0].visibility!=='purged')process.exit(4);for(const table of ['drafts','snapshots','submissions']){const r=await p.db.pool.query('SELECT count(*)::int AS count FROM community.'+table+' t WHERE row_to_json(t)::text LIKE $1',['%'+${JSON.stringify(marker)}+'%']);if(r.rows[0].count)process.exit(5);}await p.destroy();process.exit(0);`);
});
test('production HTTP endpoints enforce role, parent identity, no-store and frozen publication', async () => {
  const logPath = path.resolve('.local/p5-http.log'), log = fs.openSync(logPath, 'a');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3100'], { env: process.env, stdio: ['ignore', log, log], windowsHide: true }); fs.closeSync(log);
  let ready = false; for (let i = 0; i < 100; i++) { try { if ((await http('/api/account/session')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 200)); } assert.ok(ready, 'Production server not ready; see .local/p5-http.log');
  const own = await login('membera'), foreign = await login('memberb'), adminCookie = await login('admin'), result = await create(), id = Number(result.content.id);
  assert.equal((await http(`/api/community/manage-detail/${id}`, foreign)).status, 403); assert.equal((await http(`/api/community/purge-preview/${id}`, own)).status, 403); assert.equal((await http('/api/community/manage-list?type=submissions', '')).status, 401);
  const sub = await http(`/api/community/submit/${id}`, own, { revision: 1, requestKey: randomUUID() }).then(r => r.json());
  const rejected = await http(`/api/community/decision/${sub.id}`, adminCookie, { decision: 'returned', reason: '' }); assert.equal(rejected.status, 400);
  const approved = await http(`/api/community/decision/${sub.id}`, adminCookie, { decision: 'approved', reason: '', requestKey: randomUUID(), expectedStatus: 'pending' }); assert.equal(approved.status, 200);
  const page = await http(`/posts/${result.content.slug}`); assert.equal(page.status, 200); const html = await page.text(); assert.ok(html.includes(text)); assert.ok(!html.includes('internalNote'));
  assert.equal((await http(`/articles/${result.content.slug}`)).status, 404); assert.equal((await http('/community')).status, 200);
  for (const route of [`/workspace/edit/${id}`, `/workspace/review/${id}?submission=${sub.id}`, `/api/community/manage-detail/${id}`]) { const response = await http(route, own); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /no-store/); }
  await http(`/api/community/visibility/${id}`, adminCookie, { visibility: 'hidden', reason: 'HTTP 下架', expectedStatus: 'public' }); assert.equal((await http(`/posts/${result.content.slug}`)).status, 404);
});
