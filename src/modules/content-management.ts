import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { APIError, type Payload, type PayloadRequest } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { type Actor } from './access';
import { audit, liveContent, positiveId, requiredText, transaction, txDB } from './community';

async function manager(req: PayloadRequest, actor: Actor) { if (actor.role !== 'admin') throw new APIError('仅管理员可执行该操作。', 403); }
async function all(payload: Payload, collection: string, where: Record<string, any>, req?: PayloadRequest) {
  const docs: Record<string, any>[] = []; let page = 1, more = true;
  while (more) { const result = await payload.find({ collection, where, req, page, limit: 200, depth: 0, overrideAccess: true }); docs.push(...result.docs); more = result.hasNextPage; page++; }
  return docs;
}
export async function managementList(payload: Payload, actor: Actor, type: string, page: number, status?: string, kind?: string, own = false) {
  if (!['contents', 'submissions', 'media'].includes(type)) throw new APIError('列表类型无效。', 400);
  if (type === 'media' && (status || kind)) throw new APIError('图片库不支持内容状态或类型筛选。', 400);
  const conditions: Record<string, any>[] = [];
  if (actor.role !== 'admin' || own) conditions.push({ [type === 'media' ? 'owner' : 'author']: { equals: actor.id } });
  if (type === 'contents') conditions.push({ visibility: { not_equals: 'purged' } });
  if (type === 'media') conditions.push({ purged: { not_equals: true } });
  if (status) { const field = type === 'submissions' ? 'status' : 'visibility'; if (!(type === 'submissions' ? ['pending', 'approved', 'returned', 'withdrawn'] : ['public', 'hidden', 'unpublished']).includes(status)) throw new APIError('状态筛选无效。', 400); conditions.push({ [field]: { equals: status } }); }
  if (kind) { if (!['article', 'post'].includes(kind)) throw new APIError('内容类型无效。', 400); conditions.push({ [type === 'submissions' ? 'content.kind' : 'kind']: { equals: kind } }); }
  const result = await payload.find({ collection: type, where: conditions.length ? { and: conditions } : {}, sort: ['-createdAt', '-id'], page, limit: 12, depth: 0, overrideAccess: true });
  const drafts = type === 'contents' && result.docs.length ? await payload.find({ collection: 'drafts', where: { content: { in: result.docs.map(doc => doc.id) } }, limit: 12, depth: 0, overrideAccess: true }) : null;
  return { page: result.page, pages: Math.max(1, result.totalPages), total: result.totalDocs, items: result.docs.map(doc => type === 'contents' ? { id: doc.id, title: drafts?.docs.find(draft => draft.content === doc.id)?.title, slug: doc.slug, kind: doc.kind, visibility: doc.visibility, currentSnapshot: doc.currentSnapshot, updatedAt: doc.updatedAt } : type === 'media' ? { id: doc.id, alt: doc.alt, url: doc.url, owner: doc.owner } : { id: doc.id, content: doc.content, title: doc.title, revision: doc.revision, status: doc.status, reason: doc.reason, createdAt: doc.createdAt }) };
}
export async function managementDetail(payload: Payload, user: Actor, id: number, submissionId?: number) {
  return transaction(payload, user, id, async (req, actor) => {
    const content = await payload.findByID({ collection: 'contents', id, req, depth: 0, overrideAccess: true }); liveContent({ visibility: String(content.visibility) });
    if (actor.role !== 'admin' && Number(content.author) !== actor.id) throw new APIError('没有操作权限。', 403);
    const drafts = await payload.find({ collection: 'drafts', where: { content: { equals: id } }, limit: 1, depth: 0, req, overrideAccess: true });
    const submissions = await all(payload, 'submissions', { content: { equals: id } }, req);
    const events = await all(payload, 'content-events', { content: { equals: id } }, req);
    const draft = drafts.docs[0];
    const snapshot = content.currentSnapshot ? await payload.findByID({ collection: 'snapshots', id: Number(content.currentSnapshot), req, depth: 0, overrideAccess: true }) : null;
    const selected = submissionId ? submissions.find(s => s.id === submissionId) : null;
    if (submissionId && !selected) throw new APIError('提交稿不属于该内容。', 404);
    const author = await payload.findByID({ collection: 'users', id: Number(content.author), req, depth: 0, overrideAccess: true });
    const cleanBody = (doc: Record<string, any> | null | undefined) => doc ? { id: doc.id, title: doc.title, markdown: doc.markdown, metadata: doc.metadata, mediaIds: doc.mediaIds, mediaManifest: doc.mediaManifest, revision: doc.revision, updatedAt: doc.updatedAt, status: doc.status, reason: doc.reason } : null;
    return { content: { id: content.id, slug: content.slug, kind: content.kind, visibility: content.visibility, author: content.author }, author: { nickname: author.nickname }, draft: cleanBody(draft), snapshot: cleanBody(snapshot), submission: cleanBody(selected), submissions: submissions.map(s => ({ ...cleanBody(s), createdAt: s.createdAt })), events: events.map(e => ({ id: e.id, action: e.action, reason: e.reason, ...(actor.role === 'admin' ? { internalNote: e.internalNote } : {}), selfPublished: e.selfPublished, delegated: e.delegated, createdAt: e.createdAt })) };
  });
}
export async function frozenPreview(payload: Payload, actor: Actor, contentId: number, submissionId: number) {
  const detail = await managementDetail(payload, actor, contentId, submissionId);
  const submission = detail.submission!;
  const { renderMarkdown } = await import('./markdown');
  const map = new Map<number, string>();
  for (const id of submission.mediaIds || []) {
    const file = await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true });
    if (!file.purged) map.set(Number(id), `/api/media/file/${encodeURIComponent(file.filename)}`);
  }
  return renderMarkdown(submission.markdown, map);
}

