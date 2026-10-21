import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import sharp from 'sharp';
import { getPayload, type Payload } from 'payload';
import { seed } from '../scripts/seed-community';
import { currentActor, type Actor } from '../src/modules/access';
import { articleFormat, metadata } from '../src/modules/content-format';
import { defaultMetadata } from '../src/modules/content-types';
import { addAnnotation, createContent, decideSubmission, saveDraft, setVisibility, submitDraft, uploadMedia, previewDraft } from '../src/modules/community';
import { publicHome, saveHome, saveQuote } from '../src/modules/editorial';
import { publicArticle } from '../src/modules/public-reading';
import { exportBundle, hash, importBundle, mapImages, previewImport, readBundle, readLegacy, sealBundle, writeBundle, type Bundle } from '../src/modules/content-transfer';

let payload: Payload, admin: Actor, editor: Actor, member: Actor;
const stamp = randomUUID(), root = path.resolve('.local', `p2-tests-${stamp}`);
const legacyRoot = path.join(root, 'legacy-source');
const article = '## 开头\n\n合成演示开头。\n\n## 简介\n\n这是 **合成简介**，带着 🌙。\n\n## 正文\n\n### 小标题\n\n故事有回声。故事有回声。\n\n| 列 | 值 |\n| --- | --- |\n| 月 | 明 |\n\n## 后记\n\n以上不是作者原话。';
const make = (markdown = article) => createContent(payload, editor, { slug: `p2-${randomUUID()}`, title: '合成站方文章', markdown, kind: 'article', metadata: { ...defaultMetadata, category: '合成栏目', sourceUrl: 'https://example.com/source', originalVideoDate: '2026-01-02' } });
const publish = async (markdown = article) => { const c = await make(markdown); const s = await submitDraft(payload, editor, Number(c.content.id), 1); const approved = await decideSubmission(payload, editor, Number(s.id), 'approved'); return { ...c, snapshot: approved.snapshot! }; };
const apply = async (bundle: Bundle) => importBundle(payload, admin, bundle, { expectedDigest: (await previewImport(payload, admin, bundle)).digest });
const miniBundle = (): Bundle => ({ version: 1, items: [{ stableId: `item-${randomUUID()}`, slug: `import-${randomUUID()}`, kind: 'article', work: { title: '合成导入稿', markdown: article, metadata: defaultMetadata }, snapshots: [], currentSnapshot: null, visibility: 'unpublished' }], quotes: [], home: { introduction: '合成测试简介', featured: [] }, media: [] });
before(async () => {
  const url = new URL(process.env.DATABASE_TEST_URL!); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/zifeiqiuyue_test');
  process.env.DATABASE_URL = url.toString(); process.env.MEDIA_ROOT = 'storage/test-media';
  const { default: config } = await import('../src/payload.config'); payload = await getPayload({ config });
  await seed(payload, '.local/p1-test-accounts.json'); fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, 'content/articles'), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, 'assets/images'), { recursive: true });
  fs.copyFileSync('assets/images/libai/road-to-changan.svg', path.join(legacyRoot, 'assets/images/example.svg'));
  fs.writeFileSync(path.join(legacyRoot, 'content/articles/example.md'), '---\ntitle: 合成迁移稿\npublished: "2026-01-02"\ntype: 测试\ndescription: 迁移验证\nsourceUrl: ""\ndemo: true\n---\n\n合成迁移正文。\n\n![测试图片](../../assets/images/example.svg)\n');
  fs.writeFileSync(path.join(legacyRoot, 'content/quotes.json'), JSON.stringify([{ id: `legacy-quote-${stamp}`, text: '合成迁移摘句', attribution: '测试', articleId: 'example', sourceUrl: '', demo: true }]));
  fs.writeFileSync(path.join(legacyRoot, 'content/site.json'), JSON.stringify({ featuredIds: ['example'] }));
  const actor = async (username: string) => (await currentActor(payload, (await payload.find({ collection: 'users', where: { username: { equals: username } }, overrideAccess: true, depth: 0 })).docs[0]))!;
  admin = await actor('admin'); editor = await actor('editor'); member = await actor('membera');
});
after(async () => { if (payload) await payload.destroy(); });

