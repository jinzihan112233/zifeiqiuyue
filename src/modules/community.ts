import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata as ImageMetadata } from 'sharp';
import { APIError, createLocalReq, type Payload, type PayloadRequest } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { currentActor, writeContext, type Actor } from './access';
import { imageIds, renderMarkdown, verifyAnnotationText } from './markdown';
import { metadata, requireArticle, type Metadata } from './content-format';
import { annotationComment } from './discussion';
import { textAnchor } from './annotation-text';

type Content = { id: number; slug: string; kind: 'article' | 'post'; author: number; visibility: 'unpublished' | 'public' | 'hidden' | 'purged'; currentSnapshot: number | null };
type Body = { id: number; author: number; content: number; title: string; markdown: string; metadata: Metadata; mediaIds: number[]; revision: number };
type MediaStamp = { id: number; filename: string; hash: string; alt: string };
type Submission = Body & { status: 'pending' | 'approved' | 'returned' | 'withdrawn'; mediaManifest?: MediaStamp[]; decisionKey?: string; reviewer?: number; reason?: string };
type Snapshot = Body & { submission: number; html: string; plainText: string; bodyHash: string; rendererVersion: string };
type MediaDoc = { id: number; owner: number; filename: string; url: string; alt: string; purged?: boolean; bodyHash: string; sizes?: { thumb?: { url: string } } };

export function txDB(req: PayloadRequest) {
  const sessions = req.payload.db.sessions as Record<string, { db: { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, any>[] }> } }>;
  return sessions[String(req.transactionID)].db;
}
export function liveContent(content: { visibility: string }) { if (content.visibility === 'purged') throw new APIError('内容已清除。', 410); }
export async function audit(req: PayloadRequest, actor: Actor, content: number, action: string, details: Record<string, unknown> = {}) {
  return req.payload.create({ collection: 'content-events', data: { content, actor: actor.id, action, ...details }, req, overrideAccess: true });
}

export function positiveId(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new APIError('无效 ID。', 400);
  return result;
}
export function requiredText(value: unknown, max = 50000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new APIError('文字为空或超出长度限制。', 400);
  return value;
}
const getDoc = async <T>(payload: Payload, collection: string, id: number, req?: PayloadRequest): Promise<T> => {
  const record = await payload.findByID({ collection, id, depth: 0, overrideAccess: true, disableErrors: true, req });
  if (!record) throw new APIError('内容不可用。', 404);
  return record as unknown as T;
};
const isOwner = (actor: Actor, author: number) => {
  if (actor.role !== 'admin' && actor.id !== Number(author)) throw new APIError('没有操作权限。', 403);
};

export async function transaction<T>(payload: Payload, user: Actor, key: number, run: (req: PayloadRequest, actor: Actor) => Promise<T>, exclusive = false, accountLock = false): Promise<T> {
  const id = await payload.db.beginTransaction();
  if (id === null) throw new Error('PostgreSQL transactions are required');
  const req = await createLocalReq({ user, context: writeContext() }, payload);
  req.transactionID = id;
  try {
    if (accountLock) await txDB(req).execute(sql`SELECT pg_advisory_xact_lock(97124, 0)`);
    // PostgreSQL transaction-scoped locks serialize decisions for one content across processes.
    // This adapter bridge is pinned to Payload 3.91 and covered by real database race tests.
    await txDB(req).execute(exclusive ? sql`SELECT pg_advisory_xact_lock(97125, 0)` : sql`SELECT pg_advisory_xact_lock_shared(97125, 0)`);
    await txDB(req).execute(sql`SELECT pg_advisory_xact_lock(97123, ${key})`);
    await txDB(req).execute(sql`SELECT id FROM community.users WHERE id = ${user.id} FOR SHARE`);
    const actor = await currentActor(payload, user, req);
    if (!actor) throw new APIError('账号不可用。', 403);
    const result = await run(req, actor);
    await payload.db.commitTransaction(id);
    return result;
  } catch (error) {
    await payload.db.rollbackTransaction(id);
    throw error;
  }
}

