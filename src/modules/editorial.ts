import { APIError, type Payload, type PayloadRequest } from 'payload';
import { transaction, positiveId, requiredText } from './community';
import { currentActor, type Actor } from './access';
import { webURL } from './content-format';

export async function requireEditor(payload: Payload, user: Actor, req?: PayloadRequest) {
  const actor = await currentActor(payload, user, req);
  if (!actor || !['editor', 'admin'].includes(actor.role)) throw new APIError('需要编辑或管理员权限。', 403);
  return actor;
}
export async function saveQuote(payload: Payload, user: Actor, input: Record<string, unknown>) {
  return transaction(payload, user, 0, async (req, actor) => {
    await requireEditor(payload, actor, req);
    const stableId = requiredText(input.stableId, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(stableId)) throw new APIError('金句标识无效。', 400);
    const content = input.content ? positiveId(input.content) : null;
    const snapshot = input.snapshot ? positiveId(input.snapshot) : null;
    if (!!content !== !!snapshot) throw new APIError('关联金句须同时选择文章和发布版本。', 400);
    if (content && snapshot) {
      const parent = await payload.findByID({ collection: 'contents', id: content, depth: 0, overrideAccess: true, req });
      const version = await payload.findByID({ collection: 'snapshots', id: snapshot, depth: 0, overrideAccess: true, req });
      if (parent.visibility !== 'public' || Number(version.content) !== content) throw new APIError('只能关联公开内容的有效发布版本。', 400);
    }
    if (typeof input.demo !== 'boolean' || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.order)) throw new APIError('金句标识或排序无效。', 400);
    const data = { stableId, text: requiredText(input.text, 5000), attribution: requiredText(input.attribution, 200), sourceUrl: webURL(input.sourceUrl), demo: input.demo, order: input.order, enabled: input.enabled, content, snapshot };
    const existing = (await payload.find({ collection: 'quotes', where: { stableId: { equals: stableId } }, req, overrideAccess: true, depth: 0 })).docs[0];
    return existing ? payload.update({ collection: 'quotes', id: existing.id, data, req, overrideAccess: true }) : payload.create({ collection: 'quotes', data, req, overrideAccess: true });
  });
}
export async function saveHome(payload: Payload, user: Actor, input: Record<string, unknown>) {
  return transaction(payload, user, 0, async (req, actor) => {
    await requireEditor(payload, actor, req);
    if (!Array.isArray(input.featured) || input.featured.length > 20) throw new APIError('推荐须为不超过 20 项的列表。', 400);
    const featured = input.featured.map(positiveId);
    if (new Set(featured).size !== featured.length) throw new APIError('推荐不能重复。', 400);
    for (const id of featured) {
      const record = await payload.findByID({ collection: 'contents', id, req, depth: 0, overrideAccess: true });
      if (record.kind !== 'article' || record.visibility !== 'public' || !record.currentSnapshot) throw new APIError('推荐只能选择已公开的站方文章。', 400);
    }
    const data = { key: 'home', introduction: requiredText(input.introduction, 1000), featured };
    const existing = (await payload.find({ collection: 'home', where: { key: { equals: 'home' } }, req, depth: 0, overrideAccess: true })).docs[0];
    return existing ? payload.update({ collection: 'home', id: existing.id, data, req, overrideAccess: true }) : payload.create({ collection: 'home', data, req, overrideAccess: true });
  });
}
export { readHome as publicHome } from './public-reading';
