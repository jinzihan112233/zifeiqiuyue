import { APIError, getPayload } from 'payload';
import config from '@payload-config';
import { currentActor } from '../../../../modules/access';
import { changeAccount, createInvitation, recover, register, revokeInvitation, sameOrigin } from '../../../../modules/accounts';
import { positiveId } from '../../../../modules/community';
import { bodyBytes } from '../../../../modules/http-body';

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
      if (action === 'session') return json({ user: actor ? { id: actor.id, username: actor.username, nickname: actor.nickname, role: actor.role, recoveryNeedsSave: !(actor as unknown as { recoveryConfirmed: boolean }).recoveryConfirmed } : null });
      if (action === 'public-user') {
        const user = await payload.findByID({ collection: 'users', id: positiveId(id), depth: 0, overrideAccess: true, disableErrors: true });
        if (!user || user.status !== 'active') throw new APIError('用户不可用。', 404);
        return json({ nickname: user.nickname });
      }
      if (!actor) throw new APIError('请先登录。', 401);
      const params = new URL(request.url).searchParams;
      const page = Math.min(100000, positiveId(params.get('page') || 1));
      if (action === 'invitations') {
        if (actor.role !== 'admin') throw new APIError('没有操作权限。', 403);
        const found = await payload.find({ collection: 'invitations', page, limit: 20, sort: '-createdAt', depth: 0, overrideAccess: true });
        const uses = await payload.find({ collection: 'invitation-uses', where: { invitation: { in: found.docs.map(doc => doc.id) } }, limit: 2000, depth: 0, overrideAccess: true });
        return json({ page: found.page, totalPages: found.totalPages, docs: found.docs.map(doc => ({ id: doc.id, maxUses: doc.maxUses, used: doc.used, expiresAt: doc.expiresAt, revoked: doc.revoked, uses: uses.docs.filter(use => use.invitation === doc.id).map(use => ({ userId: use.user, createdAt: use.createdAt })) })) });
      }
      if (action === 'activity') {
        const type = params.get('type') || 'drafts';
        if (!['drafts', 'submissions', 'contents', 'annotations'].includes(type)) throw new APIError('分类无效。', 400);
        const found = await payload.find({ collection: type, where: { author: { equals: actor.id } }, page, limit: 10, sort: '-updatedAt', depth: 0, overrideAccess: true });
        return json({ page: found.page, totalPages: found.totalPages, docs: found.docs.map(doc => ({ id: doc.id, title: doc.title, slug: doc.slug, status: doc.status || doc.visibility, reason: doc.reason, quote: doc.quote, body: doc.body, content: doc.content, updatedAt: doc.updatedAt, href: type === 'contents' && doc.visibility === 'public' ? `/${doc.kind === 'article' ? 'articles' : 'posts'}/${doc.slug}` : type === 'submissions' ? `/workspace/review/${doc.content}?submission=${doc.id}` : `/workspace/edit/${doc.content || doc.id}` })) });
      }
      throw new APIError('操作不存在。', 404);
    }
    const raw = (await bodyBytes(request, 8192)).toString('utf8');
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new APIError('请求无效。', 400);
    if (action === 'register') return json(await register(payload, input), 201);
    if (action === 'recover') return json(await recover(payload, input));
    if (!actor) throw new APIError('请先登录。', 401);
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