async function mediaFor(payload: Payload, actor: Actor, markdown: string, req?: PayloadRequest, allowed: number[] = [], ownerId = actor.id, frozen?: MediaStamp[]) {
  const ids = imageIds(markdown);
  const media = new Map<number, string>();
  const manifest: MediaStamp[] = [];
  for (const id of ids) {
    const file = await getDoc<MediaDoc>(payload, 'media', id, req);
    if (file.purged || Number(file.owner) !== ownerId && Number(file.owner) !== actor.id && !allowed.includes(id)) throw new APIError('不能绑定其他成员的图片。', 403);
    try {
      const root = fs.realpathSync(path.resolve(process.env.MEDIA_ROOT || 'storage/media'));
      const target = fs.realpathSync(path.resolve(root, file.filename));
      if (!target.startsWith(root + path.sep) || crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== file.bodyHash) throw new Error('Invalid media');
    } catch { throw new APIError('图片文件缺失或哈希不一致。', 409); }
    const stamp = { id, filename: file.filename, hash: file.bodyHash, alt: file.alt };
    const old = frozen?.find(item => item.id === id);
    if (frozen?.length && (!old || old.filename !== stamp.filename || old.hash !== stamp.hash || old.alt !== stamp.alt)) throw new APIError('冻结图片已发生变化。', 409);
    manifest.push(stamp);
    media.set(id, `/api/media/file/${encodeURIComponent(file.filename)}`);
  }
  return { ids, media, manifest };
}

export async function previewDraft(payload: Payload, user: Actor, markdown: unknown, contentId?: number) {
  return transaction(payload, user, 0, async (req, actor) => {
    const source = requiredText(markdown);
    let allowed: number[] = [], owner = actor.id;
    if (contentId) { const c = await getDoc<Content>(payload, 'contents', contentId, req); isOwner(actor, c.author); liveContent(c); owner = c.author; const draft = (await payload.find({ collection: 'drafts', where: { content: { equals: c.id } }, limit: 1, req, overrideAccess: true })).docs[0]; allowed = draft?.mediaIds || []; }
    const { media } = await mediaFor(payload, actor, source, req, allowed, owner);
    return renderMarkdown(source, media);
  });
}

