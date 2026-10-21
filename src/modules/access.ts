import { APIError, type Payload, type PayloadRequest, type Where } from 'payload';

export type Actor = { id: number; username: string; nickname: string; role: 'member' | 'editor' | 'admin'; status: 'active' | 'banned'; collection: 'users'; _sid?: string };
const writeToken = Symbol('community-write');
export const writeContext = () => ({ communityWrite: writeToken });
export const isTrustedWrite = (req: PayloadRequest) => req.context.communityWrite === writeToken;

export async function currentActor(payload: Payload, user: unknown, req?: PayloadRequest): Promise<Actor | null> {
  const id = (user as { id?: number } | null)?.id;
  if (!id) return null;
  const record = await payload.findByID({ collection: 'users', id, overrideAccess: true, depth: 0, disableErrors: true, req });
  const sid = (user as { _sid?: string } | null)?._sid;
  if (sid && !record?.sessions?.some((session: { id: string; expiresAt: string }) => session.id === sid && +new Date(session.expiresAt) > Date.now())) return null;
  return record && record.status === 'active' ? { ...record, id: Number(record.id), collection: 'users', ...(sid ? { _sid: sid } : {}) } as Actor : null;
}

export async function adminAccess({ req }: { req: PayloadRequest }) {
  return (await currentActor(req.payload, req.user, req))?.role === 'admin';
}

export async function ownerAccess({ req }: { req: PayloadRequest }): Promise<boolean | Where> {
  const actor = await currentActor(req.payload, req.user, req);
  if (!actor) return false;
  return actor.role === 'admin' ? true : { author: { equals: actor.id } };
}

export function guardWrite({ req }: { req: PayloadRequest }) {
  if (!isTrustedWrite(req)) throw new APIError('请通过受控业务操作修改数据。', 403);
}

export async function publicMediaIds(payload: Payload) {
  const ids = new Set<number>();
  let page = 1, more = true;
  while (more) {
    const snapshots = await payload.find({ collection: 'snapshots', where: { 'content.visibility': { equals: 'public' } }, page, limit: 200, depth: 0, overrideAccess: true });
    for (const doc of snapshots.docs) for (const id of (doc.mediaRefs || []) as number[]) ids.add(Number(id));
    more = snapshots.hasNextPage; page++;
  }
  return [...ids];
}
