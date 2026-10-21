import { createHash, randomBytes, pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { APIError, createLocalReq, loginOperation, refreshOperation, type Payload, type PayloadRequest, type CollectionConfig } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { currentActor, writeContext, type Actor } from './access';
import { clientAddress } from './deployment';

const derive = promisify(pbkdf2);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secretCode = () => randomBytes(32).toString('base64url');
export function username(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(value)) throw new APIError('账号须为 3–24 位字母、数字或下划线。', 400);
  return value.toLowerCase();
}
export function password(value: unknown) {
  if (typeof value !== 'string' || [...value].length < 12 || [...value].length > 128) throw new APIError('密码须为 12–128 个字符。', 400);
  return value;
}
export function nickname(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 30) throw new APIError('昵称须为 1–30 个字符。', 400);
  return value.trim();
}
export function sameOrigin(headers: Headers) {
  if (headers.get('origin') !== new URL(process.env.APP_ORIGIN!).origin) throw new APIError('请从本站提交操作。', 403);
}
export async function limit(payload: Payload, key: string, max: number, seconds: number) {
  const pool = payload.db.pool;
  await pool.query('DELETE FROM community.auth_limits WHERE expires_at < now()');
  const { rows } = await pool.query(`INSERT INTO community.auth_limits (bucket, count, expires_at, created_at, updated_at)
    VALUES ($1, 1, now() + $2 * interval '1 second', now(), now())
    ON CONFLICT (bucket) DO UPDATE SET count = auth_limits.count + 1, updated_at = now() RETURNING count`, [digest(key), seconds]);
  if (Number(rows[0].count) > max) throw new APIError('尝试过于频繁，请稍后再试。', 429);
}
const loginChecked = Symbol('login-checked');
async function checkLogin(payload: Payload, data: { username?: unknown; password?: unknown }, headers?: Headers) {
  await limit(payload, `login:ip:${clientAddress(headers)}`, 30, 900);
  const name = username(data.username);
  await limit(payload, `login:user:${name}`, 10, 900);
  if (typeof data.password !== 'string' || [...data.password].length > 128) throw new APIError('账号或密码错误，或账号暂不可用。', 401);
  data.username = name;
}
export const loginGuard: NonNullable<CollectionConfig['hooks']>['beforeOperation'] = [async ({ operation, args, req }) => {
  if (operation !== 'login' || req.context.loginChecked === loginChecked) return;
  await checkLogin(req.payload, (args as { data: { username?: unknown; password?: unknown } }).data, req.headers);
}];