export async function createContent(payload: Payload, user: Actor, input: { slug?: unknown; title?: unknown; markdown?: unknown; kind?: unknown; metadata?: unknown }) {
  const slug = requiredText(input.slug, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new APIError('标识仅使用小写字母、数字和短横线。', 400);
  return transaction(payload, user, 0, async (req, actor) => {
    const kind = input.kind === undefined ? 'post' : input.kind;
    if (!['article', 'post'].includes(String(kind))) throw new APIError('内容类型无效。', 400);
    if (kind === 'article' && actor.role === 'member') throw new APIError('仅编辑和管理员可创建站方文章。', 403);
    const title = requiredText(input.title, 200), markdown = requiredText(input.markdown);
    const { ids } = await mediaFor(payload, actor, markdown, req);
    const content = await payload.create({ collection: 'contents', data: { slug, kind, author: actor.id, visibility: 'unpublished' }, req, depth: 0, overrideAccess: true });
    const draft = await payload.create({ collection: 'drafts', data: { content: content.id, author: actor.id, title, markdown, metadata: metadata(input.metadata), mediaIds: ids, mediaRefs: ids, revision: 1 }, req, depth: 0, overrideAccess: true });
    return { content, draft };
  });
}

export async function saveDraft(payload: Payload, user: Actor, contentId: number, input: { revision?: unknown; title?: unknown; markdown?: unknown; metadata?: unknown; reason?: unknown }) {
  return transaction(payload, user, contentId, async (req, actor) => {
    const content = await getDoc<Content>(payload, 'contents', contentId, req); isOwner(actor, content.author);
    liveContent(content);
    if (content.kind === 'article' && actor.role === 'member') throw new APIError('站方文章需要编辑权限。', 403);
    const draft = (await payload.find({ collection: 'drafts', where: { content: { equals: contentId } }, depth: 0, overrideAccess: true, req })).docs[0] as unknown as Body;
    if (!draft || draft.revision !== input.revision) throw new APIError('稿件已变化，请重新读取后保存。', 409);
    const title = requiredText(input.title, 200), markdown = requiredText(input.markdown);
    const { ids } = await mediaFor(payload, actor, markdown, req, draft.mediaIds, content.author);
    if (actor.id !== Number(content.author)) await audit(req, actor, contentId, 'save', { delegated: true, reason: requiredText(input.reason, 1000) });
    return payload.update({ collection: 'drafts', id: draft.id, data: { title, markdown, metadata: metadata(input.metadata, draft.metadata), mediaIds: ids, mediaRefs: ids, revision: draft.revision + 1 }, req, overrideAccess: true, depth: 0 });
  });
}

export async function submitDraft(payload: Payload, user: Actor, contentId: number, revision: unknown, requestKey?: unknown, reason?: unknown) {
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey))) throw new APIError('请求标识无效。', 400);
  return transaction(payload, user, contentId, async (req, actor) => {
    const content = await getDoc<Content>(payload, 'contents', contentId, req); isOwner(actor, content.author);
    liveContent(content);
    const key = requestKey ? `${actor.id}:${contentId}:${requestKey}` : null;
    if (key) { const old = (await payload.find({ collection: 'submissions', where: { requestKey: { equals: key } }, limit: 1, req, depth: 0, overrideAccess: true })).docs[0]; if (old) { if (old.revision !== revision) throw new APIError('请求标识已用于其他修订。', 409); return old; } }
    if (content.kind === 'article' && actor.role === 'member') throw new APIError('站方文章需要编辑权限。', 403);
    const pending = await payload.find({ collection: 'submissions', where: { and: [{ content: { equals: contentId } }, { status: { equals: 'pending' } }] }, depth: 0, overrideAccess: true, req });
    if (pending.totalDocs) throw new APIError('已有待审副本，请先撤回。', 409);
    const draft = (await payload.find({ collection: 'drafts', where: { content: { equals: contentId } }, depth: 0, overrideAccess: true, req })).docs[0] as unknown as Body;
    if (!draft || draft.revision !== revision) throw new APIError('稿件修订号不一致。', 409);
    if ((await payload.count({ collection: 'submissions', where: { and: [{ content: { equals: contentId } }, { revision: { equals: revision } }] }, req, overrideAccess: true })).totalDocs) throw new APIError('该修订已提交过，请修改并保存新修订后再提交。', 409);
    if (content.kind === 'article') requireArticle(draft.markdown);
    const { ids, manifest } = await mediaFor(payload, actor, draft.markdown, req, draft.mediaIds, content.author);
    const result = await payload.create({ collection: 'submissions', data: { content: contentId, author: content.author, requestKey: key, title: draft.title, markdown: draft.markdown, metadata: metadata(draft.metadata), mediaIds: ids, mediaRefs: ids, mediaManifest: manifest, revision: draft.revision, status: 'pending' }, req, overrideAccess: true, depth: 0 });
    await audit(req, actor, contentId, 'submitted', { target: result.id, delegated: actor.id !== Number(content.author), ...(actor.id !== Number(content.author) ? { reason: requiredText(reason, 1000) } : {}) }); return result;
  });
}

