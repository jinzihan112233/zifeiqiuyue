import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Client } from 'pg';
import { getPayload, jwtSign, type Payload } from 'payload';
import { seed } from '../scripts/seed-community';
import { currentActor, writeContext, type Actor } from '../src/modules/access';
import { addAnnotation, createContent, decideSubmission, saveDraft, setVisibility, submitDraft, uploadMedia } from '../src/modules/community';
import { imageIds, renderMarkdown } from '../src/modules/markdown';

let payload: Payload, admin: Actor, memberA: Actor, memberB: Actor, editor: Actor;
let accounts: Record<string, { username: string; password: string }>;
let server: ChildProcess | undefined;
const origin = 'http://127.0.0.1:3100';
const sample = '## 正文\n\n故事有回声。故事有回声。\n\n带着 **勇气**、[来源](https://example.com) 与 🌙 e\u0301，继续向前。';
const create = (markdown = sample) => createContent(payload, memberA, { slug: `test-${randomUUID()}`, title: '合成测试稿', markdown });
const publish = async (markdown = sample) => { const created = await create(markdown); const submission = await submitDraft(payload, memberA, Number(created.content.id), 1); const result = await decideSubmission(payload, admin, Number(submission.id), 'approved'); return { created, submission, snapshot: result.snapshot! }; };
const denied = (run: () => Promise<unknown>, statuses = [403, 404]) => assert.rejects(run, (error: unknown) => statuses.includes((error as { status: number }).status));

before(async () => {
  const url = new URL(process.env.DATABASE_TEST_URL!);
  assert.equal(url.pathname, '/zifeiqiuyue_test');
  assert.equal(url.hostname, '127.0.0.1');
  process.env.DATABASE_URL = url.toString(); process.env.MEDIA_ROOT = 'storage/test-media';
  const { default: config } = await import('../src/payload.config');
  payload = await getPayload({ config });
  await payload.db.pool.query('DELETE FROM community.auth_limits');
  accounts = await seed(payload, '.local/p1-test-accounts.json');
  const user = async (username: string) => (await payload.find({ collection: 'users', where: { username: { equals: username } }, overrideAccess: true, depth: 0 })).docs[0];
  admin = (await currentActor(payload, await user('admin')))!;
  memberA = (await currentActor(payload, await user('membera')))!;
  memberB = (await currentActor(payload, await user('memberb')))!;
  editor = (await currentActor(payload, await user('editor')))!;
});
after(async () => { server?.kill(); if (payload) await payload.destroy(); });