test('article needs body only; intro and afterword are optional separate metadata', () => {
  assert.deepEqual(articleFormat('自由正文，\n\n## 任意章节').issues, []);
  assert.equal(articleFormat('自由正文。').summary, '');
  assert.deepEqual(articleFormat('  ').issues, ['文章正文不能为空。']);
  const intro = metadata({ ...defaultMetadata, intro: '可选简介。\n第二行。', afterword: '可选后记。' });
  assert.equal(articleFormat('正文。', intro.intro).summary, '可选简介。 第二行。');
  assert.equal(intro.afterword, '可选后记。');
  assert.match(articleFormat(article).summary, /合成简介/); // legacy summary
  assert.throws(() => metadata({ ...defaultMetadata, intro: 'x'.repeat(1001) }));
  assert.throws(() => metadata({ ...defaultMetadata, afterword: 'x'.repeat(5001) }));
  assert.throws(() => metadata({ ...defaultMetadata, originalVideoDate: '2026-02-30' }));
  assert.throws(() => metadata({ ...defaultMetadata, sourceUrl: 'javascript:alert(1)' }));
});
test('image mapping preserves prose/code, supports reference images and rejects external images', () => {
  const source = '文字 media:1\n\n![月](media:1 "说明")\n\n![纸][paper]\n\n[paper]: media:2\n\n```\n![代码](media:1)\n```';
  const result = mapImages(source, src => src.replace('media:', 'asset:'));
  assert.ok(result.includes('文字 media:1')); assert.ok(result.includes('![月](asset:1 "说明")')); assert.ok(result.includes('[paper]: asset:2')); assert.ok(result.includes('![代码](media:1)'));
  const inline = mapImages('`![代码](media:1)` 和 ![月](media:1) 以及 [链接](media:1)', src => src.replace('media:', 'asset:'));
  assert.ok(inline.includes('`![代码](media:1)`')); assert.ok(inline.includes('[链接](media:1)')); assert.ok(inline.includes('![月](asset:1)'));
});
test('editorial permissions, invalid draft submission and unrestricted member posts', async () => {
  await assert.rejects(() => createContent(payload, member, { slug: `bad-${randomUUID()}`, title: '越权', markdown: article, kind: 'article' }), { status: 403 });
  const flexible = await make('自由正文，不需要固定章节。'); await submitDraft(payload, editor, Number(flexible.content.id), 1);
  const post = await createContent(payload, member, { slug: `post-${randomUUID()}`, title: '自由帖子', markdown: '不要求四段' });
  await submitDraft(payload, member, Number(post.content.id), 1);
  await assert.rejects(() => saveQuote(payload, member, {}), { status: 403 }); await assert.rejects(() => saveHome(payload, member, {}), { status: 403 });
});
test('metadata is frozen with submission; summary and preview share publication rendering', async () => {
  const c = await make(); const id = Number(c.content.id), stableId = c.content.stableId;
  const sub = await submitDraft(payload, editor, id, 1);
  await saveDraft(payload, editor, id, { revision: 1, title: '新标题', markdown: article + '\n\n新稿', metadata: { ...defaultMetadata, sourceUrl: 'https://example.com/new' } });
  const approved = await decideSubmission(payload, editor, Number(sub.id), 'approved');
  assert.equal((approved.snapshot!.metadata as Record<string, unknown>).sourceUrl, 'https://example.com/source'); assert.match(String(approved.snapshot!.summary), /合成简介/);
  assert.equal((await previewDraft(payload, editor, article)).html, approved.snapshot!.html);
  assert.equal((await payload.findByID({ collection: 'contents', id, depth: 0 })).stableId, stableId);
  assert.equal((await payload.findByID({ collection: 'contents', id, depth: 0 })).slug, c.content.slug);
  await assert.rejects(() => createContent(payload, editor, { slug: c.content.slug, title: '重复', markdown: article, kind: 'article' }));
});
test('optional introduction is frozen and afterword stays separate from annotated body', async () => {
  const text = '可以单独输入正文，无需开头或后记章节。';
  const created = await createContent(payload, editor, { slug: 'optional-' + randomUUID(), title: '可选字段测试', markdown: text, kind: 'article', metadata: { ...defaultMetadata, intro: '首页卡片可见的简介', afterword: '正文后的补充说明' } });
  const id = Number(created.content.id);
  const submitted = await submitDraft(payload, editor, id, 1);
  await saveDraft(payload, editor, id, { revision: 1, title: '未发布的新标题', markdown: text, metadata: { ...defaultMetadata, intro: '后来修改的简介', afterword: '' } });
  const published = await decideSubmission(payload, editor, Number(submitted.id), 'approved');
  assert.equal(published.snapshot!.summary, '首页卡片可见的简介');
  assert.equal((published.snapshot!.metadata as Record<string, unknown>).afterword, '正文后的补充说明');
  assert.equal(published.snapshot!.plainText, text + '\n');
  const read = await publicArticle(payload, created.content.slug);
  assert.equal(read.snapshot.metadata.intro, '首页卡片可见的简介');
  assert.equal(read.snapshot.metadata.afterword, '正文后的补充说明');
  const empty = await createContent(payload, editor, { slug: 'no-summary-' + randomUUID(), title: '无简介测试', markdown: text, kind: 'article' });
  const queued = await submitDraft(payload, editor, Number(empty.content.id), 1);
  const simple = await decideSubmission(payload, editor, Number(queued.id), 'approved');
  assert.equal(simple.snapshot!.summary, '');
});
test('new metadata and article versions preserve old snapshot annotation ranges', async () => {
  const c = await publish(); const text = String(c.snapshot.plainText), chars = Array.from(text), start = chars.indexOf('故'), end = start + 6;
  const note = await addAnnotation(payload, member, { snapshot: c.snapshot.id, start, end, quote: chars.slice(start, end).join(''), body: '测试旧版' });
  await saveDraft(payload, editor, Number(c.content.id), { revision: 1, title: '第二版', markdown: article + '\n\n新版' });
  const sub = await submitDraft(payload, editor, Number(c.content.id), 2); await setVisibility(payload, admin, Number(c.content.id), 'hidden'); await decideSubmission(payload, editor, Number(sub.id), 'approved');
  const old = await payload.findByID({ collection: 'snapshots', id: c.snapshot.id, overrideAccess: true }); assert.equal(old.plainText, text);
  assert.equal((await payload.findByID({ collection: 'annotations', id: note.id, overrideAccess: true, depth: 0 })).snapshot, c.snapshot.id);
  assert.equal((await payload.findByID({ collection: 'contents', id: c.content.id, overrideAccess: true })).visibility, 'hidden');
  await assert.rejects(() => payload.update({ collection: 'snapshots', id: c.snapshot.id, data: { metadata: defaultMetadata }, overrideAccess: true }), { status: 403 });
});
test('quotes and recommendations hide together with target, while standalone quotes remain public', async () => {
  const c = await publish(), linked = `linked-${stamp}`, standalone = `standalone-${stamp}`;
  await saveQuote(payload, editor, { stableId: linked, text: '引用合成文章', attribution: '测试整理', sourceUrl: '', demo: true, order: 1, enabled: true, content: c.content.id, snapshot: c.snapshot.id });
  await saveQuote(payload, editor, { stableId: standalone, text: '独立合成摘句', attribution: '本站摘句', sourceUrl: '', demo: true, order: 2, enabled: true });
  await saveHome(payload, editor, { introduction: '首页合成简介', featured: [c.content.id] });
  assert.ok((await publicHome(payload)).quotes.some(q => q.stableId === linked));
  await setVisibility(payload, admin, Number(c.content.id), 'hidden');
  const home = await publicHome(payload); assert.ok(!home.featured.some(item => item.stableId === c.content.stableId)); assert.ok(!home.quotes.some(q => q.stableId === linked)); assert.ok(home.quotes.some(q => q.stableId === standalone));
  await assert.rejects(() => saveHome(payload, editor, { introduction: '越权推荐', featured: [c.content.id] }), { status: 400 });
  await assert.rejects(() => saveQuote(payload, editor, { stableId: linked, text: '不公开', attribution: '测试', sourceUrl: '', demo: true, order: 1, enabled: true, content: c.content.id, snapshot: c.snapshot.id }), { status: 400 });
});
test('homepage recommendations reject public posts and post references in imported bundles', async () => {
  const post = await createContent(payload, member, { slug: `featured-post-${randomUUID()}`, title: '合成社区帖子', markdown: '自由帖子正文', kind: 'post' });
  const submission = await submitDraft(payload, member, Number(post.content.id), 1);
  await decideSubmission(payload, admin, Number(submission.id), 'approved');
  const before = await publicHome(payload);
  await assert.rejects(() => saveHome(payload, editor, { introduction: '不能推荐帖子', featured: [post.content.id] }), { status: 400 });
  assert.deepEqual(await publicHome(payload), before);
  const bundle = miniBundle(); bundle.items[0].kind = 'post'; bundle.home.featured = [bundle.items[0].stableId];
  await assert.rejects(() => previewImport(payload, admin, bundle), /首页推荐只能引用包中的站方文章/);
});