type Directive = { stableId: string; media: string[]; at: string };
export function ledgerDirectory() {
  return path.resolve(process.env.PURGE_LEDGER_DIR || `.local/purge-ledger/${new URL(process.env.DATABASE_URL!).pathname.slice(1)}`);
}
function directives(): Directive[] {
  const dir = ledgerDirectory();
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('Purge ledger manifest is missing; restore must remain isolated.');
  return fs.readdirSync(dir).filter(name => name !== 'manifest.json' && name.endsWith('.json')).map(name => {
    const value = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (typeof value.stableId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value.stableId) || !Array.isArray(value.media) || !value.media.every((id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Invalid purge ledger'); return value;
  });
}
function writeDirective(value: Directive) {
  const dir = ledgerDirectory(), filename = path.join(dir, `${value.stableId}.json`), temp = filename + '.tmp';
  if (fs.existsSync(filename)) { const prior = JSON.parse(fs.readFileSync(filename, 'utf8')) as Directive; value = { ...value, at: prior.at, media: [...new Set([...prior.media, ...value.media])] }; }
  const fd = fs.openSync(temp, 'w', 0o600); try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, filename);
}
export async function assertPurgeLedger(payload: Payload) {
  if (process.env.PAYLOAD_MIGRATING === 'true') return;
  const root = ledgerDirectory();
  const restored = new URL(process.env.DATABASE_URL!).pathname.endsWith('_restore');
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    const { rows } = await payload.db.pool.query("SELECT count(*)::int AS count FROM community.contents WHERE visibility::text='purged'");
    if (restored || rows[0].count) throw new Error('Purge ledger missing; refusing to open restored content.');
    fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'manifest.json'), '{"version":1}', { mode: 0o600 });
  }
  if (process.env.PURGE_REPLAY === 'true') return;
  for (const item of directives()) {
    const { rows } = await payload.db.pool.query('SELECT visibility FROM community.contents WHERE stable_id=$1', [item.stableId]);
    if (rows[0] && rows[0].visibility !== 'purged') throw new Error('Pending purge directive; replay in isolation before serving content.');
  }
}

