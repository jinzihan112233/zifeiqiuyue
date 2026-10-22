import { APIError, getPayload } from 'payload';
import config from '@payload-config';
import { currentActor } from '../../../../modules/access';
import { changeAccount, changeUserTag, createInvitation, recover, register, revokeInvitation, sameOrigin } from '../../../../modules/accounts';
import { positiveId } from '../../../../modules/community';
import { bodyBytes } from '../../../../modules/http-body';
import { ownComments } from '../../../../modules/discussion';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function route(request: Request, context: { params: Promise<{ action: string[] }> }) {
  try {
    const { action: [action, id] } = await context.params;
    if (request.method !== 'GET') sameOrigin(request.headers);
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: request.headers });
    const actor = await currentActor(payload, user);
    if (request.method === 'GET') {
      if (action === 'session') return json({ user: actor ? { id: actor.id, username: actor.username, nickname: actor.nickname, role: actor.role, tag: actor.tag, recoveryNeedsSave: !(actor as unknown as { recoveryConfirmed: boolean }).recoveryConfirmed } : null });
      if (action === 'public-user') {
        const user = await payload.findByID({ collection: 'users', id: positiveId(id), depth: 0, overrideAccess: true, disableErrors: true });
        if (!user || user.status !== 'active') throw new APIError('用户不可用。', 404);
        return json({ nickname: user.nickname, tag: user.tag });
      }
      if (!actor) throw new APIError('请先登录。', 401);
      const params = new URL(request.url).searchParams;
      const page = Math.min(100000, positiveId(params.get('page') || 1));
      if (action === 'users') {
        if (actor.role !== 'admin') throw new APIError('没有操作权限。', 403);
        const found = await payload.find({ collection: 'users', page, limit: 20, sort: 'username', depth: 0, overrideAccess: true });
        return json({ page: found.page, totalPages: found.totalPages, docs: found.docs.map(doc => ({ id: doc.id, username: doc.username, nickname: doc.nickname, tag: doc.tag })) });
      }
      if (action === 'invitations') {
        if (actor.role !== 'admin') throw new APIError('没有操作权限。', 403);
        const found = await payload.find({ collection: 'invitations', page, limit: 20, sort: '-createdAt', depth: 0, overrideAccess: true });
        const uses = await payload.find({ collection: 'invitation-uses', where: { invitation: { in: found.docs.map(doc => doc.id) } }, limit: 2000, depth: 0, overrideAccess: true });
        return json({ page: found.page, totalPages: found.totalPages, docs: found.docs.map(doc => ({ id: doc.id, maxUses: doc.maxUses, used: doc.used, expiresAt: doc.expiresAt, revoked: doc.revoked, tag: doc.tag, uses: uses.docs.filter(use => use.invitation === doc.id).map(use => ({ userId: use.user, createdAt: use.createdAt })) })) });
      }
      if (action === 'activity') {
        const type = params.get('type') || 'drafts';
        if (type === 'comments') return json(await ownComments(payload, actor, params.get('page')));
        if (!['drafts', 'submissions', 'contents', 'annotations'].includes(type)) throw new APIError('分类无效。', 400);
        const found = await payload.find({ collection: type, where: { and: [{ author: { equals: actor.id } }, ...(type === 'annotations' ? [{ 'content.visibility': { equals: 'public' } }, { 'comment.deleted': { equals: false } }, { 'comment.moderation': { equals: 'visible' } }] : [])] }, page, limit: 10, sort: '-updatedAt', depth: 0, overrideAccess: true });
        if (type === 'annotations') {
          const docs = await Promise.all(found.docs.map(async note => {
            const content = await payload.findByID({ collection: 'contents', id: Number(note.content), depth: 0, overrideAccess: true });
            const snapshot = await payload.findByID({ collection: 'snapshots', id: Number(note.snapshot), depth: 0, overrideAccess: true });
            return { id: note.id, quote: note.quote, body: note.body, status: 'public', updatedAt: note.updatedAt, href: `/${content.kind === 'article' ? 'articles' : 'posts'}/${content.slug}?version=${encodeURIComponent(snapshot.stableId)}&annotation=${note.id}&thread=${note.comment}#discussion` };
          }));
          return json({ page: found.page, totalPages: found.totalPages, docs });
        }
        return json({ page: found.page, totalPages: found.totalPages, docs: found.docs.map(doc => ({ id: doc.id, title: doc.title, slug: doc.slug, status: doc.status || doc.visibility, reason: doc.reason, quote: doc.quote, body: doc.body, content: doc.content, updatedAt: doc.updatedAt, href: type === 'contents' && doc.visibility === 'public' ? `/${doc.kind === 'article' ? 'articles' : 'posts'}/${doc.slug}` : type === 'submissions' ? `/workspace/review/${doc.content}?submission=${doc.id}` : `/workspace/edit/${doc.content || doc.id}` })) });
      }
      throw new APIError('操作不存在。', 404);
    }
    const raw = (await bodyBytes(request, 8192)).toString('utf8');
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new APIError('请求无效。', 400);
    if (action === 'register') return json(await register(payload, input, request.headers), 201);
    if (action === 'recover') return json(await recover(payload, input, request.headers));
    if (!actor) throw new APIError('请先登录。', 401);
    if (action === 'user-tag' && id) return json(await changeUserTag(payload, actor, positiveId(id), input.tag));
    if (action === 'invitations') return json(id ? await revokeInvitation(payload, actor, positiveId(id)) : await createInvitation(payload, actor, input));
    if (['nickname', 'password', 'recovery', 'confirm-recovery'].includes(action)) return json(await changeAccount(payload, actor, action, input));
    throw new APIError('操作不存在。', 404);
  } catch (error) {
    const status = error instanceof APIError ? error.status : error instanceof SyntaxError ? 400 : 500;
    return json({ error: error instanceof APIError ? error.message : status === 400 ? '请求格式无效。' : '操作未完成，请稍后重试。' }, status);
  }
}
export const GET = route;
export const POST = route;