test('post quote links use the formal route and preserve the quoted historical version', async () => {
  const post = await createContent(payload, member, { slug: `quoted-post-${randomUUID()}`, title: '帖子第一版', markdown: '引用第一版正文', kind: 'post' });
  const submission = await submitDraft(payload, member, Number(post.content.id), 1);
  const approved = await decideSubmission(payload, admin, Number(submission.id), 'approved');
  const stableId = `post-quote-${randomUUID()}`;
  await saveQuote(payload, editor, { stableId, text: '引用第一版正文', attribution: '合成摘句', sourceUrl: '', demo: true, order: -200, enabled: true, content: post.content.id, snapshot: approved.snapshot!.id });
  await saveDraft(payload, member, Number(post.content.id), { revision: 1, title: '帖子第二版', markdown: '第二版正文' });
  const next = await submitDraft(payload, member, Number(post.content.id), 2);
  await decideSubmission(payload, admin, Number(next.id), 'approved');
  const quote = (await publicHome(payload)).quotes.find(q => q.stableId === stableId)!;
  assert.equal(quote.href, `/posts/${post.content.slug}?version=${approved.snapshot!.stableId}`);
  const version = await publicArticle(payload, String(post.content.slug), String(approved.snapshot!.stableId), 'post');
  assert.equal(version.snapshot.title, '帖子第一版');
});