async function purgeScope(req: PayloadRequest, id: number) {
  const payload = req.payload, content = await payload.findByID({ collection: 'contents', id, req, depth: 0, overrideAccess: true });
  const groups = []; for (const collection of ['drafts', 'submissions', 'snapshots', 'annotations', 'quotes']) groups.push(await all(payload, collection, { content: { equals: id } }, req));
  const [drafts, submissions, snapshots, annotations, quotes] = groups;
  const ids = [...new Set([...drafts, ...submissions, ...snapshots].flatMap(doc => doc.mediaIds || []))].map(Number).sort((a, b) => a - b);
  const media = ids.length ? await all(payload, 'media', { id: { in: ids } }, req) : [];
  const others = [];
  if (ids.length) for (const collection of ['drafts', 'submissions', 'snapshots']) for (const row of await all(payload, collection, { and: [{ content: { not_equals: id } }, { mediaRefs: { in: ids } }] }, req)) others.push({ collection, id: row.id, content: row.content });
  const versions = await txDB(req).execute(sql`SELECT count(*)::int AS count FROM community._drafts_v WHERE version_content_id = ${id}`);
  const counts = { drafts: drafts.length, versions: versions.rows[0].count, submissions: submissions.length, snapshots: snapshots.length, annotations: annotations.length, quotes: quotes.length, media: ids.length, sharedReferences: others.length };
  const token = createHash('sha256').update(JSON.stringify({ stableId: content.stableId, updatedAt: content.updatedAt, counts, media: media.map(m => [m.id, m.bodyHash]), drafts: drafts.map(d => [d.id, d.revision]), submissions: submissions.map(s => [s.id, s.status]) })).digest('hex');
  return { content, media, counts, token };
}
export async function purgePreview(payload: Payload, user: Actor, id: number) {
  return transaction(payload, user, id, async (req, actor) => { await manager(req, actor); const result = await purgeScope(req, id); return { contentId: id, stableId: result.content.stableId, counts: result.counts, token: result.token, manualReview: '无结构化关联的手工摘抄、外部导出和历史备份须人工核查；共享图片引用须先解决。' }; }, true);
}
async function scrub(req: PayloadRequest, id: number, mediaIds: number[]) {
  const db = txDB(req);
  await db.execute(sql`DELETE FROM community._drafts_v WHERE version_content_id=${id}`);
  await db.execute(sql`DELETE FROM community.annotations WHERE content_id=${id}`);
  await db.execute(sql`UPDATE community.quotes SET text='[已清除]', attribution='[已清除]', source_url=NULL, enabled=false, import_state=NULL WHERE content_id=${id}`);
  await db.execute(sql`DELETE FROM community.home_rels WHERE contents_id=${id}`);
  for (const table of ['drafts', 'submissions', 'snapshots']) {
    const name = sql.raw(`community.${table}`);
    await db.execute(sql`UPDATE ${name} SET title='[已清除]', markdown='[已清除]', metadata='{}'::jsonb, media_ids='[]'::jsonb, media_manifest='[]'::jsonb WHERE content_id=${id}`);
    await db.execute(sql`DELETE FROM ${sql.raw(`community.${table}_rels`)} WHERE parent_id IN (SELECT id FROM ${name} WHERE content_id=${id})`);
  }
  await db.execute(sql`UPDATE community.snapshots SET summary='', html='', plain_text='', body_hash='', renderer_version='purged' WHERE content_id=${id}`);
  await db.execute(sql`UPDATE community.submissions SET reason=NULL, request_key=NULL, decision_key=NULL, status=CASE WHEN status='pending' THEN 'withdrawn'::community.enum_submissions_status ELSE status END WHERE content_id=${id}`);
  await db.execute(sql`UPDATE community.content_events SET reason='[已清除]', internal_note=NULL WHERE content_id=${id}`);
  await db.execute(sql`UPDATE community.contents SET visibility='purged', slug='purged-' || stable_id, import_state=NULL, updated_at=now() WHERE id=${id}`);
  for (const mediaId of mediaIds) {
    const media = await req.payload.findByID({ collection: 'media', id: mediaId, req, depth: 0, overrideAccess: true });
    if (media.purged) continue;
    const files = [media.filename, ...Object.values(media.sizes || {}).map((size: any) => size.filename)].filter(Boolean);
    await req.payload.create({ collection: 'media-cleanup', data: { media: mediaId, files, status: 'pending' }, req, overrideAccess: true });
    await req.payload.update({ collection: 'media', id: mediaId, data: { purged: true, alt: '[已清除]', origin: null }, req, overrideAccess: true });
  }
}
export async function purgeContent(payload: Payload, user: Actor, id: number, input: Record<string, unknown>) {
  const reason = requiredText(input.reason, 1000);
  if (input.confirm !== '永久清除') throw new APIError('请输入“永久清除”确认不可恢复操作。', 400);
  await transaction(payload, user, id, async (req, actor) => {
    await manager(req, actor); const scope = await purgeScope(req, id);
    if (input.token !== scope.token) throw new APIError('清除范围已变化，请重新预检。', 409);
    if (scope.counts.sharedReferences) throw new APIError('存在范围外媒体引用，须先解决引用后再清除。', 409);
    writeDirective({ stableId: scope.content.stableId, media: scope.media.map(m => m.stableId), at: new Date().toISOString() });
    await scrub(req, id, scope.media.map(m => Number(m.id)));
    await audit(req, actor, id, 'purged', { reason: '[清除理由已随敏感上下文清除]', internalNote: null });
    // The reason is validated but deliberately not persisted: it may repeat the sensitive text.
    void reason;
  }, true);
  return cleanupMedia(payload, user);
}
export async function cleanupMedia(payload: Payload, user: Actor) {
  return transaction(payload, user, 0, async (req, actor) => {
    await manager(req, actor);
    const jobs = await all(payload, 'media-cleanup', { status: { equals: 'pending' } }, req);
    let done = 0;
    const root = fs.realpathSync(path.resolve(process.env.MEDIA_ROOT || 'storage/media'));
    for (const job of jobs) {
      try {
        for (const collection of ['drafts', 'submissions', 'snapshots']) if ((await payload.count({ collection, where: { mediaRefs: { contains: Number(job.media) } }, req, overrideAccess: true })).totalDocs) throw new Error('Referenced media');
        for (const filename of job.files as string[]) {
          if (path.basename(filename) !== filename) throw new Error('Unsafe media path');
          const target = path.resolve(root, filename); if (!target.startsWith(root + path.sep)) throw new Error('Unsafe media path');
          if (fs.existsSync(target)) { const resolved = fs.realpathSync(target); if (!resolved.startsWith(root + path.sep)) throw new Error('Unsafe media path'); fs.unlinkSync(resolved); }
        }
        await payload.update({ collection: 'media-cleanup', id: job.id, data: { status: 'done', error: null }, req, overrideAccess: true }); done++;
      } catch { await payload.update({ collection: 'media-cleanup', id: job.id, data: { error: '文件清理未完成，修复文件权限或引用后可重试。' }, req, overrideAccess: true }); }
    }
    return { status: done === jobs.length ? 'done' : 'pending', completed: done, pending: jobs.length - done };
  }, true);
}
export async function replayPurges(payload: Payload, user: Actor) {
  for (const directive of directives()) {
    const found = await payload.find({ collection: 'contents', where: { stableId: { equals: directive.stableId } }, limit: 1, depth: 0, overrideAccess: true });
    if (!found.docs[0]) continue;
    const id = Number(found.docs[0].id);
    await transaction(payload, user, id, async (req, actor) => {
      await manager(req, actor);
      const scope = await purgeScope(req, id);
      if (scope.counts.sharedReferences) throw new Error('Purge replay found shared media references; restored service must remain isolated.');
      const media = await all(payload, 'media', { stableId: { in: directive.media } }, req);
      await scrub(req, id, media.map(m => Number(m.id)));
    }, true);
  }
  await cleanupMedia(payload, user);
  const replayFlag = process.env.PURGE_REPLAY; delete process.env.PURGE_REPLAY;
  try { await assertPurgeLedger(payload); } finally { if (replayFlag) process.env.PURGE_REPLAY = replayFlag; }
}
