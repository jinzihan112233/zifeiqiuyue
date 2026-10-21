import { APIError, type CollectionConfig, type Where } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { randomUUID } from 'node:crypto';
import { defaultMetadata } from '../modules/content-format';
import { adminAccess, currentActor, guardWrite, isTrustedWrite, ownerAccess, publicMediaIds } from '../modules/access';
import { loginGuard, username, password, nickname } from '../modules/accounts';

const author = { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true } as const;
const content = { name: 'content', type: 'relationship', relationTo: 'contents', required: true, index: true } as const;
const textFields = [
  { name: 'title', type: 'text', required: true, maxLength: 200 },
  { name: 'markdown', type: 'textarea', required: true, maxLength: 50000 },
  { name: 'mediaIds', type: 'json', defaultValue: [] },
  { name: 'mediaRefs', type: 'relationship', relationTo: 'media', hasMany: true },
  { name: 'mediaManifest', type: 'json', defaultValue: [] },
  { name: 'metadata', type: 'json', defaultValue: defaultMetadata },
] satisfies CollectionConfig['fields'];
const protectedHooks: CollectionConfig['hooks'] = { beforeChange: [guardWrite], beforeDelete: [guardWrite] };
const denied = () => false;
const protectedAccess = { create: denied, update: denied, delete: denied };

export const Users: CollectionConfig = {
  slug: 'users',
  auth: { loginWithUsername: { requireEmail: false, allowEmailLogin: false }, useSessions: true, removeTokenFromResponses: true, tokenExpiration: 3600, maxLoginAttempts: 5, lockTime: 300000, cookies: { secure: process.env.APP_ORIGIN?.startsWith('https://') || false, sameSite: 'Lax' } },
  admin: { useAsTitle: 'username' },
  access: {
    admin: async ({ req }) => { const actor = await currentActor(req.payload, req.user, req); return !!actor && ['admin', 'editor'].includes(actor.role); },
    create: denied, update: adminAccess, delete: denied,
    read: async ({ req }) => { const actor = await currentActor(req.payload, req.user, req); return actor?.role === 'admin' ? true : actor ? { id: { equals: actor.id } } : false; },
  },
  hooks: {
    beforeOperation: loginGuard,
    afterRead: [({ doc }) => { delete doc.recoveryHash; return doc; }],
    beforeLogin: [({ user }) => { if (user.status !== 'active') throw new APIError('账号或密码错误，或账号暂不可用。', 401); return user; }],
    beforeChange: [async ({ req, data, originalDoc, operation }) => {
      if (operation === 'create' && !isTrustedWrite(req)) throw new APIError('请使用邀请码注册。', 403);
      if (data.username !== undefined) {
        data.username = username(data.username);
        if (operation === 'update' && data.username !== originalDoc.username) throw new APIError('账号名称不能修改。', 400);
      }
      if (data.password !== undefined) password(data.password);
      if (data.nickname !== undefined) data.nickname = nickname(data.nickname);
      if (!isTrustedWrite(req)) {
        if (data.password !== undefined) throw new APIError('请通过账号安全页面修改密码。', 403);
        const id = await req.transactionID;
        if (!id) throw new APIError('账号更新需要数据库事务。', 500);
        const sessions = req.payload.db.sessions as Record<string, { db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> } }>;
        await sessions[String(id)].db.execute(sql`SELECT pg_advisory_xact_lock(97124, 0)`);
        if (!await adminAccess({ req })) throw new APIError('禁止创建或修改账号。', 403);
      }
      if (originalDoc?.role === 'admin' && (data.role && data.role !== 'admin' || data.status === 'banned')) {
        const others = await req.payload.count({ collection: 'users', where: { and: [{ role: { equals: 'admin' } }, { status: { equals: 'active' } }, { id: { not_equals: originalDoc.id } }] }, overrideAccess: true, req });
        if (!others.totalDocs) throw new APIError('不能移除最后一个管理员。', 409);
      }
      if (data.status === 'banned' || data.password || originalDoc && data.role && data.role !== originalDoc.role) data.sessions = [];
      return data;
    }],
  },
  fields: [
    { name: 'nickname', type: 'text', required: true },
    { name: 'recoveryHash', type: 'text', hidden: true, access: { read: denied, create: denied, update: denied } },
    { name: 'recoveryConfirmed', type: 'checkbox', defaultValue: false, access: { create: denied, update: denied } },
    { name: 'role', type: 'select', required: true, defaultValue: 'member', options: ['member', 'editor', 'admin'] },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: ['active', 'banned'] },
  ],
};