export async function decideSubmission(payload: Payload, user: Actor, submissionId: number, decision: 'approved' | 'returned' | 'withdrawn', reason = '', expected = 'pending', requestKey?: string, internalNote = '') {
  if (requestKey !== undefined && !/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey)) throw new APIError('请求标识无效。', 400);
  if (typeof reason !== 'string' || reason.length > 1000 || internalNote.length > 1000 || decision === 'returned' && !reason.trim()) throw new APIError('退回须填写理由，理由和内部备注不超过 1000 字符。', 400);
  const initial = await getDoc<Submission>(payload, 'submissions', submissionId);
  return transaction(payload, user, Number(initial.content), async (req, actor) => {
    const submission = await getDoc<Submission>(payload, 'submissions', submissionId, req);
    const content = await getDoc<Content>(payload, 'contents', Number(submission.content), req);
    liveContent(content);
    if (decision === 'withdrawn') isOwner(actor, submission.author);
    else if (actor.role !== 'admin' && !(actor.role === 'editor' && content.kind === 'article' && Number(content.author) === actor.id)) throw new APIError('没有审核该内容的权限。', 403);
    if (decision === 'withdrawn' && actor.id !== Number(submission.author) && !reason.trim()) throw new APIError('代为撤回须填写理由。', 400);
    const prefix = requestKey ? `${actor.id}:${requestKey}:` : null;
    const key = prefix ? prefix + crypto.createHash('sha256').update(JSON.stringify({ decision, reason, internalNote })).digest('hex') : null;
    if (prefix && submission.decisionKey?.startsWith(prefix)) { if (submission.decisionKey !== key || submission.status !== decision) throw new APIError('请求标识已用于其他决定。', 409); const snapshot = (await payload.find({ collection: 'snapshots', where: { submission: { equals: submissionId } }, limit: 1, req, overrideAccess: true })).docs[0]; return { status: decision, snapshot }; }
    if (expected !== 'pending' || submission.status !== 'pending') throw new APIError('提交已被处理，请刷新。', 409);
    let media = new Map<number, string>();
    if (decision === 'approved') {
      await txDB(req).execute(sql`SELECT id FROM community.users WHERE id = ${Number(content.author)} FOR SHARE`);
      const author = await currentActor(payload, { id: content.author }, req); if (!author) throw new APIError('作者账号不可用，投稿暂不能批准。', 409);
      ({ media } = await mediaFor(payload, author, submission.markdown, req, submission.mediaIds, Number(content.author), submission.mediaManifest));
    }
    await payload.update({ collection: 'submissions', id: submissionId, data: { status: decision, reviewer: actor.id, reason, decisionKey: key, reviewedAt: new Date().toISOString() }, req, overrideAccess: true });
    await audit(req, actor, content.id, decision, { target: submissionId, reason, internalNote, selfPublished: decision === 'approved' && actor.id === Number(content.author), delegated: decision === 'withdrawn' && actor.id !== Number(content.author) });
    if (decision !== 'approved') return { status: decision };
    const summary = content.kind === 'article' ? requireArticle(submission.markdown) : '';
    const rendered = renderMarkdown(submission.markdown, media);
    const snapshot = await payload.create({ collection: 'snapshots', data: { content: submission.content, submission: submission.id, title: submission.title, markdown: submission.markdown, metadata: metadata(submission.metadata), summary, mediaIds: submission.mediaIds, mediaRefs: submission.mediaIds, mediaManifest: submission.mediaManifest || [], ...rendered }, req, depth: 0, overrideAccess: true });
    await payload.update({ collection: 'contents', id: content.id, data: { currentSnapshot: snapshot.id, visibility: content.visibility === 'hidden' ? 'hidden' : 'public' }, req, overrideAccess: true });
    return { status: decision, snapshot };
  });
}

export async function setVisibility(payload: Payload, user: Actor, contentId: number, visibility: 'public' | 'hidden', reason = '管理操作', expected?: string) {
  requiredText(reason, 1000);
  return transaction(payload, user, contentId, async (req, actor) => {
    if (actor.role !== 'admin') throw new APIError('仅管理员可下架或恢复。', 403);
    const content = await getDoc<Content>(payload, 'contents', contentId, req);
    liveContent(content);
    if (expected && expected !== content.visibility) throw new APIError('公开状态已变化，请刷新。', 409);
    if (!content.currentSnapshot) throw new APIError('尚未发布，不能恢复公开。', 409);
    await audit(req, actor, contentId, visibility === 'hidden' ? 'hidden' : 'restored', { reason });
    return payload.update({ collection: 'contents', id: contentId, data: { visibility }, req, overrideAccess: true, depth: 0 });
  });
}

