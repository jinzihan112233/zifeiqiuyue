import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import sharp from 'sharp';
import { APIError, type Payload, type PayloadRequest } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { type Actor } from './access';
import { transaction, requiredText } from './community';
import { requireEditor } from './editorial';
import { articleFormat, metadata, webURL, type Metadata } from './content-format';
import { renderMarkdown, rendererVersion } from './markdown';

type Doc = Record<string, any>;
type Body = { title: string; markdown: string; metadata: Metadata };
type Version = Body & { stableId: string; publishedAt: string; plainText: string; rendererVersion: string; summary: string };
type Item = { stableId: string; slug: string; kind: 'article' | 'post'; work: Body; snapshots: Version[]; currentSnapshot: string | null; visibility: string; legacy?: { description: string } };
type Quote = { stableId: string; text: string; attribution: string; sourceUrl: string; demo: boolean; order: number; enabled: boolean; content: string | null; snapshot: string | null };
type Asset = { stableId: string; alt: string; hash: string; bytes: Buffer; original?: { path: string; hash: string } };
export type Bundle = { version: 1; items: Item[]; quotes: Quote[]; home: { introduction: string; featured: string[] }; media: Asset[] };
export type ReportRow = { type: 'content' | 'quote' | 'home'; key: string; status: 'new' | 'unchanged' | 'update' | 'conflict'; warnings: string[] };
export const hash = (value: unknown): string => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const fail = (message: string): never => { throw new APIError(message, 400); };
const stable = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) return fail('稳定标识无效。');
  return value;
};
const md = new MarkdownIt({ html: false });

