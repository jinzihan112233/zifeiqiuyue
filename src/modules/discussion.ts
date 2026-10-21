import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { APIError, type Payload, type PayloadRequest, type Where } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { currentActor, type Actor } from './access';
import { audit, positiveId, requiredText, transaction, txDB } from './community';
import { annotationHref } from './annotation-text';
import { clientAddress } from './deployment';

type Doc = Record<string, any>;
const md = new MarkdownIt({ html: false, breaks: true }).disable(['image', 'heading', 'table', 'html_block', 'html_inline']);
export function commentBody(value: unknown) {
  const body = requiredText(value, 5000);
  const parsed = new MarkdownIt({ html: false }).parse(body, {});
  if (parsed.some(token => token.children?.some(child => child.type === 'image'))) throw new APIError('评论不支持图片。', 400);
  return body;
}
export const commentHTML = (body: string) => md.render(body);
async function doc(req: PayloadRequest, collection: string, id: number): Promise<Doc> {
  const value = await req.payload.findByID({ collection, id, req, overrideAccess: true, depth: 0, disableErrors: true });
  if (!value) throw new APIError('目标不可用。', 404);
  return value;
}
async function participating(req: PayloadRequest, id: number, writing = false) {
  const content = await doc(req, 'contents', id);
  if (content.visibility !== 'public' || !content.currentSnapshot) throw new APIError('内容不可用。', 404);
  if (writing && content.discussion === 'locked') throw new APIError('讨论已锁定。', 409);
  return content;
}
function expected(value: unknown, revision: number) {
  if (value !== revision) throw new APIError('记录已变化，请刷新后重试；当前输入仍可保留。', 409);
}
function admin(actor: Actor) { if (actor.role !== 'admin') throw new APIError('仅管理员可执行。', 403); }
async function quota(req: PayloadRequest, key: string, max: number, seconds: number) {
  const bucket = createHash('sha256').update(key).digest('hex');
  const { rows } = await txDB(req).execute(sql`INSERT INTO community.auth_limits(bucket,count,expires_at,created_at,updated_at)
    VALUES (${bucket},1,now()+${seconds}*interval '1 second',now(),now()) ON CONFLICT(bucket) DO UPDATE SET
    count=CASE WHEN auth_limits.expires_at<=now() THEN 1 ELSE auth_limits.count+1 END,
    expires_at=CASE WHEN auth_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE auth_limits.expires_at END,updated_at=now() RETURNING count`);
  if (Number(rows[0].count) > max) throw new APIError('操作过于频繁，请稍后再试。', 429);
}
export async function speechQuota(req: PayloadRequest, actor: Actor, headers?: Headers) {
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  await quota(req, `speech:minute:${actor.id}`, 5, 60);
  await quota(req, `speech:day:${day}:${actor.id}`, 200, 86400);
  const ip = clientAddress(headers);
  await quota(req, `speech:ip:${ip}:minute`, 60, 60);
  await quota(req, `speech:ip:${ip}:${day}`, 2000, 86400);
}
function requestIdentity(actor: Actor, input: Doc) {
  if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestKey)) throw new APIError('缺少有效的提交标识。', 400);
  return `${actor.id}:${input.requestKey}`;
}
async function createComment(req: PayloadRequest, actor: Actor, content: number, body: string, parent: number | null, key?: string, hash?: string) {
  return req.payload.create({ collection: 'comments', data: { content, author: actor.id, body, parent, root: parent ? (await doc(req, 'comments', parent)).root || parent : null, requestKey: key, requestHash: hash }, req, overrideAccess: true, depth: 0 });
}
export async function addComment(payload: Payload, user: Actor, input: Doc, headers?: Headers) {
  const id = positiveId(input.content), body = commentBody(input.body), parent = input.parent == null ? null : positiveId(input.parent);
  const key = requestIdentity(user, input), hash = createHash('sha256').update(JSON.stringify([id, parent, body])).digest('hex');
  return transaction(payload, user, id, async (req, actor) => {
    await participating(req, id, true);
    const found = await payload.find({ collection: 'comments', where: { requestKey: { equals: key } }, req, overrideAccess: true, depth: 0, limit: 1 });
    if (found.docs[0]) {
      if (found.docs[0].requestHash !== hash) throw new APIError('该提交标识已用于其他内容。', 409);
      return { id: found.docs[0].id };
    }
    if (parent) {
      const target = await doc(req, 'comments', parent);
      if (Number(target.content) !== id || target.deleted || target.moderation !== 'visible') throw new APIError('无法回复该评论。', 400);
    }
    await speechQuota(req, actor, headers);
    const result = await createComment(req, actor, id, body, parent, key, hash);
    return { id: result.id };
  });
}
export async function annotationComment(req: PayloadRequest, actor: Actor, content: number, body: unknown, key?: string, hash?: string, headers?: Headers) {
  await participating(req, content, true); await speechQuota(req, actor, headers);
  return createComment(req, actor, content, commentBody(body), null, key, hash);
}
export async function changeComment(payload: Payload, user: Actor, id: number, input: Doc, deleting = false) {
  const initial = await payload.findByID({ collection: 'comments', id, overrideAccess: true, depth: 0, disableErrors: true });
  if (!initial) throw new APIError('评论不可用。', 404);
  return transaction(payload, user, Number(initial.content), async (req, actor) => {
    await participating(req, Number(initial.content));
    const comment = await doc(req, 'comments', id);
    if (Number(comment.author) !== actor.id) throw new APIError('只能修改自己的评论。', 403);
    expected(input.revision, comment.revision);
    if (comment.deleted) throw new APIError('评论已删除。', 409);
    await quota(req, `comment:edit:${actor.id}`, 20, 60);
    const data = deleting ? { body: '[已删除]', deleted: true, requestHash: null } : { body: commentBody(input.body), editedAt: new Date().toISOString() };
    await payload.update({ collection: 'comments', id, data: { ...data, revision: comment.revision + 1 }, req, overrideAccess: true });
    if (deleting) {
      const notes = await payload.find({ collection: 'annotations', where: { comment: { equals: id } }, req, overrideAccess: true, depth: 0 });
      for (const note of notes.docs) await payload.update({ collection: 'annotations', id: note.id, data: { quote: '[已删除]', prefix: null, suffix: null }, req, overrideAccess: true });
    }
    return { ok: true };
  });
}