test('legacy preview and local package preserve synthetic content and do not write records or files', async () => {
  const before = { contents: (await payload.count({ collection: 'contents' })).totalDocs, files: fs.readdirSync('storage/test-media') };
  const bundle = await readLegacy(legacyRoot); assert.equal(bundle.items.length, 1); assert.equal(bundle.quotes.length, 1); assert.equal(bundle.media.length, 1);
  assert.equal((await sharp(bundle.media[0].bytes).metadata()).format, 'webp');
  const p = await previewImport(payload, admin, bundle); assert.equal(p.rows.filter(r => r.type === 'content' && r.warnings.length).length, 0);
  writeBundle(bundle, path.join(root, 'legacy')); const loaded = readBundle(path.join(root, 'legacy'));
  for (let i = 0; i < bundle.items.length; i++) assert.equal(loaded.items[i].work.markdown, bundle.items[i].work.markdown);
  assert.deepEqual(loaded.quotes.map(q => q.text), bundle.quotes.map(q => q.text));
  assert.equal((await payload.count({ collection: 'contents' })).totalDocs, before.contents); assert.deepEqual(fs.readdirSync('storage/test-media'), before.files);
  await assert.rejects(() => previewImport(payload, member, bundle), { status: 403 });
});
test('package rejects tampered files, traversal and incomplete media references', async () => {
  const bundle = miniBundle(); const directory = path.join(root, 'tamper'); writeBundle(bundle, directory);
  fs.appendFileSync(path.join(directory, `articles/${bundle.items[0].slug}.md`), '篡改'); assert.throws(() => readBundle(directory), /哈希/);
  sealBundle(directory); assert.ok(readBundle(directory).items[0].work.markdown.endsWith('篡改'));
  const missing = miniBundle(); missing.items[0].work.markdown += '\n\n![不存在](asset:missing)'; await assert.rejects(() => previewImport(payload, admin, missing), /缺少图片/);
  const second = path.join(root, 'traversal'); writeBundle(miniBundle(), second);
  const manifest = JSON.parse(fs.readFileSync(path.join(second, 'manifest.json'), 'utf8')); manifest.home = '../../package.json'; fs.writeFileSync(path.join(second, 'manifest.json'), JSON.stringify(manifest)); assert.throws(() => readBundle(second), /越界/);
});