export const Contents: CollectionConfig = {
  slug: 'contents', admin: { useAsTitle: 'slug' }, hooks: protectedHooks,
  indexes: [{ fields: ['kind', 'visibility'] }],
  access: { ...protectedAccess, read: async ({ req }): Promise<boolean | Where> => {
    const actor = await currentActor(req.payload, req.user, req);
    return actor?.role === 'admin' ? true : actor ? { or: [{ visibility: { equals: 'public' } }, { author: { equals: actor.id } }] } : { visibility: { equals: 'public' } };
  } },
  fields: [author, { name: 'discussion', type: 'select', required: true, defaultValue: 'open', options: ['open', 'locked'] }, { name: 'stableId', type: 'text', required: true, unique: true, defaultValue: () => randomUUID() }, { name: 'kind', type: 'select', required: true, defaultValue: 'post', options: ['article', 'post'], index: true }, { name: 'slug', type: 'text', required: true, unique: true }, { name: 'visibility', type: 'select', options: ['unpublished', 'public', 'hidden', 'purged'], required: true, defaultValue: 'unpublished', index: true }, { name: 'currentSnapshot', type: 'relationship', relationTo: 'snapshots' }, { name: 'importState', type: 'json', access: { read: denied } }],
};
export const Drafts: CollectionConfig = {
  slug: 'drafts', access: { ...protectedAccess, read: ownerAccess, readVersions: async ({ req }): Promise<boolean | Where> => {
    const actor = await currentActor(req.payload, req.user, req);
    return actor?.role === 'admin' ? true : actor ? { 'version.author': { equals: actor.id } } : false;
  } }, hooks: protectedHooks,
  versions: { maxPerDoc: 10 },
  fields: [author, { ...content, unique: true }, ...textFields, { name: 'revision', type: 'number', required: true, defaultValue: 1 }],
};
export const Submissions: CollectionConfig = {
  slug: 'submissions', access: { ...protectedAccess, read: ownerAccess }, hooks: protectedHooks,
  fields: [author, content, ...textFields, { name: 'requestKey', type: 'text', unique: true }, { name: 'decisionKey', type: 'text' }, { name: 'revision', type: 'number', required: true }, { name: 'status', type: 'select', required: true, defaultValue: 'pending', options: ['pending', 'approved', 'returned', 'withdrawn'], index: true }, { name: 'reviewer', type: 'relationship', relationTo: 'users' }, { name: 'reason', type: 'text' }, { name: 'reviewedAt', type: 'date' }],
};
export const Snapshots: CollectionConfig = {
  slug: 'snapshots', access: { ...protectedAccess, read: async ({ req }) => await adminAccess({ req }) ? true : { 'content.visibility': { equals: 'public' } } }, hooks: protectedHooks,
  fields: [content, { name: 'stableId', type: 'text', required: true, unique: true, defaultValue: () => randomUUID() }, { name: 'publishedAt', type: 'date', required: true, defaultValue: () => new Date().toISOString(), index: true }, { name: 'summary', type: 'textarea' }, { name: 'submission', type: 'relationship', relationTo: 'submissions', unique: true, required: true }, ...textFields, { name: 'html', type: 'textarea', required: true }, { name: 'plainText', type: 'textarea', required: true }, { name: 'rendererVersion', type: 'text', required: true }, { name: 'bodyHash', type: 'text', required: true }],
};
export const Media: CollectionConfig = {
  slug: 'media', hooks: protectedHooks,
  access: { ...protectedAccess, read: async ({ req }): Promise<boolean | Where> => {
    const actor = await currentActor(req.payload, req.user, req);
    if (actor?.role === 'admin') return { purged: { not_equals: true } };
    const ids = await publicMediaIds(req.payload);
    return { and: [{ purged: { not_equals: true } }, actor ? { or: [{ owner: { equals: actor.id } }, { id: { in: ids } }] } : { id: { in: ids } }] };
  } },
  upload: { staticDir: process.env.MEDIA_ROOT || 'storage/media', mimeTypes: ['image/webp'], formatOptions: { format: 'webp', options: { lossless: true } }, imageSizes: [{ name: 'thumb', width: 320, withoutEnlargement: true }], adminThumbnail: 'thumb' },
  fields: [{ name: 'stableId', type: 'text', required: true, unique: true, defaultValue: () => randomUUID() }, { name: 'owner', type: 'relationship', relationTo: 'users', required: true }, { name: 'alt', type: 'text', required: true }, { name: 'bodyHash', type: 'text', required: true }, { name: 'purged', type: 'checkbox', defaultValue: false }, { name: 'origin', type: 'json', access: { read: denied } }],
};
export const Annotations: CollectionConfig = {
  indexes: [{ fields: ['snapshot', 'createdAt'] }],
  slug: 'annotations', access: { ...protectedAccess, read: async ({ req }): Promise<boolean | Where> => await adminAccess({ req }) ? true : { and: [{ 'content.visibility': { equals: 'public' } }, { 'comment.deleted': { equals: false } }, { 'comment.moderation': { equals: 'visible' } }] } },
  hooks: { ...protectedHooks, afterRead: [async ({ doc, req }) => {
    const id = typeof doc.comment === 'object' ? doc.comment?.id : doc.comment;
    const comment = id ? await req.payload.findByID({ collection: 'comments', id, req, overrideAccess: true, depth: 0, disableErrors: true }) : null;
    doc.body = comment && !comment.deleted && comment.moderation === 'visible' ? comment.body : '';
    return doc;
  }] },
  fields: [author, content, { name: 'comment', type: 'relationship', relationTo: 'comments', required: true, unique: true }, { name: 'snapshot', type: 'relationship', relationTo: 'snapshots', required: true }, { name: 'start', type: 'number', required: true }, { name: 'end', type: 'number', required: true }, { name: 'quote', type: 'textarea', required: true }, { name: 'prefix', type: 'text' }, { name: 'suffix', type: 'text' }, { name: 'body', type: 'textarea', virtual: true }],
};
export const Quotes: CollectionConfig = {
  slug: 'quotes', hooks: protectedHooks, access: { ...protectedAccess, read: async ({ req }): Promise<boolean | Where> => await adminAccess({ req }) ? true : { and: [{ enabled: { equals: true } }, { or: [{ content: { exists: false } }, { 'content.visibility': { equals: 'public' } }] }] } },
  fields: [{ name: 'stableId', type: 'text', required: true, unique: true }, { name: 'text', type: 'textarea', required: true, maxLength: 5000 }, { name: 'attribution', type: 'text', required: true }, { ...content, required: false }, { name: 'snapshot', type: 'relationship', relationTo: 'snapshots' }, { name: 'sourceUrl', type: 'text' }, { name: 'demo', type: 'checkbox', defaultValue: true }, { name: 'order', type: 'number', required: true }, { name: 'enabled', type: 'checkbox', defaultValue: true }, { name: 'importState', type: 'json', access: { read: denied } }],
};
export const Home: CollectionConfig = {
  slug: 'home', hooks: protectedHooks, access: { ...protectedAccess, read: async ({ req }) => ['editor', 'admin'].includes((await currentActor(req.payload, req.user, req))?.role || '') },
  fields: [{ name: 'key', type: 'text', required: true, unique: true }, { name: 'introduction', type: 'textarea', required: true }, { name: 'featured', type: 'relationship', relationTo: 'contents', hasMany: true }, { name: 'importState', type: 'json', access: { read: denied } }],
};
const privateAccess = { ...protectedAccess, read: denied };
export const Invitations: CollectionConfig = {
  slug: 'invitations', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  fields: [{ name: 'codeHash', type: 'text', required: true, unique: true, hidden: true }, { name: 'maxUses', type: 'number', required: true }, { name: 'used', type: 'number', required: true, defaultValue: 0 }, { name: 'expiresAt', type: 'date', required: true }, { name: 'revoked', type: 'checkbox', defaultValue: false }, { name: 'creator', type: 'relationship', relationTo: 'users', required: true }],
};
export const InvitationUses: CollectionConfig = {
  slug: 'invitation-uses', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  fields: [{ name: 'invitation', type: 'relationship', relationTo: 'invitations', required: true }, { name: 'user', type: 'relationship', relationTo: 'users', required: true, unique: true }],
};
export const AuthLimits: CollectionConfig = {
  slug: 'auth-limits', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  fields: [{ name: 'bucket', type: 'text', required: true, unique: true }, { name: 'count', type: 'number', required: true }, { name: 'expiresAt', type: 'date', required: true, index: true }],
};
export const ContentEvents: CollectionConfig = {
  slug: 'content-events', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  indexes: [{ fields: ['content', 'createdAt'] }],
  fields: [content, { name: 'actor', type: 'relationship', relationTo: 'users', required: true }, { name: 'action', type: 'text', required: true }, { name: 'target', type: 'number' }, { name: 'reason', type: 'text', maxLength: 1000 }, { name: 'internalNote', type: 'text', maxLength: 1000 }, { name: 'selfPublished', type: 'checkbox' }, { name: 'delegated', type: 'checkbox' }],
};
export const MediaCleanup: CollectionConfig = {
  slug: 'media-cleanup', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  fields: [{ name: 'media', type: 'relationship', relationTo: 'media', required: true, unique: true }, { name: 'files', type: 'json', required: true }, { name: 'status', type: 'select', options: ['pending', 'done'], defaultValue: 'pending', required: true }, { name: 'error', type: 'text' }],
};
// Public discussion reads use a projection so hidden bodies cannot leak through generic CRUD or relationship expansion.
export const Comments: CollectionConfig = {
  slug: 'comments', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  indexes: [{ fields: ['content', 'root', 'createdAt'] }],
  fields: [author, content, { name: 'parent', type: 'relationship', relationTo: 'comments' }, { name: 'root', type: 'relationship', relationTo: 'comments' }, { name: 'body', type: 'textarea', required: true, maxLength: 5000 }, { name: 'revision', type: 'number', defaultValue: 1, required: true }, { name: 'editedAt', type: 'date' }, { name: 'deleted', type: 'checkbox', defaultValue: false, required: true }, { name: 'moderation', type: 'select', options: ['visible', 'hidden'], defaultValue: 'visible', required: true }, { name: 'requestKey', type: 'text', unique: true }, { name: 'requestHash', type: 'text' }],
};
export const Reports: CollectionConfig = {
  slug: 'reports', admin: { hidden: true }, access: privateAccess, hooks: protectedHooks,
  indexes: [{ fields: ['status', 'createdAt'] }],
  fields: [content, { name: 'comment', type: 'relationship', relationTo: 'comments' }, { name: 'reporter', type: 'relationship', relationTo: 'users', required: true }, { name: 'reason', type: 'textarea', required: true, maxLength: 1000 }, { name: 'status', type: 'select', options: ['pending', 'resolved', 'dismissed'], required: true, defaultValue: 'pending' }, { name: 'revision', type: 'number', defaultValue: 1, required: true }, { name: 'resolver', type: 'relationship', relationTo: 'users' }, { name: 'resolution', type: 'text' }, { name: 'resolvedAt', type: 'date' }],
};
export const collections = [Users, Contents, Drafts, Submissions, Snapshots, Media, Annotations, Quotes, Home, Invitations, InvitationUses, AuthLimits, ContentEvents, MediaCleanup, Comments, Reports];