async function accountTransaction<T>(payload: Payload, run: (req: PayloadRequest) => Promise<T>, user?: Actor) {
  const id = await payload.db.beginTransaction();
  if (id === null) throw new Error('PostgreSQL transactions are required');
  const req = await createLocalReq({ user, context: writeContext() }, payload);
  req.transactionID = id;
  try {
    const sessions = payload.db.sessions as Record<string, { db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> } }>;
    await sessions[String(id)].db.execute(sql`SELECT pg_advisory_xact_lock(97124, 0)`);
    const result = await run(req);
    if (req.transactionID) await payload.db.commitTransaction(id); return result;
  } catch (error) { await payload.db.rollbackTransaction(id); throw error; }
}
export async function signIn(payload: Payload, input: Record<string, unknown>, headers: Headers) {
  try { await checkLogin(payload, input, headers); }
  catch (error) { const status = (error as { status?: number }).status === 429 ? 429 : 401; throw new APIError(status === 429 ? '尝试过于频繁，请稍后再试。' : '账号或密码错误，或账号暂不可用。', status); }
  const result = await accountTransaction(payload, async req => {
    req.headers = headers;
    req.context.loginChecked = loginChecked;
    try {
      return { value: await loginOperation({ collection: payload.collections.users, data: input as never, req, overrideAccess: false }) };
    } catch (error) { return { error }; }
  });
  if ('error' in result) throw new APIError((result.error as { status?: number })?.status === 429 ? '尝试过于频繁，请稍后再试。' : '账号或密码错误，或账号暂不可用。', (result.error as { status?: number })?.status === 429 ? 429 : 401);
  return result.value!;
}
export async function signOut(payload: Payload, user: Actor & { _sid?: string }) {
  return accountTransaction(payload, async req => {
    const raw = await payload.db.findOne({ collection: 'users', where: { id: { equals: user.id } }, req }) as { sessions?: { id: string }[] } | null;
    if (raw) await payload.update({ collection: 'users', id: user.id, data: { sessions: (raw.sessions || []).filter((session: { id: string }) => session.id !== user._sid) }, req, overrideAccess: true });
    return { ok: true };
  }, user);
}
export async function refreshSignIn(payload: Payload, user: Actor & { _sid?: string }) {
  return accountTransaction(payload, async req => {
    const actor = await requireActor(req, user);
    const raw = await payload.db.findOne({ collection: 'users', where: { id: { equals: actor.id } }, req }) as { sessions?: { id: string; expiresAt: string }[] } | null;
    if (!raw?.sessions?.some(session => session.id === user._sid && +new Date(session.expiresAt) > Date.now())) throw new APIError('请重新登录。', 401);
    req.user = { ...actor, _sid: user._sid, _strategy: 'local-jwt' };
    return refreshOperation({ collection: payload.collections.users, req });
  }, user);
}
async function requireActor(req: PayloadRequest, user: Actor, admin = false) {
  const actor = await currentActor(req.payload, user, req);
  if (!actor || admin && actor.role !== 'admin') throw new APIError('没有操作权限。', 403);
  return actor;
}
async function verifyPassword(req: PayloadRequest, id: number, value: unknown) {
  if (typeof value !== 'string' || [...value].length > 128) throw new APIError('当前密码错误。', 401);
  const doc = await req.payload.db.findOne({ collection: 'users', where: { id: { equals: id } }, req }) as { hash?: string; salt?: string } | null;
  const hash = doc?.hash as string, salt = doc?.salt as string;
  if (!hash || !salt) throw new APIError('当前密码错误。', 401);
  // Matches pinned Payload 3.91 PBKDF2 (including legacy hashes); never creates a login session.
  const modern = hash.startsWith('pbkdf2-sha256-v1:');
  const expected = Buffer.from(modern ? hash.slice(17) : hash, 'hex');
  const actual = await derive(value, salt, modern ? 600000 : 25000, modern ? 32 : 512, 'sha256');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new APIError('当前密码错误。', 401);
}
export async function createInvitation(payload: Payload, user: Actor, input: Record<string, unknown>) {
  const uses = Number(input.maxUses), expires = new Date(String(input.expiresAt));
  if (!Number.isSafeInteger(uses) || uses < 1 || uses > 100 || !Number.isFinite(+expires) || +expires <= Date.now()) throw new APIError('请设置 1–100 次使用次数及未来的有效期。', 400);
  return accountTransaction(payload, async req => {
    const actor = await requireActor(req, user, true), code = secretCode();
    const invite = await payload.create({ collection: 'invitations', data: { codeHash: digest(code), maxUses: uses, used: 0, expiresAt: expires.toISOString(), revoked: false, creator: actor.id }, req, overrideAccess: true });
    return { id: invite.id, code };
  }, user);
}
export async function revokeInvitation(payload: Payload, user: Actor, id: number) {
  return accountTransaction(payload, async req => {
    await requireActor(req, user, true);
    await payload.update({ collection: 'invitations', id, data: { revoked: true }, req, overrideAccess: true });
    return { ok: true };
  }, user);
}
export async function register(payload: Payload, input: Record<string, unknown>, headers?: Headers) {
  await limit(payload, `register:ip:${clientAddress(headers)}`, 10, 3600);
  const name = username(input.username), nick = nickname(input.nickname), pass = password(input.password);
  if (pass !== input.confirmPassword) throw new APIError('两次输入的密码不一致。', 400);
  if (typeof input.invitation !== 'string' || !/^[\w-]{43}$/.test(input.invitation)) throw new APIError('注册未完成，请检查账号和邀请码。', 400);
  return accountTransaction(payload, async req => {
    const invitations = await payload.find({ collection: 'invitations', where: { codeHash: { equals: digest(input.invitation as string) } }, limit: 1, depth: 0, req, overrideAccess: true });
    const invitation = invitations.docs[0];
    if (!invitation || invitation.revoked || +new Date(invitation.expiresAt) <= Date.now() || invitation.used >= invitation.maxUses) throw new APIError('注册未完成，请检查账号和邀请码。', 400);
    if ((await payload.count({ collection: 'users', where: { username: { equals: name } }, req, overrideAccess: true })).totalDocs) throw new APIError('注册未完成，请检查账号和邀请码。', 400);
    const code = secretCode();
    const user = await payload.create({ collection: 'users', data: { username: name, nickname: nick, password: pass, role: 'member', status: 'active', recoveryHash: digest(code), recoveryConfirmed: false }, req, overrideAccess: true });
    await payload.update({ collection: 'invitations', id: invitation.id, data: { used: invitation.used + 1 }, req, overrideAccess: true });
    await payload.create({ collection: 'invitation-uses', data: { invitation: invitation.id, user: user.id }, req, overrideAccess: true });
    return { username: name, recoveryCode: code };
  });
}
export async function recover(payload: Payload, input: Record<string, unknown>, headers?: Headers) {
  await limit(payload, `recover:ip:${clientAddress(headers)}`, 10, 3600);
  const name = username(input.username); await limit(payload, `recover:user:${name}`, 5, 3600);
  const pass = password(input.password);
  if (pass !== input.confirmPassword) throw new APIError('两次输入的密码不一致。', 400);
  return accountTransaction(payload, async req => {
    const user = await payload.db.findOne({ collection: 'users', where: { username: { equals: name } }, req }) as { id: number; recoveryHash?: string } | null;
    const expected = typeof user?.recoveryHash === 'string' ? user.recoveryHash : digest('unavailable');
    const actual = digest(typeof input.recoveryCode === 'string' ? input.recoveryCode : '');
    if (!user || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) throw new APIError('账号或恢复码无效。', 400);
    const code = secretCode();
    await payload.update({ collection: 'users', id: user.id, data: { password: pass, recoveryHash: digest(code), recoveryConfirmed: false, sessions: [], loginAttempts: 0, lockUntil: null }, req, overrideAccess: true });
    return { recoveryCode: code };
  });
}
export async function changeAccount(payload: Payload, user: Actor, action: string, input: Record<string, unknown>) {
  if (action === 'password' || action === 'recovery') await limit(payload, `security:user:${user.id}`, 10, 900);
  return accountTransaction(payload, async req => {
    const actor = await requireActor(req, user);
    if (action === 'nickname') {
      await payload.update({ collection: 'users', id: actor.id, data: { nickname: nickname(input.nickname) }, req, overrideAccess: true });
      return { ok: true };
    }
    if (action === 'confirm-recovery') {
      const raw = await payload.db.findOne({ collection: 'users', where: { id: { equals: actor.id } }, req }) as { recoveryHash?: string } | null;
      if (!raw?.recoveryHash) throw new APIError('尚未生成恢复码，请先验证密码并生成。', 400);
      await payload.update({ collection: 'users', id: actor.id, data: { recoveryConfirmed: true }, req, overrideAccess: true });
      return { ok: true };
    }
    await verifyPassword(req, actor.id, input.currentPassword);
    if (action === 'password') {
      const pass = password(input.password);
      if (pass !== input.confirmPassword) throw new APIError('两次输入的密码不一致。', 400);
      // Payload otherwise preserves the current _sid after our beforeChange hook.
      req.user = null;
      await payload.update({ collection: 'users', id: actor.id, data: { password: pass, sessions: [] }, req, overrideAccess: true });
      return { ok: true };
    }
    if (action !== 'recovery') throw new APIError('操作不存在。', 404);
    const code = secretCode();
    await payload.update({ collection: 'users', id: actor.id, data: { recoveryHash: digest(code), recoveryConfirmed: false }, req, overrideAccess: true });
    return { recoveryCode: code };
  }, user);
}