// Only destinations are rewritten; prose and fenced code remain byte-for-byte intact.
export function mapImages(markdown: string, resolve: (src: string, alt: string) => string): string {
  const env: { references?: Record<string, { href: string; title: string; map: [number, number] }> } = {};
  const tokens = md.parse(markdown, env);
  const lines = markdown.split('\n');
  const replacements = new Map<string, string>();
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    const images = (token.children || []).filter(child => child.type === 'image');
    if (!images.length) continue;
    for (const image of images) {
      if (!image.content.trim()) fail('图片必须填写替代文字。');
      const src = String(image.attrGet('src'));
      replacements.set(src, resolve(src, image.content));
    }
    if (token.map) ranges.push(token.map);
  }
  const codeLines = new Set<number>();
  for (const token of tokens) if (['fence', 'code_block'].includes(token.type) && token.map) for (let i = token.map[0]; i < token.map[1]; i++) codeLines.add(i);
  for (let i = 0; i < lines.length; i++) if (!codeLines.has(i) && /^\s{0,3}\[[^\]]+\]:/.test(lines[i])) ranges.push([i, i + 1]);
  // shortcut: migration accepts inline and single-line reference images; extend this parser for other destination syntax.
  for (const [start, end] of ranges) {
    const block = lines.slice(start, end).join('\n');
    const rewritten = block.replace(/(`+)[\s\S]*?\1(?!`)|((?<!\\)!\[[^\n]*?\]\(\s*<?|^\s{0,3}\[[^\]]+\]:\s*<?)([^\s>]+?)(?=>?\s*(?:["']|\)|$))/gm, (full, code, prefix, src) => {
      const next = replacements.get(src);
      return !code && next ? `${prefix}${next}` : full;
    });
    lines.splice(start, end - start, ...rewritten.split('\n'));
  }
  const result = lines.join('\n');
  const remaining = md.parse(result, {}).flatMap(t => t.children || []).filter(t => t.type === 'image');
  for (const image of remaining) if (![...replacements.values()].includes(String(image.attrGet('src')))) fail('图片语法无法安全转换，请使用 ![说明](相对路径) 或标准引用式图片。');
  return result;
}
function inside(root: string, relative: string) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')) fail('内容包路径必须是相对路径。');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) fail('内容包路径越界。');
  const real = fs.realpathSync(resolved), realRoot = fs.realpathSync(root);
  if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) fail('内容包路径或符号链接越界。');
  return real;
}
export async function readLegacy(root: string): Promise<Bundle> {
  const media: Asset[] = [];
  const items: Item[] = [];
  for (const filename of fs.readdirSync(path.join(root, 'content/articles')).filter(f => f.endsWith('.md')).sort()) {
    const source = fs.readFileSync(inside(root, `content/articles/${filename}`), 'utf8').replace(/^\uFEFF/, '');
    const parsed = matter(source), slug = stable(filename.slice(0, -3));
    const markdown = mapImages(parsed.content, (src, alt) => {
      if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(src)) fail(`${filename}: 不自动抓取远程图片：${src}`);
      const absolute = path.resolve(root, 'content/articles', decodeURIComponent(src));
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (!relative.startsWith('assets/images/')) fail('旧图片须在 assets/images 内。');
      const original = fs.readFileSync(inside(root, relative));
      const stableId = `legacy-${hash(original).slice(0, 24)}`;
      if (!media.some(m => m.stableId === stableId)) media.push({ stableId, alt, bytes: original, hash: hash(original), original: { path: relative, hash: hash(original) } });
      return `asset:${stableId}`;
    });
    items.push({ stableId: `legacy-${slug}`, slug, kind: 'article', work: { title: requiredText(parsed.data.title, 200), markdown, metadata: metadata({ category: parsed.data.type, demo: parsed.data.demo, sourceUrl: parsed.data.sourceUrl, legacyDate: parsed.data.published }) }, snapshots: [], currentSnapshot: null, visibility: 'unpublished', legacy: { description: String(parsed.data.description || '') } });
  }
  // This trusted repository asset is rasterized here; user uploads never accept SVG.
  for (const asset of media) {
    const oldId = asset.stableId;
    asset.bytes = await sharp(asset.bytes, { limitInputPixels: 8192 * 8192 }).rotate().webp({ lossless: true }).toBuffer(); asset.hash = hash(asset.bytes);
    asset.stableId = `asset-${asset.hash.slice(0, 24)}`;
    for (const item of items) item.work.markdown = mapImages(item.work.markdown, src => src === `asset:${oldId}` ? `asset:${asset.stableId}` : src);
  }
  const quotes: Quote[] = JSON.parse(fs.readFileSync(inside(root, 'content/quotes.json'), 'utf8')).map((q: Doc, order: number) => ({ stableId: q.id, text: q.text, attribution: q.attribution, sourceUrl: q.sourceUrl, demo: q.demo, order, enabled: true, content: q.articleId ? `legacy-${q.articleId}` : null, snapshot: null }));
  const site = JSON.parse(fs.readFileSync(inside(root, 'content/site.json'), 'utf8'));
  return validateBundle({ version: 1, items, quotes, media, home: { introduction: '为你讲述打动人心的故事，每个人物，都可以成为主角。', featured: site.featuredIds.map((id: string) => `legacy-${id}`) } });
}
function validateBundle(bundle: Bundle): Bundle {
  if (bundle.version !== 1 || !Array.isArray(bundle.items) || !Array.isArray(bundle.quotes) || !Array.isArray(bundle.media) || !bundle.home || !Array.isArray(bundle.home.featured)) fail('内容包格式无效。');
  const unique = (values: string[]) => { if (new Set(values).size !== values.length) fail('内容包有重复标识。'); };
  unique(bundle.items.map(i => stable(i.stableId))); unique(bundle.items.map(i => stable(i.slug))); unique(bundle.quotes.map(q => stable(q.stableId))); unique(bundle.media.map(m => stable(m.stableId)));
  unique(bundle.items.flatMap(i => i.snapshots.map(s => stable(s.stableId))));
  const body = (b: Body) => {
    requiredText(b.title, 200); requiredText(b.markdown); b.metadata = metadata(b.metadata);
    mapImages(b.markdown, src => /^asset:[a-zA-Z0-9_-]+$/.test(src) && bundle.media.some(m => `asset:${m.stableId}` === src) ? src : fail(`缺少图片或图片引用无效：${src}`));
  };
  for (const item of bundle.items) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || item.slug.length > 80 || !['article', 'post'].includes(item.kind) || !['unpublished', 'public', 'hidden'].includes(item.visibility)) fail('内容类型、slug 或状态无效。');
    body(item.work);
    for (const snapshot of item.snapshots) {
      body(snapshot);
      if (!Number.isFinite(Date.parse(snapshot.publishedAt)) || snapshot.rendererVersion !== rendererVersion) fail('快照日期或渲染版本不支持；禁止猜测旧版本定位。');
      if (item.kind === 'article' && articleFormat(snapshot.markdown, snapshot.metadata.intro).issues.length) fail('已发布的站方文章缺少正文。');
      const rendered = renderMarkdown(mapImages(snapshot.markdown, src => `media:${bundle.media.findIndex(m => `asset:${m.stableId}` === src) + 1}`), new Map(bundle.media.map((m, i) => [i + 1, `/asset/${m.stableId}`])));
      if (rendered.plainText !== snapshot.plainText) fail('快照规范文本不一致。');
    }
    if (item.currentSnapshot && !item.snapshots.some(s => s.stableId === item.currentSnapshot) || item.visibility !== 'unpublished' && !item.currentSnapshot) fail('当前发布版本无效。');
  }
  for (const q of bundle.quotes) {
    requiredText(q.text, 5000); requiredText(q.attribution, 200); webURL(q.sourceUrl);
    if (typeof q.demo !== 'boolean' || typeof q.enabled !== 'boolean' || !Number.isSafeInteger(q.order)) fail('金句排序或标识无效。');
    if (q.content && !bundle.items.some(i => i.stableId === q.content)) fail('金句关联内容不存在。');
    if (q.snapshot && !bundle.items.find(i => i.stableId === q.content)?.snapshots.some(s => s.stableId === q.snapshot)) fail('金句发布版本不匹配。');
    if (q.content && !q.snapshot && !q.content.startsWith('legacy-')) fail('关联金句缺少发布版本。');
  }
  requiredText(bundle.home.introduction, 1000); unique(bundle.home.featured);
  if (bundle.home.featured.length > 20 || bundle.home.featured.some(id => !bundle.items.some(i => i.stableId === id && i.kind === 'article'))) fail('首页推荐只能引用包中的站方文章，且不超过 20 项。');
  for (const asset of bundle.media) if (!Buffer.isBuffer(asset.bytes) || asset.bytes.length > 5 * 1024 * 1024 || hash(asset.bytes) !== asset.hash) fail('媒体哈希或体积无效。');
  for (const asset of bundle.media) requiredText(asset.alt, 300);
  return bundle;
}