test('media quota rejects an oversized allocation without leaving records or files', async () => {
  const prior = process.env.MEDIA_QUOTA_MIB;
  process.env.MEDIA_QUOTA_MIB = '1';
  const before = { count: (await payload.count({ collection: 'media', overrideAccess: true })).totalDocs, files: fs.readdirSync(process.env.MEDIA_ROOT!).sort() };
  try {
    const bytes = await sharp(randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
    await denied(() => uploadMedia(payload, memberA, bytes, '容量边界测试'), [413]);
    assert.equal((await payload.count({ collection: 'media', overrideAccess: true })).totalDocs, before.count);
    assert.deepEqual(fs.readdirSync(process.env.MEDIA_ROOT!).sort(), before.files);
  } finally { if (prior === undefined) delete process.env.MEDIA_QUOTA_MIB; else process.env.MEDIA_QUOTA_MIB = prior; }
});

test('application role cannot administer databases or create schema objects', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { const { rows } = await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user'); assert.deepEqual(rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false }); await assert.rejects(() => client.query('CREATE TABLE community.unauthorized_probe(id int)'), /permission denied/); } finally { await client.end(); }
});
test('username-only authentication works and repeated seed preserves passwords', async () => {
  // Payload's fallback auth typings assume email; this collection explicitly uses username.
  const login = await payload.login({ collection: 'users', data: accounts.membera as unknown as Parameters<Payload['login']>[0]['data'] }); assert.equal(login.user?.username, 'membera'); assert.equal(login.token, undefined);
  const before = accounts.membera.password; await seed(payload, '.local/p1-test-accounts.json'); assert.equal(accounts.membera.password, before);
  await denied(() => payload.create({ collection: 'users', data: { username: 'forbidden', password: 'not-a-real-password', nickname: '伪造', role: 'admin', status: 'active' }, overrideAccess: true }));
});
test('owner access and Local API constraints prevent cross-account draft reads', async () => {
  const { draft } = await create();
  await denied(() => payload.findByID({ collection: 'drafts', id: draft.id, user: memberB, overrideAccess: false }));
  await denied(() => payload.findByID({ collection: 'drafts', id: draft.id, overrideAccess: false }));
  const own = await payload.findByID({ collection: 'drafts', id: draft.id, user: memberA, overrideAccess: false, depth: 0 }); assert.equal(Number(own.author), memberA.id);
});
test('generic writes cannot bypass workflow even with overrideAccess', async () => {
  const { created, snapshot } = await publish();
  await denied(() => payload.update({ collection: 'contents', id: created.content.id, data: { visibility: 'public' }, user: memberA, overrideAccess: false }));
  await denied(() => payload.update({ collection: 'snapshots', id: snapshot.id, data: { markdown: '偷换' }, user: admin, overrideAccess: true }));
  await denied(() => payload.update({ collection: 'users', id: memberA.id, data: { role: 'admin' }, user: memberA, overrideAccess: false }));
});
test('last administrator cannot be demoted or banned and draft versions remain private', async () => {
  await denied(() => payload.update({ collection: 'users', id: admin.id, user: admin, data: { role: 'member' }, overrideAccess: false }), [409]);
  await denied(() => payload.update({ collection: 'users', id: admin.id, user: admin, data: { status: 'banned' }, overrideAccess: false }), [409]);
  const { draft } = await create();
  const versions = await payload.findVersions({ collection: 'drafts', where: { parent: { equals: draft.id } }, overrideAccess: true }); assert.ok(versions.totalDocs > 0);
  const foreign = await payload.findVersions({ collection: 'drafts', where: { parent: { equals: draft.id } }, user: memberB, overrideAccess: false }); assert.equal(foreign.totalDocs, 0);
  const own = await payload.findVersions({ collection: 'drafts', where: { parent: { equals: draft.id } }, user: memberA, overrideAccess: false }); assert.ok(own.totalDocs > 0);
  await denied(() => payload.restoreVersion({ collection: 'drafts', id: versions.docs[0].id, user: memberA, overrideAccess: true }));
});
test('draft revisions reject stale tabs and foreign authors', async () => {
  const { content } = await create();
  await saveDraft(payload, memberA, Number(content.id), { title: '第二稿', markdown: sample, revision: 1 });
  await denied(() => saveDraft(payload, memberA, Number(content.id), { title: '旧标签页', markdown: sample, revision: 1 }), [409]);
  await denied(() => saveDraft(payload, memberB, Number(content.id), { title: '冒名', markdown: sample, revision: 2 }));
});
test('concurrent administrator demotions preserve an active administrator', async () => {
  const secondary = await payload.create({ collection: 'users', data: { username: `admin${randomUUID().replaceAll('-', '').slice(0, 12)}`, password: randomUUID() + randomUUID(), nickname: '并发管理验证', role: 'admin', status: 'active' }, context: writeContext(), overrideAccess: true });
  const actor = (await currentActor(payload, secondary))!;
  try {
    const results = await Promise.allSettled([
      payload.update({ collection: 'users', id: admin.id, user: admin, data: { role: 'member' }, overrideAccess: false }),
      payload.update({ collection: 'users', id: actor.id, user: actor, data: { role: 'member' }, overrideAccess: false }),
    ]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    const remaining = await payload.count({ collection: 'users', where: { and: [{ role: { equals: 'admin' } }, { status: { equals: 'active' } }] }, overrideAccess: true }); assert.equal(remaining.totalDocs, 1);
  } finally {
    await payload.update({ collection: 'users', id: admin.id, data: { role: 'admin', status: 'active' }, context: writeContext(), overrideAccess: true });
    await payload.update({ collection: 'users', id: actor.id, data: { role: 'member', status: 'banned' }, context: writeContext(), overrideAccess: true });
  }
});
test('review publishes frozen A while edited B stays private; old public version survives edits', async () => {
  const { content } = await create('冻结内容 A'); const id = Number(content.id);
  const submission = await submitDraft(payload, memberA, id, 1);
  await saveDraft(payload, memberA, id, { title: '新工作稿', markdown: '工作稿 B', revision: 1 });
  const result = await decideSubmission(payload, admin, Number(submission.id), 'approved'); assert.equal(result.snapshot!.markdown, '冻结内容 A');
  const current = await payload.findByID({ collection: 'snapshots', id: result.snapshot!.id, overrideAccess: false }); assert.equal(current.markdown, '冻结内容 A');
});
test('editors cannot approve member submissions', async () => {
  const { content } = await create(); const submission = await submitDraft(payload, memberA, Number(content.id), 1);
  await denied(() => decideSubmission(payload, editor, Number(submission.id), 'approved'));
});
test('only one pending submission and one concurrent review decision can succeed', async () => {
  const { content } = await create(); const id = Number(content.id);
  const submits = await Promise.allSettled([submitDraft(payload, memberA, id, 1), submitDraft(payload, memberA, id, 1)]); assert.equal(submits.filter(x => x.status === 'fulfilled').length, 1);
  const submission = (submits.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<{ id: number }>).value;
  const decisions = await Promise.allSettled([decideSubmission(payload, admin, Number(submission.id), 'approved'), decideSubmission(payload, admin, Number(submission.id), 'returned', '请补充内容')]); assert.equal(decisions.filter(x => x.status === 'fulfilled').length, 1);
  const stored = await payload.findByID({ collection: 'submissions', id: submission.id, overrideAccess: true });
  const snapshots = await payload.count({ collection: 'snapshots', where: { submission: { equals: submission.id } }, overrideAccess: true }); assert.equal(snapshots.totalDocs, stored.status === 'approved' ? 1 : 0);
});
test('withdraw versus approve is atomic and closed submissions cannot be resubmitted as approved', async () => {
  const { content } = await create(); const submission = await submitDraft(payload, memberA, Number(content.id), 1);
  const results = await Promise.allSettled([decideSubmission(payload, memberA, Number(submission.id), 'withdrawn'), decideSubmission(payload, admin, Number(submission.id), 'approved')]); assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  await denied(() => decideSubmission(payload, admin, Number(submission.id), 'approved'), [409]);
});
test('a queue larger than the connection pool finishes without nested connection starvation', { timeout: 15000 }, async () => {
  const { content } = await create();
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => submitDraft(payload, memberA, Number(content.id), 1)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.ok(results.filter(x => x.status === 'rejected').every(x => (x as PromiseRejectedResult).reason.status === 409));
});
test('a failure after snapshot creation rolls back decision and current pointer', async () => {
  const { content } = await create(); const submission = await submitDraft(payload, memberA, Number(content.id), 1);
  const hooks = payload.collections.snapshots.config.hooks.afterChange;
  const fail = () => { throw new Error('deliberate transaction rollback probe'); }; hooks.push(fail);
  try { await assert.rejects(() => decideSubmission(payload, admin, Number(submission.id), 'approved'), /rollback probe/); } finally { hooks.splice(hooks.indexOf(fail), 1); }
  assert.equal((await payload.findByID({ collection: 'submissions', id: submission.id, overrideAccess: true })).status, 'pending');
  assert.equal((await payload.count({ collection: 'snapshots', where: { submission: { equals: submission.id } }, overrideAccess: true })).totalDocs, 0);
  assert.equal((await payload.findByID({ collection: 'contents', id: content.id, overrideAccess: true })).currentSnapshot, null);
});
test('private media is owner-only, cannot be borrowed, and generic replacement is blocked', async () => {
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#d6c7a6' } }).png().toBuffer();
  const media = await uploadMedia(payload, memberA, bytes, '测试纸面');
  await denied(() => payload.findByID({ collection: 'media', id: media.id, overrideAccess: false }));
  await denied(() => createContent(payload, memberB, { slug: `borrow-${randomUUID()}`, title: '借图', markdown: `![测试](media:${media.id})` }));
  await denied(() => payload.update({ collection: 'media', id: media.id, data: { alt: '替换' }, user: memberA, overrideAccess: true }));
  const { created, snapshot } = await publish(`![测试](media:${media.id})`); assert.ok(String(snapshot.html).includes('/api/media/file/'));
  await payload.findByID({ collection: 'media', id: media.id, overrideAccess: false });
  await setVisibility(payload, admin, Number(created.content.id), 'hidden');
  await denied(() => payload.findByID({ collection: 'media', id: media.id, overrideAccess: false }));
  await publish(`![同一图片](media:${media.id})`); await payload.findByID({ collection: 'media', id: media.id, overrideAccess: false });
});
test('remote images, SVG and malformed images are rejected; raw HTML remains text', async () => {
  assert.throws(() => imageIds('![外链](https://example.com/test.png)'));
  await denied(() => uploadMedia(payload, memberA, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), '伪装图'), [400]);
  await denied(() => uploadMedia(payload, memberA, Buffer.from('not an image'), '无效图片'), [400]);
  const html = renderMarkdown('<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)', new Map()).html; assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:'));
});
test('annotation uses code points, verifies quote, and remains attached to old snapshot', async () => {
  const { created, snapshot } = await publish(); const text = String(snapshot.plainText);
  const utf16 = text.lastIndexOf('故事有回声'); const start = Array.from(text.slice(0, utf16)).length, quote = '故事有回声';
  const annotation = await addAnnotation(payload, memberA, { snapshot: snapshot.id, start, end: start + Array.from(quote).length, quote, body: '第二处重复句' });
  assert.equal(annotation.quote, quote);
  await denied(() => addAnnotation(payload, memberA, { snapshot: snapshot.id, start, end: start + 2, quote, body: '伪造范围' }), [400]);
  const newline = Array.from(text).indexOf('\n'); await denied(() => addAnnotation(payload, memberA, { snapshot: snapshot.id, start: newline, end: newline + 1, quote: '\n', body: '空白选区' }), [400]);
  const emojiStart = Array.from(text.slice(0, text.indexOf('🌙'))).length;
  await addAnnotation(payload, memberA, { snapshot: snapshot.id, start: emojiStart, end: emojiStart + 1, quote: '🌙', body: 'emoji 定位' });
  const chars = Array.from(text), acrossStart = Array.from(text.slice(0, text.indexOf('回声'))).length, acrossEnd = Array.from(text.slice(0, text.indexOf('继续向前') + '继续向前'.length)).length;
  await addAnnotation(payload, memberA, { snapshot: snapshot.id, start: acrossStart, end: acrossEnd, quote: chars.slice(acrossStart, acrossEnd).join(''), body: '跨段、粗体与链接范围' });
  const combining = Array.from(text.slice(0, text.indexOf('e\u0301'))).length;
  await addAnnotation(payload, memberA, { snapshot: snapshot.id, start: combining, end: combining + 2, quote: 'e\u0301', body: '组合字符范围' });
  await saveDraft(payload, memberA, Number(created.content.id), { revision: 1, title: '新版', markdown: '前置段落\n\n' + sample });
  const submission = await submitDraft(payload, memberA, Number(created.content.id), 2); await decideSubmission(payload, admin, Number(submission.id), 'approved');
  const old = await payload.findByID({ collection: 'annotations', id: annotation.id, overrideAccess: false, depth: 0 }); assert.equal(old.snapshot, snapshot.id);
  await setVisibility(payload, admin, Number(created.content.id), 'hidden');
  await denied(() => payload.findByID({ collection: 'snapshots', id: snapshot.id, overrideAccess: false }));
  await denied(() => payload.findByID({ collection: 'annotations', id: annotation.id, overrideAccess: false }));
});
test('approving a new version does not silently restore a hidden content', async () => {
  const { created } = await publish(); const id = Number(created.content.id); await setVisibility(payload, admin, id, 'hidden');
  await saveDraft(payload, memberA, id, { revision: 1, title: '隐藏内容新版', markdown: sample + '\n\n新版。' }); const submission = await submitDraft(payload, memberA, id, 2); await decideSubmission(payload, admin, Number(submission.id), 'approved');
  assert.equal((await payload.findByID({ collection: 'contents', id, overrideAccess: true })).visibility, 'hidden');
});

async function http(url: string, cookie = '', method = 'GET', data?: unknown, originHeader = origin) {
  return fetch(origin + url, { method, headers: { 'Sec-Fetch-Site': originHeader === origin ? 'same-origin' : 'cross-site', ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: originHeader, 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, redirect: 'manual' });
}
const loginHttp = async (name: string) => { const response = await http('/api/users/login', '', 'POST', accounts[name]); assert.equal(response.status, 200); const value = await response.json(); assert.ok(!value.token); const cookie = response.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); return cookie.split(';')[0]; };
test('production server starts and HTTP boundaries protect private records and CSRF', async () => {
  const log = fs.openSync('.local/p1-http-test.log', 'w');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3100'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: process.env.DATABASE_TEST_URL, MEDIA_ROOT: 'storage/test-media', APP_ORIGIN: origin }, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log);
  let ready = false; for (let i = 0; i < 120; i++) { try { const r = await http('/api/community/session'); if (r.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  assert.ok(ready, 'Server did not become ready; see .local/p1-http-test.log');
  const cookieA = await loginHttp('membera'), cookieB = await loginHttp('memberb');
  const cookieToken = decodeURIComponent(cookieA.slice(cookieA.indexOf('=') + 1)); const claims = JSON.parse(Buffer.from(cookieToken.split('.')[1], 'base64url').toString('utf8'));
  const expired = await jwtSign({ fieldsToSign: claims, secret: payload.secret, tokenExpiration: -5 });
  const expiredCookie = cookieA.split('=')[0] + '=' + expired.token; assert.equal((await http('/api/community/session', expiredCookie).then(r=>r.json())).user, null);
  const invalidCookie = cookieA.split('=')[0] + '=invalid-token'; assert.equal((await http('/api/community/session', invalidCookie).then(r=>r.json())).user, null);
  const { draft } = await create(); const read = await http(`/api/drafts/${draft.id}?depth=0`, cookieB); assert.ok([403,404].includes(read.status));
  const createUser = await http('/api/users', '', 'POST', { username: 'bypass', password: 'not-a-real-password', nickname: '伪造', role: 'admin', status: 'active' }); assert.ok([400,401,403].includes(createUser.status));
  const firstUser = await http('/api/users/first-register', '', 'POST', { username: 'first-bypass', password: 'not-a-real-password', nickname: '伪造', role: 'admin' }); assert.ok([400,401,403,404].includes(firstUser.status));
  const crossOrigin = await http('/api/community/content', cookieA, 'POST', { slug: 'cross-origin', title: '跨站', markdown: sample }, 'https://evil.invalid'); assert.equal(crossOrigin.status, 403);
  const { snapshot } = await publish(); const mutation = await http(`/api/snapshots/${snapshot.id}`, cookieA, 'PATCH', { markdown: '偷换' }); assert.ok([401,403].includes(mutation.status));
  const workspace = await http('/api/community/workspace', cookieA); assert.match(workspace.headers.get('cache-control')!, /no-store/);
  const adminPage = await http('/admin', cookieA); const adminBody = await adminPage.text(); assert.ok([302,303,307,308,403].includes(adminPage.status) || adminPage.status === 200 && /NEXT_REDIRECT[^\n]{0,100}\/admin\/(?:login|unauthorized)/.test(adminBody), `Unexpected admin response: status=${adminPage.status}`);
  const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#d6c7a6' } }).png().toBuffer(); const media = await uploadMedia(payload, memberA, bytes, 'HTTP 图片');
  for (const url of [media.url, media.sizes?.thumb?.url]) { assert.ok(url); const response = await http(new URL(String(url), origin).pathname); assert.ok([403,404].includes(response.status)); }
  const pub = await publish(`![HTTP 图片](media:${media.id})`);
  for (const url of [media.url, media.sizes?.thumb?.url]) { const response = await http(new URL(String(url), origin).pathname); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/); }
  await setVisibility(payload, admin, Number(pub.created.content.id), 'hidden');
  for (const url of [media.url, media.sizes?.thumb?.url]) { const hidden = await http(new URL(String(url), origin).pathname); assert.ok([403,404].includes(hidden.status)); }
  await payload.update({ collection: 'users', id: memberB.id, data: { status: 'banned' }, context: writeContext(), overrideAccess: true });
  assert.equal((await http('/api/community/session', cookieB).then(r=>r.json())).user, null);
  const blockedWrite = await http('/api/community/content', cookieB, 'POST', { slug: 'blocked', title: '不应保存', markdown: sample }); assert.ok([401,403].includes(blockedWrite.status));
  await payload.update({ collection: 'users', id: memberB.id, data: { status: 'active' }, context: writeContext(), overrideAccess: true });
  assert.equal((await http('/api/community/session', cookieB).then(r=>r.json())).user, null, 'Unbanning must not restore old session');
  await http('/api/users/logout', cookieA, 'POST', {}); assert.equal((await http('/api/community/session', cookieA).then(r=>r.json())).user, null);
});

test('P2 HTTP routes publish article metadata and hide linked quotes/recommendations at the server', async () => {
  const editorCookie = await loginHttp('editor'), adminCookie = await loginHttp('admin'), memberCookie = await loginHttp('membera');
  const markdown = '## 开头\n\n合成开头。\n\n## 简介\n\n**合成摘要**。\n\n## 正文\n\nHTTP 合成正文。\n\n## 后记\n\n不是作者原话。';
  const input = { kind: 'article', slug: `http-p2-${randomUUID()}`, title: 'HTTP 站方合成稿', markdown, metadata: { category: '演示', demo: true, sourceUrl: 'https://example.com/source', originalVideoDate: '2026-01-02', legacyDate: '' } };
  assert.equal((await http('/api/community/content', memberCookie, 'POST', input)).status, 403);
  const createdResponse = await http('/api/community/content', editorCookie, 'POST', input); assert.equal(createdResponse.status, 201); const created = await createdResponse.json();
  const preview = await http('/api/community/preview', editorCookie, 'POST', { markdown }); assert.equal(preview.status, 200); assert.match((await preview.json()).html, /<strong>合成摘要<\/strong>/);
  const submissionResponse = await http(`/api/community/submit/${created.content.id}`, editorCookie, 'POST', { revision: 1 }); assert.equal(submissionResponse.status, 201); const submission = await submissionResponse.json();
  const approvedResponse = await http(`/api/community/decision/${submission.id}`, editorCookie, 'POST', { decision: 'approved' }); assert.equal(approvedResponse.status, 200); const approved = await approvedResponse.json();
  const reader = await http(`/api/community/reader?content=${created.content.id}`).then(r => r.json()); assert.equal(reader.snapshot.metadata.sourceUrl, input.metadata.sourceUrl); assert.match(reader.snapshot.summary, /合成摘要/);
  const quote = { stableId: `http-quote-${randomUUID()}`, text: 'HTTP 合成摘句', attribution: '本站测试', sourceUrl: '', demo: true, enabled: true, order: 1, content: created.content.id, snapshot: approved.snapshot.id };
  assert.equal((await http('/api/community/quote', memberCookie, 'POST', quote)).status, 403);
  assert.equal((await http('/api/community/quote', editorCookie, 'POST', quote)).status, 200);
  assert.equal((await http('/api/community/home', editorCookie, 'POST', { introduction: 'HTTP 合成简介', featured: [created.content.id] })).status, 200);
  const publicBefore = await http('/api/community/home').then(r => r.json()); assert.ok(publicBefore.featured.some((c: { slug: string }) => c.slug === input.slug)); assert.ok(publicBefore.quotes.some((q: { stableId: string }) => q.stableId === quote.stableId));
  const memberSession = await http('/api/community/session', memberCookie).then(r => r.json());
  assert.equal(memberSession.user?.role, 'member', 'The test member session should remain valid');
  const editorialDenied = await http('/api/community/editorial', memberCookie);
  assert.equal(editorialDenied.status, 403, await editorialDenied.text());
  const nativeHome = await http('/api/home'); assert.ok([401,403].includes(nativeHome.status) || !(await nativeHome.json()).docs.length);
  assert.equal((await http(`/api/community/visibility/${created.content.id}`, adminCookie, 'POST', { visibility: 'hidden', reason: '下架测试' })).status, 200);
  const publicAfter = await http('/api/community/home').then(r => r.json()); assert.ok(!publicAfter.featured.some((c: { slug: string }) => c.slug === input.slug)); assert.ok(!publicAfter.quotes.some((q: { stableId: string }) => q.stableId === quote.stableId));
  const nativeQuotes = await http('/api/quotes?limit=1000').then(r => r.json()); assert.ok(!nativeQuotes.docs.some((q: { stableId: string }) => q.stableId === quote.stableId));
  assert.equal((await http(`/api/community/reader?content=${created.content.id}`)).status, 404);
});