function pagination(value: unknown) {
  if (value === undefined || value === null) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) throw new APIError('页码无效。', 400);
  return Number(value);
}
function projection(row: Doc, actor?: Actor | null) {
  const visible = !row.deleted && row.moderation === 'visible';
  return { id: Number(row.id), parent: row.parent_id ? Number(row.parent_id) : null, root: row.root_id ? Number(row.root_id) : null,
    nickname: row.nickname || '成员', body: visible ? row.body : '', html: visible ? commentHTML(row.body) : '',
    deleted: row.deleted, hidden: row.moderation === 'hidden', revision: Number(row.revision), editedAt: row.edited_at, createdAt: row.created_at,
    own: actor?.id === Number(row.author_id), annotation: visible && row.snapshot_id ? { id: Number(row.annotation_id), snapshot: Number(row.snapshot_id), version: row.version, quote: row.quote } : null };
}
const select = `SELECT m.*, u.nickname, a.id AS annotation_id, a.snapshot_id, a.quote, s.stable_id AS version FROM community.comments m
  JOIN community.users u ON u.id=m.author_id LEFT JOIN community.annotations a ON a.comment_id=m.id LEFT JOIN community.snapshots s ON s.id=a.snapshot_id`;
export async function discussion(payload: Payload, content: number, pageValue?: unknown, root?: number, actor?: Actor | null) {
  const page = pagination(pageValue), size = 20;
  const parent = await payload.findByID({ collection: 'contents', id: content, overrideAccess: true, depth: 0, disableErrors: true });
  if (!parent || parent.visibility !== 'public' || !parent.currentSnapshot) throw new APIError('内容不可用。', 404);
  // Repeat parent visibility in each SQL read, including totals and independently addressed roots.
  const filter = `m.content_id=$1 AND EXISTS(SELECT 1 FROM community.contents c WHERE c.id=m.content_id AND c.visibility='public')`;
  let thread: Doc | null = null;
  if (root) {
    const { rows } = await payload.db.pool.query(`${select} WHERE ${filter} AND m.id=$2 AND m.parent_id IS NULL`, [content, root]);
    if (!rows[0]) throw new APIError('讨论不可用。', 404);
    thread = projection(rows[0], actor);
  }
  const condition = root ? 'm.root_id=$2' : 'm.parent_id IS NULL';
  const args = root ? [content, root] : [content];
  const { rows: counts } = await payload.db.pool.query(`SELECT count(*)::int AS total FROM community.comments m WHERE ${filter} AND ${condition}`, args);
  const pages = Math.max(1, Math.ceil(counts[0].total / size));
  if (page > pages) throw new APIError('该页不存在。', 404);
  const { rows } = await payload.db.pool.query(`${select} WHERE ${filter} AND ${condition} ORDER BY m.created_at,m.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args);
  return { items: rows.map(row => projection(row, actor)), thread, page, pages, total: counts[0].total, locked: parent.discussion === 'locked' };
}
export async function ownComments(payload: Payload, actor: Actor, pageValue?: unknown) {
  const page = pagination(pageValue), args = [actor.id];
  const where = `m.author_id=$1 AND c.visibility='public'`;
  const { rows: count } = await payload.db.pool.query(`SELECT count(*)::int AS total FROM community.comments m JOIN community.contents c ON c.id=m.content_id WHERE ${where}`, args);
  const { rows } = await payload.db.pool.query(`SELECT m.id,m.body,m.deleted,m.moderation,m.updated_at,m.root_id,c.slug,c.kind,a.id AS annotation_id,s.stable_id AS version FROM community.comments m JOIN community.contents c ON c.id=m.content_id LEFT JOIN community.comments r ON r.id=COALESCE(m.root_id,m.id) LEFT JOIN community.annotations a ON a.comment_id=r.id AND r.deleted=false AND r.moderation='visible' LEFT JOIN community.snapshots s ON s.id=a.snapshot_id WHERE ${where} ORDER BY m.updated_at DESC,m.id DESC LIMIT 10 OFFSET ${(page - 1) * 10}`, args);
  return { page, totalPages: Math.max(1, Math.ceil(count[0].total / 10)), docs: rows.map(row => {
    const path = `/${row.kind === 'article' ? 'articles' : 'posts'}/${row.slug}`, root = Number(row.root_id || row.id);
    return { id: row.id, title: `评论 #${row.id}`, status: row.deleted ? '已删除' : row.moderation === 'hidden' ? '已隐藏' : '公开', body: row.deleted ? '' : row.body, updatedAt: row.updated_at, href: row.version ? annotationHref(path,row.version,Number(row.annotation_id),root,'discussion') : `${path}?thread=${root}#discussion` };
  }) };
}
export async function reportTarget(payload: Payload, user: Actor, input: Doc, headers?: Headers) {
  const content = positiveId(input.content), comment = input.comment == null ? null : positiveId(input.comment), reason = requiredText(input.reason, 1000);
  return transaction(payload, user, content, async (req, actor) => {
    await participating(req, content);
    if (comment) { const target = await doc(req, 'comments', comment); if (Number(target.content) !== content || target.deleted || target.moderation !== 'visible') throw new APIError('目标不可举报。', 404); }
    const where: Where = { and: [{ content: { equals: content } }, { reporter: { equals: actor.id } }, { status: { equals: 'pending' } }, comment ? { comment: { equals: comment } } : { comment: { exists: false } }] };
    const prior = await payload.find({ collection: 'reports', where, req, overrideAccess: true, depth: 0, limit: 1 });
    if (prior.docs[0]) return { ok: true };
    await quota(req, `report:minute:${actor.id}`, 5, 60); await quota(req, `report:day:${actor.id}`, 30, 86400);
    await quota(req, `report:ip:${clientAddress(headers)}`, 60, 60);
    await payload.create({ collection: 'reports', data: { content, comment, reporter: actor.id, reason }, req, overrideAccess: true });
    return { ok: true };
  });
}
export async function reports(payload: Payload, user: Actor, pageValue?: unknown, status = 'pending') {
  const actor = await currentActor(payload, user); if (!actor) throw new APIError('请重新登录。', 401); admin(actor);
  if (!['pending', 'resolved', 'dismissed'].includes(status)) throw new APIError('状态无效。', 400);
  const found = await payload.find({ collection: 'reports', where: { status: { equals: status } }, sort: ['createdAt', 'id'], page: pagination(pageValue), limit: 20, overrideAccess: true, depth: 0 });
  const items: Doc[] = [];
  for (const report of found.docs) {
    const content = await payload.findByID({ collection: 'contents', id: Number(report.content), overrideAccess: true, depth: 0 });
    const target = report.comment ? await payload.findByID({ collection: 'comments', id: Number(report.comment), overrideAccess: true, depth: 0 }) : null;
    const snapshot = content.currentSnapshot ? await payload.findByID({ collection: 'snapshots', id: Number(content.currentSnapshot), overrideAccess: true, depth: 0 }) : null;
    const parent = target?.parent ? await payload.findByID({ collection: 'comments', id: Number(target.parent), overrideAccess: true, depth: 0 }) : null;
    items.push({ ...report, contentState: content.visibility, discussion: content.discussion, title: snapshot?.title || content.slug, contentBody: snapshot?.markdown || '', target, parent, author: target?.author || content.author, href: `/workspace/review/${content.id}` });
  }
  return { items, page: found.page || 1, pages: found.totalPages || 1 };
}
export async function moderate(payload: Payload, user: Actor, input: Doc) {
  const contentId = positiveId(input.content), reason = requiredText(input.reason, 1000);
  if (!['hide', 'restore', 'dismiss', 'ban', 'lock', 'unlock', 'hide-content', 'restore-content'].includes(input.action)) throw new APIError('管理动作无效。', 400);
  return transaction(payload, user, contentId, async (req, actor) => {
    admin(actor); const content = await doc(req, 'contents', contentId);
    if (content.visibility === 'purged') throw new APIError('内容已清除。', 410);
    const report = input.report ? await doc(req, 'reports', positiveId(input.report)) : null;
    if (report) { if (Number(report.content) !== contentId || report.status !== 'pending') throw new APIError('举报已处理或目标不匹配。', 409); expected(input.reportRevision, report.revision); }
    const commentId = input.comment == null ? null : positiveId(input.comment);
    if (report && Number(report.comment || 0) !== Number(commentId || 0)) throw new APIError('举报目标不匹配。', 400);
    const target = commentId ? await doc(req, 'comments', commentId) : null;
    if (target && Number(target.content) !== contentId) throw new APIError('评论归属不匹配。', 400);
    if (['hide', 'restore'].includes(input.action)) {
      if (!target) throw new APIError('请选择评论。', 400); expected(input.revision, target.revision);
      await payload.update({ collection: 'comments', id: target.id, data: { moderation: input.action === 'hide' ? 'hidden' : 'visible', revision: target.revision + 1 }, req, overrideAccess: true });
    } else if (['lock', 'unlock'].includes(input.action)) {
      if (input.expected !== content.discussion) throw new APIError('讨论状态已变化。', 409);
      await payload.update({ collection: 'contents', id: contentId, data: { discussion: input.action === 'lock' ? 'locked' : 'open' }, req, overrideAccess: true });
    } else if (['hide-content', 'restore-content'].includes(input.action)) {
      if (input.expected !== content.visibility || !content.currentSnapshot || !['public', 'hidden'].includes(content.visibility)) throw new APIError('内容状态已变化或尚未发布。', 409);
      await payload.update({ collection: 'contents', id: contentId, data: { visibility: input.action === 'hide-content' ? 'hidden' : 'public' }, req, overrideAccess: true });
    } else if (input.action === 'ban') {
      const author = await doc(req, 'users', Number(target?.author || content.author));
      await payload.update({ collection: 'users', id: author.id, data: { status: 'banned', sessions: [] }, req, overrideAccess: true });
    } else if (!report) throw new APIError('请选择待处理举报。', 400);
    if (report) await payload.update({ collection: 'reports', id: report.id, data: { status: input.action === 'dismiss' ? 'dismissed' : 'resolved', revision: report.revision + 1, resolver: actor.id, resolution: reason, resolvedAt: new Date().toISOString() }, req, overrideAccess: true });
    await audit(req, actor, contentId, `discussion:${input.action}`, { target: commentId || undefined, reason });
    return { ok: true };
  }, false, input.action === 'ban');
}