export function writeBundle(bundle: Bundle, directory: string) {
  validateBundle(bundle);
  if (fs.existsSync(directory)) fail('导出目录已存在，请使用新目录，避免覆盖文件。');
  fs.mkdirSync(directory, { recursive: true });
  const manifest: Doc = { version: 1, items: [], quotes: [], media: [], home: 'site.json', files: {} };
  const write = (file: string, bytes: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.writeFileSync(path.join(directory, file), bytes); manifest.files[file] = hash(Buffer.from(bytes)); };
  const bodyFile = (file: string, body: Body, header: Doc) => {
    const markdown = mapImages(body.markdown, src => `${'../'.repeat(file.split('/').length - 1)}media/${src.slice(6)}.webp`);
    write(file, matter.stringify(markdown, { ...header, title: body.title, metadata: body.metadata, trailingNewline: markdown.endsWith('\n') }));
  };
  for (const item of bundle.items) {
    const file = `${item.kind === 'article' ? 'articles' : 'posts'}/${item.slug}.md`;
    bodyFile(file, item.work, { id: item.stableId, slug: item.slug, kind: item.kind });
    const snapshots = item.snapshots.map(s => {
      const versionFile = `versions/${item.stableId}/${s.stableId}.md`;
      const { title, markdown, metadata: meta, ...details } = s;
      bodyFile(versionFile, s, { ...details, metadata: meta });
      return versionFile;
    });
    manifest.items.push({ stableId: item.stableId, slug: item.slug, kind: item.kind, file, snapshots, currentSnapshot: item.currentSnapshot, visibility: item.visibility, ...(item.legacy ? { legacy: item.legacy } : {}) });
  }
  for (const q of bundle.quotes) {
    const { text, ...data } = q; const file = `quotes/${q.stableId}.md`;
    write(file, matter.stringify(text, { ...data, trailingNewline: text.endsWith('\n') })); manifest.quotes.push(file);
  }
  for (const m of bundle.media) {
    const file = `media/${m.stableId}.webp`; write(file, m.bytes);
    manifest.media.push({ stableId: m.stableId, alt: m.alt, hash: m.hash, file, ...(m.original ? { original: m.original } : {}) });
  }
  write('site.json', JSON.stringify(bundle.home, null, 2));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
export function readBundle(directory: string): Bundle {
  const manifest = JSON.parse(fs.readFileSync(inside(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.files) fail('未知内容包版本。');
  const read = (file: string) => {
    const bytes = fs.readFileSync(inside(directory, file));
    if (hash(bytes) !== manifest.files[file]) fail(`文件哈希不一致：${file}`);
    return bytes;
  };
  const media: Asset[] = manifest.media.map((m: Doc) => ({ ...m, bytes: read(m.file) }));
  const body = (file: string): Doc => {
    const parsed = matter(read(file).toString('utf8'));
    const markdown = mapImages(parsed.data.trailingNewline === false ? parsed.content.replace(/\n$/, '') : parsed.content, src => {
      const absolute = inside(directory, path.relative(directory, path.resolve(directory, path.dirname(file), decodeURIComponent(src))).split(path.sep).join('/'));
      const asset = manifest.media.find((m: Doc) => path.resolve(directory, m.file) === absolute);
      return asset ? `asset:${asset.stableId}` : fail('图片未包含在媒体清单。');
    });
    return { ...parsed.data, title: parsed.data.title, metadata: parsed.data.metadata, markdown };
  };
  return validateBundle({ version: 1, items: manifest.items.map((i: Doc) => {
    const work = body(i.file);
    if (work.id !== i.stableId || work.slug !== i.slug || work.kind !== i.kind) fail('文章文件头标识与清单不一致。');
    return { ...i, work, snapshots: i.snapshots.map((f: string) => body(f)) };
  }), quotes: manifest.quotes.map((f: string) => { const parsed = matter(read(f).toString('utf8')); return { ...parsed.data, text: parsed.data.trailingNewline === false ? parsed.content.replace(/\n$/, '') : parsed.content }; }), media, home: JSON.parse(read(manifest.home).toString('utf8')) } as Bundle);
}

export function sealBundle(directory: string) {
  const file = inside(directory, 'manifest.json'), original = fs.readFileSync(file, 'utf8'), manifest = JSON.parse(original);
  if (manifest.version !== 1 || !manifest.files) fail('未知内容包版本。');
  for (const name of Object.keys(manifest.files)) manifest.files[name] = hash(fs.readFileSync(inside(directory, name)));
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  try { readBundle(directory); } catch (error) { fs.writeFileSync(file, original); throw error; }
}

async function all(payload: Payload, collection: string, req?: PayloadRequest): Promise<Doc[]> {
  const docs: Doc[] = []; let page = 1, more = true;
  while (more) { const result = await payload.find({ collection, depth: 0, overrideAccess: true, limit: 200, page, sort: 'id', req }); docs.push(...result.docs); more = result.hasNextPage; page++; }
  return docs;
}
async function state(payload: Payload, req?: PayloadRequest) {
  const [contents, drafts, snapshots, quotes, homes, media] = req ? await (async () => {
    const results = []; for (const c of ['contents', 'drafts', 'snapshots', 'quotes', 'home', 'media']) results.push(await all(payload, c, req)); return results;
  })() : await Promise.all(['contents', 'drafts', 'snapshots', 'quotes', 'home', 'media'].map(c => all(payload, c, req)));
  return { contents, drafts, snapshots, quotes, homes, media };
}
const contentHash = (content: Doc, draft: Doc) => hash({ slug: content.slug, kind: content.kind, visibility: content.visibility, currentSnapshot: content.currentSnapshot || null, title: draft.title, markdown: draft.markdown, metadata: draft.metadata, revision: draft.revision });
const quoteData = (q: Doc) => ({ stableId: q.stableId, text: q.text, attribution: q.attribution, sourceUrl: q.sourceUrl || '', demo: q.demo, order: q.order, enabled: q.enabled, content: q.content || null, snapshot: q.snapshot || null });
const homeData = (h: Doc) => ({ introduction: h.introduction, featured: h.featured || [] });
const sourceHash = (item: unknown, bundle: Bundle) => hash({ item, media: bundle.media.map(m => [m.stableId, m.hash]) });
function classification(existing: Doc | undefined, source: string, current: string | undefined): ReportRow['status'] {
  if (!existing) return 'new';
  if (!existing.importState || existing.importState.dbHash !== current) return 'conflict';
  return existing.importState.sourceHash === source ? 'unchanged' : 'update';
}
async function report(payload: Payload, bundle: Bundle, req?: PayloadRequest) {
  const db = await state(payload, req), rows: ReportRow[] = [];
  for (const item of bundle.items) {
    const existing = db.contents.find(c => c.stableId === item.stableId);
    if (existing?.visibility === 'purged') throw new APIError('已清除的内容不能重新导入。', 409);
    const draft = db.drafts.find(d => d.content === existing?.id);
    const collision = db.contents.some(c => c.slug === item.slug && c.stableId !== item.stableId);
    rows.push({ type: 'content', key: item.stableId, status: collision ? 'conflict' : classification(existing, sourceHash(item, bundle), existing && draft ? contentHash(existing, draft) : undefined), warnings: item.kind === 'article' ? articleFormat(item.work.markdown).issues : [] });
  }
  for (const q of bundle.quotes) {
    const existing = db.quotes.find(v => v.stableId === q.stableId);
    rows.push({ type: 'quote', key: q.stableId, status: classification(existing, sourceHash(q, bundle), existing && hash(quoteData(existing))), warnings: q.content && !q.snapshot ? ['旧关联金句缺少发布版本，保持禁用直到编辑指定版本。'] : [] });
  }
  const home = db.homes.find(h => h.key === 'home');
  rows.push({ type: 'home', key: 'home', status: classification(home, sourceHash(bundle.home, bundle), home && hash(homeData(home))), warnings: [] });
  return { rows, db };
}
export async function previewImport(payload: Payload, user: Actor, bundle: Bundle) {
  await requireEditor(payload, user); validateBundle(bundle);
  for (const asset of bundle.media) {
    const info = await sharp(asset.bytes, { limitInputPixels: 8192 * 8192 }).metadata();
    if (info.format !== 'webp' || !info.width || !info.height || info.width > 8192 || info.height > 8192) fail('内容包图片必须是尺寸受限的有效 WebP。');
    await sharp(asset.bytes).raw().toBuffer();
  }
  const { rows, db } = await report(payload, bundle);
  for (const asset of bundle.media) {
    const existing = db.media.find(m => m.stableId === asset.stableId);
    if (existing && (existing.bodyHash !== asset.hash || hash(fs.readFileSync(inside(path.resolve(process.env.MEDIA_ROOT || 'storage/media'), existing.filename))) !== asset.hash)) throw new APIError('既有媒体的内容或文件哈希冲突。', 409);
  }
  const digest = hash({ bundle: { ...bundle, media: bundle.media.map(({ bytes, ...m }) => m) }, rows });
  return { digest, rows, counts: Object.fromEntries(['new', 'unchanged', 'update', 'conflict'].map(s => [s, rows.filter(r => r.status === s).length])) };
}
export async function importBundle(payload: Payload, user: Actor, bundle: Bundle, options: { expectedDigest: string; restorePublication?: boolean }) {
  validateBundle(bundle);
  const files: string[] = [], mediaRoot = path.resolve(process.env.MEDIA_ROOT || 'storage/media');
  try {
    return await transaction(payload, user, 0, async (req, actor) => {
      await requireEditor(payload, actor, req);
      if (actor.role === 'editor' && bundle.items.some(i => i.kind !== 'article')) throw new APIError('编辑仅能导入站方文章，社区帖子归档需要管理员。', 403);
      if (options.restorePublication && actor.role !== 'admin') throw new APIError('仅管理员可恢复归档发布状态。', 403);
      const dbBefore = await state(payload, req);
      const sessions = payload.db.sessions as Record<string, { db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> } }>;
      for (const c of dbBefore.contents.filter(c => bundle.items.some(i => i.stableId === c.stableId)).sort((a, b) => a.id - b.id)) await sessions[String(await req.transactionID)].db.execute(sql`SELECT pg_advisory_xact_lock(97123, ${Number(c.id)})`);
      const { rows, db } = await report(payload, bundle, req);
      const digest = hash({ bundle: { ...bundle, media: bundle.media.map(({ bytes, ...m }) => m) }, rows });
      if (digest !== options.expectedDigest) throw new APIError('预览后数据已变化，请重新预览。', 409);
      if (rows.some(r => r.status === 'conflict')) throw new APIError('存在导入冲突，整批未写入。', 409);
      if (rows.every(r => r.status === 'unchanged')) return { rows, imported: 0 };
      const mediaMap = new Map<string, Doc>();
      for (const asset of bundle.media) {
        let doc = db.media.find(m => m.stableId === asset.stableId);
        if (doc && doc.bodyHash !== asset.hash) throw new APIError('稳定媒体标识发生内容冲突。', 409);
        if (doc && hash(fs.readFileSync(inside(mediaRoot, doc.filename))) !== asset.hash) throw new APIError('既有媒体文件哈希冲突。', 409);
        if (doc && Number(doc.owner) !== actor.id) throw new APIError('导入不能新绑定他人媒体；请使用自己拥有的新媒体记录。', 403);
        if (!doc) {
          const info = await sharp(asset.bytes, { limitInputPixels: 8192 * 8192 }).metadata();
          if (info.format !== 'webp' || !info.width || !info.height || info.width > 8192 || info.height > 8192) fail('内容包图片必须是尺寸受限的有效 WebP。');
          await sharp(asset.bytes).raw().toBuffer();
          const filename = `${crypto.randomUUID()}.webp`; files.push(filename);
          doc = await payload.create({ collection: 'media', req, overrideAccess: true, depth: 0, data: { stableId: asset.stableId, alt: requiredText(asset.alt, 300), bodyHash: asset.hash, origin: asset.original || null, owner: actor.id }, file: { data: asset.bytes, name: filename, mimetype: 'image/webp', size: asset.bytes.length } });
          // Payload transcodes even existing WebP. Restore verified archive bytes before commit, preserving file hashes.
          fs.writeFileSync(path.join(mediaRoot, String(doc.filename)), asset.bytes);
          delete req.file;
          doc = await payload.update({ collection: 'media', id: doc.id, req, overrideAccess: true, depth: 0, data: { filesize: asset.bytes.length } });
        }
        mediaMap.set(asset.stableId, doc!);
      }
      const body = (b: Body) => {
        const ids = new Set<number>();
        const markdown = mapImages(b.markdown, src => { const m = mediaMap.get(src.slice(6))!; ids.add(Number(m.id)); return `media:${m.id}`; });
        return { title: b.title, markdown, metadata: metadata(b.metadata), mediaIds: [...ids], mediaRefs: [...ids] };
      };
      const contentMap = new Map<string, Doc>(db.contents.map(c => [c.stableId, c]));
      const snapshotMap = new Map<string, Doc>(db.snapshots.map(s => [s.stableId, s]));
      let imported = 0;
      for (const item of bundle.items) {
        const row = rows.find(r => r.type === 'content' && r.key === item.stableId)!;
        if (row.status === 'unchanged') continue;
        let c = contentMap.get(item.stableId);
        if (c && actor.role !== 'admin' && Number(c.author) !== actor.id) throw new APIError('只能迁移自己维护的内容。', 403);
        if (c && (c.kind !== item.kind || c.slug !== item.slug)) throw new APIError('导入不能更改既有类型或 slug。', 409);
        const isNew = !c;
        if (!c) c = await payload.create({ collection: 'contents', req, overrideAccess: true, depth: 0, data: { stableId: item.stableId, slug: item.slug, kind: item.kind, author: actor.id, visibility: 'unpublished' } });
        const oldDraft = db.drafts.find(d => d.content === c!.id);
        const draftData = { ...body(item.work), content: c!.id, author: c!.author, revision: oldDraft ? Number(oldDraft.revision) + 1 : 1 };
        const draft = oldDraft ? await payload.update({ collection: 'drafts', id: oldDraft.id, req, overrideAccess: true, depth: 0, data: draftData }) : await payload.create({ collection: 'drafts', req, overrideAccess: true, depth: 0, data: draftData });
        if (isNew) for (const version of item.snapshots) {
          if (snapshotMap.has(version.stableId)) throw new APIError('发布版本标识已属于其他内容。', 409);
          const b = body(version);
          const media = new Map([...mediaMap.values()].map(m => [Number(m.id), `/api/media/file/${encodeURIComponent(m.filename)}`]));
          const rendered = renderMarkdown(b.markdown, media);
          if (rendered.plainText !== version.plainText) fail('快照导入后规范文本发生变化。');
          const submission = await payload.create({ collection: 'submissions', req, overrideAccess: true, depth: 0, data: { ...b, content: c!.id, author: actor.id, revision: 1, status: 'approved', reviewer: actor.id, reviewedAt: new Date().toISOString(), reason: '内容归档导入' } });
          const snapshot = await payload.create({ collection: 'snapshots', req, overrideAccess: true, depth: 0, data: { ...b, ...rendered, content: c!.id, submission: submission.id, stableId: version.stableId, publishedAt: version.publishedAt, summary: item.kind === 'article' ? articleFormat(b.markdown, b.metadata.intro).summary : '' } });
          snapshotMap.set(version.stableId, snapshot);
        }
        const pointer = isNew && item.currentSnapshot ? snapshotMap.get(item.currentSnapshot)!.id : c!.currentSnapshot;
        const visibility = isNew && options.restorePublication ? item.visibility : c!.visibility;
        c = await payload.update({ collection: 'contents', id: c!.id, req, overrideAccess: true, depth: 0, data: { currentSnapshot: pointer || null, visibility } });
        const importState = { sourceHash: sourceHash(item, bundle), dbHash: contentHash(c, draft), ...(item.legacy ? { legacy: item.legacy } : {}) };
        c = await payload.update({ collection: 'contents', id: c.id, req, overrideAccess: true, depth: 0, data: { importState } });
        contentMap.set(item.stableId, c); imported++;
      }
      for (const q of bundle.quotes) {
        if (rows.find(r => r.type === 'quote' && r.key === q.stableId)!.status === 'unchanged') continue;
        const old = db.quotes.find(v => v.stableId === q.stableId);
        const data = { ...q, content: q.content ? contentMap.get(q.content)!.id : null, snapshot: q.snapshot ? snapshotMap.get(q.snapshot)?.id : null, enabled: q.content && !q.snapshot ? false : q.enabled };
        if (q.snapshot && !data.snapshot) throw new APIError('金句引用的版本未导入；请处理既有内容版本冲突。', 409);
        const importState = { sourceHash: sourceHash(q, bundle), dbHash: hash(quoteData(data)) };
        if (old) await payload.update({ collection: 'quotes', id: old.id, data: { ...data, importState }, req, overrideAccess: true });
        else await payload.create({ collection: 'quotes', data: { ...data, importState }, req, overrideAccess: true });
        imported++;
      }
      if (rows.find(r => r.type === 'home')!.status !== 'unchanged') {
        const old = db.homes.find(h => h.key === 'home');
        const data = { key: 'home', introduction: bundle.home.introduction, featured: bundle.home.featured.map(id => contentMap.get(id)!.id) };
        const importState = { sourceHash: sourceHash(bundle.home, bundle), dbHash: hash(homeData(data)) };
        if (old) await payload.update({ collection: 'home', id: old.id, data: { ...data, importState }, req, overrideAccess: true });
        else await payload.create({ collection: 'home', data: { ...data, importState }, req, overrideAccess: true });
        imported++;
      }
      return { rows, imported };
    });
  } catch (error) {
    // Payload's file writes are outside PostgreSQL rollback; remove only this attempt's UUID files.
    if (fs.existsSync(mediaRoot)) for (const file of fs.readdirSync(mediaRoot)) if (files.some(name => file === name || file.startsWith(`${name.slice(0, -5)}-`))) fs.unlinkSync(path.join(mediaRoot, file));
    throw error;
  }
}

export async function exportBundle(payload: Payload, user: Actor, options: { includeDrafts?: boolean } = {}): Promise<Bundle> {
  const actor = await requireEditor(payload, user);
  const db = await state(payload), media = new Map<string, Asset>();
  const body = (doc: Doc): Body => ({ title: doc.title, metadata: metadata(doc.metadata), markdown: mapImages(doc.markdown, src => {
    const m = db.media.find(m => `media:${m.id}` === src);
    if (!m) return fail('导出媒体引用缺失。');
    if (!media.has(m.stableId)) {
      const bytes = fs.readFileSync(inside(path.resolve(process.env.MEDIA_ROOT || 'storage/media'), m.filename));
      if (hash(bytes) !== m.bodyHash) fail('媒体文件哈希与数据库不一致。');
      media.set(m.stableId, { stableId: m.stableId, alt: m.alt, hash: m.bodyHash, bytes, ...(m.origin ? { original: m.origin } : {}) });
    }
    return `asset:${m.stableId}`;
  }) });
  const items: Item[] = [];
  for (const c of db.contents) {
    if (c.visibility === 'purged') continue;
    if (!options.includeDrafts && c.visibility !== 'public') continue;
    if (actor.role !== 'admin' && options.includeDrafts && Number(c.author) !== actor.id) continue;
    const versions = db.snapshots.filter(s => s.content === c.id);
    const current = versions.find(s => s.id === c.currentSnapshot);
    const work = options.includeDrafts ? db.drafts.find(d => d.content === c.id) : current;
    if (!work) continue;
    items.push({ stableId: c.stableId, slug: c.slug, kind: c.kind, work: body(work), currentSnapshot: current?.stableId || null, visibility: c.visibility, ...(c.importState?.legacy ? { legacy: c.importState.legacy } : {}), snapshots: versions.map(s => ({ ...body(s), stableId: s.stableId, publishedAt: s.publishedAt, rendererVersion: s.rendererVersion, plainText: s.plainText, summary: s.summary || '' })) });
  }
  const quotes = db.quotes.filter(q => (options.includeDrafts || q.enabled) && (!q.content || items.some(i => db.contents.find(c => c.id === q.content)?.stableId === i.stableId))).map(q => ({ ...quoteData(q), content: q.content ? db.contents.find(c => c.id === q.content)!.stableId : null, snapshot: q.snapshot ? db.snapshots.find(s => s.id === q.snapshot)!.stableId : null })) as Quote[];
  const home = db.homes.find(h => h.key === 'home');
  return validateBundle({ version: 1, items, quotes, media: [...media.values()].sort((a, b) => a.stableId.localeCompare(b.stableId)), home: { introduction: home?.introduction || '为你讲述打动人心的故事，每个人物，都可以成为主角。', featured: (home?.featured || []).map((id: number) => db.contents.find(c => c.id === id)?.stableId).filter((id: string) => items.some(i => i.stableId === id)) } });
}