// Each import test uses its own source identity; home is rebased explicitly for this test suite only.
async function rebaseHome() {
  const { writeContext } = await import('../src/modules/access');
  const home = (await payload.find({ collection: 'home', depth: 0, overrideAccess: true })).docs[0];
  if (home) await payload.delete({ collection: 'home', id: home.id, context: writeContext(), overrideAccess: true });
}
test('idempotent imports, source updates and online edits are distinguished', async () => {
  await rebaseHome(); const bundle = miniBundle(); const first = await apply(bundle); assert.equal(first.imported, 2);
  const repeat = await apply(bundle); assert.equal(repeat.imported, 0);
  bundle.items[0].work.title = '源文件更新'; assert.equal((await previewImport(payload, admin, bundle)).rows[0].status, 'update'); await apply(bundle);
  const c = (await payload.find({ collection: 'contents', where: { stableId: { equals: bundle.items[0].stableId } }, depth: 0 })).docs[0];
  const d = (await payload.find({ collection: 'drafts', where: { content: { equals: c.id } }, depth: 0, overrideAccess: true })).docs[0];
  await saveDraft(payload, admin, Number(c.id), { revision: d.revision, title: '网页修改', markdown: article });
  const preview = await previewImport(payload, admin, bundle); assert.equal(preview.rows[0].status, 'conflict'); await assert.rejects(() => importBundle(payload, admin, bundle, { expectedDigest: preview.digest }), { status: 409 });
  assert.equal((await payload.findByID({ collection: 'drafts', id: d.id, overrideAccess: true })).title, '网页修改');
});
test('stale preview and slug collisions cannot overwrite data', async () => {
  await rebaseHome(); const bundle = miniBundle(); const preview = await previewImport(payload, admin, bundle);
  bundle.items[0].work.title = '预览后变化'; await assert.rejects(() => importBundle(payload, admin, bundle, { expectedDigest: preview.digest }), { status: 409 });
  await createContent(payload, member, { slug: bundle.items[0].slug, title: '已有帖子', markdown: '保留' });
  assert.equal((await previewImport(payload, admin, bundle)).rows[0].status, 'conflict');
});
test('failed import rolls back database and removes only its own media files', async () => {
  await rebaseHome(); const bundle = miniBundle();
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#f4eedf' } }).webp().toBuffer();
  bundle.media.push({ stableId: `asset-${randomUUID()}`, alt: '合成图片', hash: hash(bytes), bytes }); bundle.items[0].work.markdown += `\n\n![合成图片](asset:${bundle.media[0].stableId})`;
  const before = fs.readdirSync('storage/test-media').sort(), count = (await payload.count({ collection: 'media' })).totalDocs;
  const hooks = payload.collections.drafts.config.hooks.afterChange, failure = () => { throw new Error('P2 rollback fixture'); }; hooks.push(failure);
  try { await assert.rejects(() => apply(bundle), /rollback fixture/); } finally { hooks.splice(hooks.indexOf(failure), 1); }
  assert.deepEqual(fs.readdirSync('storage/test-media').sort(), before); assert.equal((await payload.count({ collection: 'media' })).totalDocs, count);
  assert.equal((await payload.count({ collection: 'contents', where: { stableId: { equals: bundle.items[0].stableId } } })).totalDocs, 0);
});
test('legacy import stays unpublished, repeats cleanly, and retains original dates as unverified metadata', async () => {
  await rebaseHome();
  const bundle = await readLegacy(legacyRoot);
  // Re-running the suite may find already imported legacy records; unchanged records are intentional.
  await apply(bundle); await apply(bundle);
  for (const item of bundle.items) {
    const c = (await payload.find({ collection: 'contents', where: { stableId: { equals: item.stableId } }, overrideAccess: true, depth: 0 })).docs[0];
    assert.equal(c.visibility, 'unpublished'); assert.equal(c.currentSnapshot, null);
    const d = (await payload.find({ collection: 'drafts', where: { content: { equals: c.id } }, overrideAccess: true, depth: 0 })).docs[0];
    assert.equal((d.metadata as Record<string, unknown>).originalVideoDate, ''); assert.equal((d.metadata as Record<string, unknown>).legacyDate, item.work.metadata.legacyDate);
  }
});
test('exported versions, quote links, media and exact Markdown survive local package serialization', async () => {
  const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#e0d3ba' } }).png().toBuffer(); const media = await uploadMedia(payload, editor, bytes, '纸面测试');
  const c = await publish(article + `\n\n![纸面](media:${media.id})`);
  const qid = `roundtrip-${stamp}`; await saveQuote(payload, editor, { stableId: qid, text: '合成摘句\n', attribution: '本站测试', sourceUrl: '', demo: true, order: 4, enabled: true, content: c.content.id, snapshot: c.snapshot.id });
  await saveHome(payload, editor, { introduction: '往返测试', featured: [c.content.id] });
  const bundle = await exportBundle(payload, admin, { includeDrafts: true }); const directory = path.join(root, 'export'); writeBundle(bundle, directory); const loaded = readBundle(directory);
  const original = bundle.items.find(i => i.stableId === c.content.stableId)!, restored = loaded.items.find(i => i.stableId === c.content.stableId)!;
  assert.equal(restored.work.markdown, original.work.markdown); assert.equal(restored.snapshots[0].plainText, original.snapshots[0].plainText); assert.equal(restored.currentSnapshot, original.currentSnapshot);
  assert.equal(loaded.quotes.find(q => q.stableId === qid)!.text, '合成摘句\n');
  assert.deepEqual(loaded.media.map(m => m.hash), bundle.media.map(m => m.hash));
  const publicOnly = await exportBundle(payload, admin); assert.ok(publicOnly.items.every(i => i.visibility === 'public'));
  fs.writeFileSync('.local/p2-roundtrip-source.txt', directory);
});
