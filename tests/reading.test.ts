import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import sharp from 'sharp';
import { getPayload, type Payload } from 'payload';
import { seed } from '../scripts/seed-community';
import { currentActor, type Actor } from '../src/modules/access';
import { addAnnotation, createContent, decideSubmission, saveDraft, setVisibility, submitDraft, uploadMedia } from '../src/modules/community';
import { saveHome, saveQuote } from '../src/modules/editorial';
import { pageNumber, publicArchive, publicArticle, readHome } from '../src/modules/public-reading';
import { readingDate } from '../src/modules/reading-date';
import { defaultMetadata } from '../src/modules/content-types';

let payload: Payload, editor: Actor, admin: Actor, server: ChildProcess | undefined;
const origin = 'http://127.0.0.1:3100', stamp = randomUUID();
let samples: { id: number; slug: string; stableId: string; snapshotId: number; version: string }[] = [];
let oldVersion: string, secret: string, secretSlug: string, mediaURL: string;
const body = '## 开头\n\n此篇为社区软件的合成演示，不是作者原话。\n\n## 简介\n\n借一页文字，与古今相逢。此处用于验证阅读排版。\n\n## 正文\n\n### 一 · 听见回声\n\n故事有回声。故事有回声。带着 **勇气**、*好奇* 与 🌙 e\u0301，继续向前。\n\n> 让故事有处可读，让讨论有所依凭。\n\n- 留一处空白\n- 写一段回响\n\n| 栏目 | 演示内容 |\n| --- | --- |\n| 阅读 | 一段人间故事 |\n\n```text\n' + 'long-code-'.repeat(30) + '\n```\n\n[长链接](https://example.com/' + 'long-path-'.repeat(30) + ')\n\n## 后记\n\n以上均为软件测试样例，并非子非秋月原文。';
async function request(path: string) { return fetch(origin + path, { redirect: 'manual', headers: { 'Sec-Fetch-Site': 'same-origin' } }); }
before(async () => {
  const url = new URL(process.env.DATABASE_TEST_URL!); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/zifeiqiuyue_test');
  process.env.DATABASE_URL = url.toString(); process.env.MEDIA_ROOT = 'storage/test-media';
  const { default: config } = await import('../src/payload.config'); payload = await getPayload({ config }); await seed(payload, '.local/p1-test-accounts.json');
  const actor = async (name: string) => (await currentActor(payload, (await payload.find({ collection: 'users', where: { username: { equals: name } }, depth: 0, overrideAccess: true })).docs[0]))!;
  editor = await actor('editor'); admin = await actor('admin');
  const bytes = await sharp({ create: { width: 960, height: 280, channels: 3, background: '#ded1b6' } }).png().toBuffer();
  const media = await uploadMedia(payload, editor, bytes, '合成演示：浅黄色纸面'); mediaURL = String(media.url);
  for (let i = 0; i < 14; i++) {
    const created = await createContent(payload, editor, { slug: `p3-${stamp}-${i}`, kind: 'article', title: i === 0 ? '纸页上的回声 · 合成阅读演示' : `篇章 ${i + 1} · ${'长标题'.repeat(i === 1 ? 22 : 1)}`, markdown: body + (i === 0 ? `\n\n![浅黄色纸面](media:${media.id})` : ''), metadata: { ...defaultMetadata, category: '阅读演示', originalVideoDate: '2099-12-31', legacyDate: '2199-12-31', sourceUrl: 'https://example.com/source' } });
    const sub = await submitDraft(payload, editor, Number(created.content.id), 1); const result = await decideSubmission(payload, editor, Number(sub.id), 'approved');
    samples.push({ id: Number(created.content.id), slug: String(created.content.slug), stableId: String(created.content.stableId), snapshotId: Number(result.snapshot!.id), version: String(result.snapshot!.stableId) });
  }
  oldVersion = samples[0].version;
  const old = await publicArticle(payload, samples[0].slug), chars = Array.from(old.snapshot.plainText), start = chars.indexOf('故');
  await addAnnotation(payload, editor, { snapshot: old.snapshot.id, start, end: start + 6, quote: chars.slice(start, start + 6).join(''), body: '此批注关联第一版，后续发布不会迁移位置。' });
  await saveDraft(payload, editor, samples[0].id, { revision: 1, title: '纸页上的回声 · 第二版演示', markdown: body + `\n\n![浅黄色纸面](media:${media.id})\n\n新版仍然不是作者原话。` });
  const sub = await submitDraft(payload, editor, samples[0].id, 2), approved = await decideSubmission(payload, editor, Number(sub.id), 'approved');
  samples[0].snapshotId = Number(approved.snapshot!.id); samples[0].version = String(approved.snapshot!.stableId);
  secret = `PRIVATE-P3-${stamp}`; secretSlug = `private-p3-${stamp}`;
  await createContent(payload, editor, { slug: secretSlug, title: secret, markdown: '未公开合成草稿', kind: 'article' });
  await saveDraft(payload, editor, samples[0].id, { revision: 2, title: secret, markdown: body + '\n\n' + secret });
  await submitDraft(payload, editor, samples[0].id, 3);
  await saveHome(payload, editor, { introduction: '为你讲述打动人心的故事，每个人物，都可以成为主角。', featured: samples.slice(0, 4).map(s => s.id) });
  await saveQuote(payload, editor, { stableId: `p3-quote-${stamp}`, text: '借一页文字，留一处回声。', attribution: '本站合成摘句', sourceUrl: '', demo: true, order: -100, enabled: true, content: samples[0].id, snapshot: old.snapshot.id });
  const log = fs.openSync('.local/p3-http-test.log', 'w');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3100'], { windowsHide: true, env: { ...process.env, APP_ORIGIN: origin }, stdio: ['ignore', log, log] }); fs.closeSync(log);
  let ready = false; for (let i = 0; i < 60; i++) { try { if ((await request('/api/community/session')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 250)); }
  assert.ok(ready, 'See .local/p3-http-test.log');
  fs.writeFileSync('.local/p3-browser-fixture.json', JSON.stringify({ database: 'zifeiqiuyue_test', article: samples[0], oldVersion, origin, mediaURL }, null, 2));
});
after(async () => { server?.kill(); if (payload) await payload.destroy(); });

test('reading dates use verified video date or Shanghai publication day, never legacy date', () => {
  assert.deepEqual(readingDate({}, '2026-10-21T23:30:00.000Z'), { date: '2026-10-22', label: '本站发布' });
  assert.deepEqual(readingDate({ originalVideoDate: '2020-01-02' }, '2026-10-21T23:30:00.000Z'), { date: '2020-01-02', label: '原视频' });
  for (const invalid of ['', '0', '-1', '1.5', '01', ['1'], '100000000', '1 OR 1=1']) assert.throws(() => pageNumber(invalid));
});
test('archive filters articles in SQL and paginates after stable date ordering', async () => {
  const first = await publicArchive(payload), second = await publicArchive(payload, '2');
  const ranked = [...samples].sort((a, b) => a.stableId.localeCompare(b.stableId));
  assert.equal(first.items.length, 12); assert.equal(new Set([...first.items, ...second.items].map(i => i.stableId)).size, first.items.length + second.items.length);
  // Other runs can leave same-day fixtures; compare this run's relative order across the complete public listing.
  const all = []; for (let page = 1; page <= first.pages; page++) all.push(...(await publicArchive(payload, String(page))).items);
  assert.deepEqual(all.filter(i => samples.some(s => s.stableId === i.stableId)).map(i => i.stableId), ranked.map(i => i.stableId));
  assert.ok(all.every(i => i.metadata.originalVideoDate !== '2199-12-31')); assert.ok(!JSON.stringify(all).includes(secret));
  await assert.rejects(() => publicArchive(payload, String(first.pages + 1)), { status: 404 });
});
test('public article returns frozen data only; pending draft and cross-content versions stay private', async () => {
  const current = await publicArticle(payload, samples[0].slug); assert.equal(current.snapshot.title, '纸页上的回声 · 第二版演示'); assert.ok(!JSON.stringify(current).includes(secret));
  assert.ok(!('author' in current.content)); assert.ok(!('importState' in current.content));
  await assert.rejects(() => publicArticle(payload, secretSlug), { status: 404 });
  await assert.rejects(() => publicArticle(payload, samples[0].slug, samples[1].version), { status: 404 });
  await assert.rejects(() => publicArticle(payload, samples[0].slug, ['x']), { status: 404 });
});
test('historical snapshot keeps exact text and annotation; current version remains separate', async () => {
  const old = await publicArticle(payload, samples[0].slug, oldVersion), current = await publicArticle(payload, samples[0].slug);
  assert.notEqual(old.snapshot.id, current.snapshot.id); assert.equal(old.annotations.length, 1); assert.equal(current.annotations.length, 0);
  const note = old.annotations[0]; assert.equal(Array.from(old.snapshot.plainText).slice(note.start, note.end).join(''), note.quote); assert.equal(old.versions.length, 2);
});
test('home automatically selects the latest four public articles and preserves quote snapshot links', async () => {
  const home = await readHome(payload); assert.deepEqual(home.featured.map(c => c.slug), [samples[0], ...samples.slice(1).reverse().slice(0, 3)].map(c => c.slug));
  const quote = home.quotes.find(q => q.stableId === `p3-quote-${stamp}`)!;
  assert.equal(quote.href, `/articles/${samples[0].slug}?version=${oldVersion}`); assert.ok(!JSON.stringify(home).includes(secret));
});
test('empty archive differs from database failure', async () => {
  const empty = { db: { drizzle: { execute: async () => ({ rows: [{ total: 0 }] }) } } } as unknown as Payload;
  // Count is empty, and the subsequent SELECT is also empty.
  let call = 0; (empty.db as any).drizzle.execute = async () => ({ rows: call++ ? [] : [{ total: 0 }] });
  assert.deepEqual(await publicArchive(empty), { items: [], page: 1, pages: 1, total: 0 });
  const broken = { db: { drizzle: { execute: async () => { throw new Error('database unavailable fixture'); } } } } as unknown as Payload;
  await assert.rejects(() => publicArchive(broken), /database unavailable/);
});
test('production HTML includes real article text, title, dates, canonical and safe history navigation', async () => {
  for (const [url, text] of [['/', '借一页文字'], ['/articles', '全部文章'], [`/articles/${samples[0].slug}`, '第二版演示'], [`/articles/${samples[0].slug}?version=${oldVersion}`, '正在阅读历史版本']]) {
    const response = await request(url); assert.equal(response.status, 200, url); assert.match(response.headers.get('cache-control') || '', /no-store/);
    const html = await response.text(); assert.ok(html.includes(text), url); assert.ok(!html.includes(secret));
    if (url.includes(samples[0].slug)) { assert.ok(html.includes('reader-body')); assert.ok(html.includes('canonical')); assert.ok(html.includes('2099.12.31')); }
  }
  const workspace = await request('/workspace'); assert.equal(workspace.status, 200); assert.ok((await workspace.text()).includes('发布文章'));
});
test('legacy links retain valid IDs; invalid IDs, duplicate parameters and versions return 404', async () => {
  for (const [path, target] of [['/index.html', '/'], ['/articles.html', '/articles'], [`/read.html?id=${samples[0].slug}`, `/articles/${samples[0].slug}`]]) {
    const response = await request(path); assert.equal(response.status, 308); assert.equal(new URL(response.headers.get('location')!, origin).pathname, target);
  }
  for (const path of ['/read.html', '/read.html?id=', '/read.html?id=中文', '/read.html?id=libai&id=dream', '/read.html?id=https%3A%2F%2Fevil.invalid', '/articles?page=0', '/articles?page=1&page=2', '/articles/not-found-p3', `/articles/${samples[0].slug}?version=missing`, `/articles/${samples[0].slug}?version=x&version=y`]) assert.equal((await request(path)).status, 404, path);
  assert.equal((await request('/read.html?id=libai')).status, 308); assert.equal((await request('/articles/libai')).status, 404, 'Old unpublished article must remain private');
});
test('hiding content removes every public projection, old version and media on the next request', async () => {
  await setVisibility(payload, admin, samples[0].id, 'hidden');
  try {
    const home = await readHome(payload); assert.ok(!home.featured.some(c => c.slug === samples[0].slug)); assert.ok(!home.quotes.some(q => q.stableId === `p3-quote-${stamp}`));
    await assert.rejects(() => publicArticle(payload, samples[0].slug, oldVersion), { status: 404 });
    for (const path of [`/articles/${samples[0].slug}`, `/articles/${samples[0].slug}?version=${oldVersion}`, `/api/community/public-article?slug=${samples[0].slug}`]) assert.equal((await request(path)).status, 404);
    const image = await request(new URL(mediaURL, origin).pathname); assert.ok([403, 404].includes(image.status));
    const archive = await request('/api/community/articles').then(r => r.json()); assert.ok(!archive.items.some((c: { slug: string }) => c.slug === samples[0].slug));
  } finally { await setVisibility(payload, admin, samples[0].id, 'public'); }
});