export async function uploadMedia(payload: Payload, user: Actor, bytes: Buffer, alt: string) {
  if (bytes.length > 5 * 1024 * 1024) throw new APIError('图片不能超过 5 MiB。', 400);
  const source = sharp(bytes, { limitInputPixels: 8192 * 8192 });
  let metadata: ImageMetadata;
  try { metadata = await source.metadata(); } catch { throw new APIError('无法解码图片，请使用有效的 JPEG、PNG 或 WebP。', 400); }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192) throw new APIError('只接受尺寸受限的 JPEG、PNG、WebP。', 400);
  let data: Buffer;
  try { data = await source.rotate().webp({ lossless: true }).toBuffer(); } catch { throw new APIError('图片数据不完整或无法转换。', 400); }
  if (data.length > 5 * 1024 * 1024) throw new APIError('转换后的图片超过 5 MiB，请降低尺寸。', 400);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return transaction(payload, user, 0, async (req, actor) => payload.create({ collection: 'media', data: { owner: actor.id, alt: requiredText(alt, 300), bodyHash: hash }, file: { data, mimetype: 'image/webp', name: `${crypto.randomUUID()}.webp`, size: data.length }, req, overrideAccess: true, depth: 0 }));
}

export async function addAnnotation(payload: Payload, user: Actor, input: { snapshot?: unknown; start?: unknown; end?: unknown; quote?: unknown; body?: unknown; requestKey?: unknown; rendererVersion?: unknown; prefix?: unknown; suffix?: unknown }) {
  const snapshotId = positiveId(input.snapshot), initial = await getDoc<Snapshot>(payload, 'snapshots', snapshotId);
  return transaction(payload, user, Number(initial.content), async (req, actor) => {
    const snapshot = await getDoc<Snapshot & { rendererVersion: string }>(payload, 'snapshots', snapshotId, req);
    const content = await getDoc<Content>(payload, 'contents', Number(snapshot.content), req);
    if (content.visibility !== 'public') throw new APIError('内容不可用。', 404);
    if (input.rendererVersion !== undefined && input.rendererVersion !== snapshot.rendererVersion) throw new APIError('定位规则已变化，请刷新后重新选择文字；保留当前评论输入。', 409);
    if (input.requestKey !== undefined && (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestKey))) throw new APIError('提交标识无效。', 400);
    const key = input.requestKey ? `${actor.id}:annotation:${input.requestKey}` : undefined;
    const hash = crypto.createHash('sha256').update(JSON.stringify([snapshotId,input.start,input.end,input.quote,input.body,input.rendererVersion,input.prefix,input.suffix])).digest('hex');
    if (key) {
      const prior = await payload.find({ collection: 'comments', where: { requestKey: { equals: key } }, req, overrideAccess: true, depth: 0, limit: 1 });
      if (prior.docs[0]) {
        if (prior.docs[0].requestHash !== hash) throw new APIError('提交标识已用于其他批注。', 409);
        const notes = await payload.find({ collection: 'annotations', where: { comment: { equals: prior.docs[0].id } }, req, overrideAccess: true, depth: 0, limit: 1 });
        return notes.docs[0];
      }
    }
    let anchor;
    try { anchor = textAnchor(snapshot.plainText, input.start, input.end, snapshot.rendererVersion); }
    catch (error) { throw new APIError((error as Error).message, 400); }
    if (input.quote !== anchor.quote || input.prefix !== undefined && input.prefix !== anchor.prefix || input.suffix !== undefined && input.suffix !== anchor.suffix) throw new APIError('引用或上下文与发布版本不一致。', 400);
    verifyAnnotationText(snapshot.html, snapshot.plainText, anchor.start, anchor.end);
    const comment = await annotationComment(req, actor, content.id, input.body, key, hash);
    return payload.create({ collection: 'annotations', data: { comment: comment.id, content: content.id, snapshot: snapshotId, author: actor.id, ...anchor }, req, overrideAccess: true, depth: 0 });
  });
}
