import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { getPayload, type Payload } from 'payload';
import { seed } from '../scripts/seed-community';
import { currentActor, writeContext, type Actor } from '../src/modules/access';
import { changeAccount, changeUserTag, createInvitation, limit, recover, register, revokeInvitation, signIn, password, username, nickname } from '../src/modules/accounts';
import { createContent } from '../src/modules/community';
import { safeReturnTo } from '../src/modules/return-to';
import { bodyBytes } from '../src/modules/http-body';

let payload: Payload, admin: Actor, member: Actor, accounts: Record<string, { username: string; password: string }>, server: ChildProcess;
const origin = 'http://127.0.0.1:3100';
const freshName = () => `p4_${randomBytes(8).toString('hex')}`;
const pass = () => randomBytes(18).toString('base64url');
async function clearLimits() { assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/zifeiqiuyue_test'); await payload.db.pool.query('DELETE FROM community.auth_limits'); }
const invitation = (maxUses = 1) => createInvitation(payload, admin, { maxUses, expiresAt: new Date(Date.now() + 3600000).toISOString() });
async function fixture() {
  const invite = await invitation(), username = freshName(), password = pass();
  const result = await register(payload, { username, nickname: '纸页上的读者', password, confirmPassword: password, invitation: invite.code });
  return { ...result, password, invite };
}
async function actorFor(username: string) { return (await currentActor(payload, (await payload.find({ collection: 'users', where: { username: { equals: username } }, overrideAccess: true })).docs[0]))!; }
const denied = (run: () => Promise<unknown>, statuses = [400, 401, 403]) => assert.rejects(run, (error: unknown) => statuses.includes((error as { status: number }).status));
async function http(path: string, method = 'GET', data?: unknown, cookie = '', requestOrigin: string | null = origin) {
  return fetch(origin + path, { method, headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual' });
}
async function login(username: string, password: string) {
  const result = await http('/api/users/login', 'POST', { username, password }); assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie') || '', /HttpOnly/i); assert.match(result.headers.get('set-cookie') || '', /SameSite=Lax/i);
  const value = await result.json(); assert.equal(value.token, undefined); assert.equal(value.user.recoveryHash, undefined);
  return result.headers.get('set-cookie')!.split(';')[0];
}
before(async () => {
  const url = new URL(process.env.DATABASE_TEST_URL!); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/zifeiqiuyue_test');
  process.env.DATABASE_URL = url.toString(); process.env.APP_ORIGIN = origin; process.env.MEDIA_ROOT = 'storage/test-media';
  const { default: config } = await import('../src/payload.config'); payload = await getPayload({ config });
  accounts = await seed(payload, '.local/p1-test-accounts.json'); admin = await actorFor('admin'); member = await actorFor('membera');
  await clearLimits();
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3100'], { env: process.env, stdio: 'pipe', windowsHide: true });
  let ready = false; for (let i = 0; i < 100; i++) { try { const response = await http('/api/account/session'); if (response.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.ok(ready, 'Test server did not start');
});
beforeEach(clearLimits);
after(async () => { server?.kill(); if (payload) { await clearLimits(); await payload.destroy(); } });

test('trusted proxy registration limits are isolated between visitor addresses', async () => {
  const prior = process.env.TRUSTED_PROXY;
  process.env.TRUSTED_PROXY = 'cloudflare';
  try {
    const first = new Headers({ 'cf-connecting-ip': '203.0.113.10' });
    for (let i = 0; i < 10; i++) await denied(() => register(payload, {}, first), [400]);
    await denied(() => register(payload, {}, first), [429]);
    await denied(() => register(payload, {}, new Headers({ 'cf-connecting-ip': '203.0.113.11' })), [400]);
    await denied(() => register(payload, {}, new Headers({ 'x-forwarded-for': '203.0.113.12' })), [400]);
  } finally { if (prior === undefined) delete process.env.TRUSTED_PROXY; else process.env.TRUSTED_PROXY = prior; }
});

test('registration normalizes names, forces member role and stores only code hashes', async () => {
  const invite = await invitation(), name = freshName(), password = '  密码🌙abcdefgh123  ';
  const result = await register(payload, { username: name.toUpperCase(), nickname: '  一页故事  ', password, confirmPassword: password, invitation: invite.code, role: 'admin', status: 'banned' });
  assert.equal(result.username, name); const user = await actorFor(name); assert.equal(user.role, 'member'); assert.equal(user.nickname, '一页故事');
  const raw = await payload.db.pool.query('SELECT recovery_hash,hash FROM community.users WHERE id=$1', [user.id]);
  assert.match(raw.rows[0].recovery_hash, /^[0-9a-f]{64}$/); assert.ok(raw.rows[0].recovery_hash !== result.recoveryCode); assert.match(raw.rows[0].hash, /^pbkdf2-sha256-v1:/);
  await login(name, password);
  const list = await payload.find({ collection: 'users', where: { id: { equals: user.id } }, overrideAccess: true }); assert.equal(list.docs[0].recoveryHash, undefined);
});
test('ten concurrent registrations cannot overdraw a single-use invitation', async () => {
  const invite = await invitation(), password = pass();
  const results = await Promise.all(Array.from({ length: 10 }, () => http('/api/account/register', 'POST', { username: freshName(), nickname: '并发读者', password, confirmPassword: password, invitation: invite.code })));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  const stored = await payload.findByID({ collection: 'invitations', id: invite.id, overrideAccess: true }); assert.equal(stored.used, 1);
  const uses = await payload.count({ collection: 'invitation-uses', where: { invitation: { equals: invite.id } }, overrideAccess: true }); assert.equal(uses.totalDocs, 1);
});
test('a failure after user creation rolls back the user, quota and use record together', async () => {
  const invite = await invitation(), name = freshName(), password = pass();
  const hooks = payload.collections['invitation-uses'].config.hooks.beforeChange;
  const fail = () => { throw new Error('Synthetic transaction failure'); }; hooks.push(fail);
  try { await assert.rejects(() => register(payload, { username: name, nickname: '事务测试', password, confirmPassword: password, invitation: invite.code }), /Synthetic transaction failure/); }
  finally { hooks.splice(hooks.indexOf(fail), 1); }
  assert.equal((await payload.count({ collection: 'users', where: { username: { equals: name } }, overrideAccess: true })).totalDocs, 0);
  assert.equal((await payload.findByID({ collection: 'invitations', id: invite.id, overrideAccess: true })).used, 0);
});
test('duplicate names and invalid fields roll back invitation quota and usage', async () => {
  const invite = await invitation(), password = pass();
  await denied(() => register(payload, { username: 'admin', nickname: '重复', password, confirmPassword: password, invitation: invite.code }));
  await denied(() => register(payload, { username: freshName(), nickname: '错误密码', password: 'short', confirmPassword: 'short', invitation: invite.code }));
  assert.equal((await payload.findByID({ collection: 'invitations', id: invite.id, overrideAccess: true })).used, 0);
  assert.equal((await payload.count({ collection: 'invitation-uses', where: { invitation: { equals: invite.id } }, overrideAccess: true })).totalDocs, 0);
});
test('expired or revoked invitations fail; revocation preserves existing members', async () => {
  const user = await fixture(); await revokeInvitation(payload, admin, Number(user.invite.id)); await login(user.username, user.password);
  const invite = await invitation(); await payload.update({ collection: 'invitations', id: invite.id, data: { expiresAt: new Date(Date.now() - 1000).toISOString() }, context: writeContext(), overrideAccess: true });
  const password = pass(); for (const code of [user.invite.code, invite.code]) await denied(() => register(payload, { username: freshName(), nickname: '读者', password, confirmPassword: password, invitation: code }));
  await denied(() => createInvitation(payload, member, { maxUses: 1, expiresAt: new Date(Date.now() + 99999).toISOString() }));
});
test('Tag permissions: invitations and direct updates cannot elevate beyond grantors', async () => {
  const staff = await actorFor('editor');
  assert.equal(admin.tag, 'owner');
  assert.equal(staff.tag, 'admin');
  await denied(() => createInvitation(payload, staff, { maxUses: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), tag: 'admin' }), [403]);
  await denied(() => createInvitation(payload, admin, { maxUses: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), tag: 'owner' }), [403]);
  const moonCode = await createInvitation(payload, staff, { maxUses: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), tag: 'moon' });
  const moonName = freshName(), secret = pass();
  await register(payload, { username: moonName, nickname: '蓝色读者', password: secret, confirmPassword: secret, invitation: moonCode.code });
  const moon = await actorFor(moonName); assert.equal(moon.role, 'member'); assert.equal(moon.tag, 'moon');
  await denied(() => createContent(payload, moon, { slug: 'staffonly-' + freshName().replaceAll('_','-'), title: '越权', markdown: '正文', kind: 'article' }), [403]);
  await denied(() => changeUserTag(payload, staff, moon.id, 'admin'), [403]);
  await denied(() => changeUserTag(payload, staff, admin.id, 'regular'), [403]);
  await denied(() => changeUserTag(payload, admin, moon.id, 'owner'), [403]);
  await denied(() => payload.update({ collection: 'users', id: moon.id, user: admin, overrideAccess: true, data: { tag: 'owner', role: 'admin' } }), [403]);
  await changeUserTag(payload, staff, moon.id, 'regular');
  assert.equal((await actorFor(moonName)).tag, 'regular');
  await changeUserTag(payload, admin, moon.id, 'admin');
  const promoted = await actorFor(moonName); assert.equal(promoted.tag, 'admin'); assert.equal(promoted.role, 'admin');
  await denied(() => changeUserTag(payload, staff, moon.id, 'regular'), [403]);
  const grant = await createInvitation(payload, admin, { maxUses: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), tag: 'admin' });
  const adminName = freshName(); await register(payload, { username: adminName, nickname: '紫色成员', password: secret, confirmPassword: secret, invitation: grant.code });
  assert.equal((await actorFor(adminName)).role, 'admin'); assert.equal((await actorFor(adminName)).tag, 'admin');
});
test('Tag management HTTP endpoints enforce roles and expose public display tags', async () => {
  const ownerCookie = await login(accounts.admin.username, accounts.admin.password);
  const staffCookie = await login(accounts.editor.username, accounts.editor.password);
  const memberCookie = await login(accounts.membera.username, accounts.membera.password);
  const session = await http('/api/account/session', 'GET', undefined, ownerCookie);
  assert.equal((await session.json()).user.tag, 'owner');
  assert.equal((await http('/api/account/users', 'GET', undefined, memberCookie)).status, 403);
  const members = await http('/api/account/users', 'GET', undefined, staffCookie);
  assert.equal(members.status, 200);
  assert.ok((await members.json()).docs.every((u: Record<string, unknown>) => typeof u.username === 'string' && !('hash' in u) && !('sessions' in u)));
  assert.equal((await http('/api/account/user-tag/' + member.id, 'POST', { tag: 'admin' }, staffCookie)).status, 403);
  assert.equal((await http('/api/account/user-tag/' + member.id, 'POST', { tag: 'owner' }, ownerCookie)).status, 403);
  assert.equal((await http('/api/account/user-tag/' + member.id, 'POST', { tag: 'moon' }, memberCookie)).status, 403);
  const publicTag = await http('/api/account/public-user/' + member.id);
  assert.equal(publicTag.status, 200); assert.equal((await publicTag.json()).tag, 'regular');
  const memberInvite = await http('/api/account/invitations', 'POST', { maxUses: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), tag: 'admin' }, staffCookie);
  assert.equal(memberInvite.status, 403);
  const ownerInvite = await http('/api/account/invitations', 'POST', { maxUses: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), tag: 'admin' }, ownerCookie);
  assert.equal(ownerInvite.status, 200);
  const invite = await ownerInvite.json();
  const stored = await payload.findByID({ collection: 'invitations', id: invite.id, overrideAccess: true });
  assert.equal(stored.tag, 'admin');
});
test('native generic account creation stays disabled even for administrators', async () => {
  const cookie = await login(accounts.admin.username, accounts.admin.password);
  for (const path of ['/api/users', '/api/users/first-register']) {
    const response = await http(path, 'POST', { username: freshName(), password: pass(), nickname: '绕过', role: 'admin' }, cookie); assert.ok([400, 401, 403, 404].includes(response.status));
  }
  await denied(() => payload.create({ collection: 'users', data: { username: freshName(), password: pass(), nickname: '绕过' }, user: admin, overrideAccess: true }));
});
test('recovery is atomic, single-use and revokes old sessions', async () => {
  const user = await fixture(), cookie = await login(user.username, user.password), password = pass();
  const results = await Promise.allSettled([1, 2].map(() => recover(payload, { username: user.username, recoveryCode: user.recoveryCode, password, confirmPassword: password })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await http('/api/account/session', 'GET', undefined, cookie).then(response => response.json())).user, null);
  await denied(() => recover(payload, { username: user.username, recoveryCode: user.recoveryCode, password, confirmPassword: password }));
  await login(user.username, password); await denied(() => signIn(payload, { username: user.username, password: user.password }, new Headers()));
});
test('password change verifies old password and invalidates every session', async () => {
  const user = await fixture(), actor = await actorFor(user.username), cookieA = await login(user.username, user.password), cookieB = await login(user.username, user.password), password = pass();
  await denied(() => changeAccount(payload, actor, 'password', { currentPassword: 'incorrect', password, confirmPassword: password }));
  await changeAccount(payload, actor, 'password', { currentPassword: user.password, password, confirmPassword: password });
  for (const cookie of [cookieA, cookieB]) assert.equal((await http('/api/account/session', 'GET', undefined, cookie).then(response => response.json())).user, null);
  await login(user.username, password);
});
test('refresh keeps a valid session but cannot resurrect a password-revoked session', async () => {
  const user = await fixture(), cookie = await login(user.username, user.password), password = pass();
  const response = await http('/api/users/refresh-token', 'POST', {}, cookie); assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.refreshedToken, undefined); assert.equal(value.user.recoveryHash, undefined);
  await changeAccount(payload, await actorFor(user.username), 'password', { currentPassword: user.password, password, confirmPassword: password });
  assert.equal((await http('/api/users/refresh-token', 'POST', {}, cookie)).status, 401);
});
test('login and password change races cannot revive the old password or overwrite new credentials', async () => {
  const user = await fixture(), actor = await actorFor(user.username), password = pass();
  await Promise.allSettled([signIn(payload, { username: user.username, password: user.password }, new Headers()), changeAccount(payload, actor, 'password', { currentPassword: user.password, password, confirmPassword: password })]);
  await denied(() => signIn(payload, { username: user.username, password: user.password }, new Headers())); await login(user.username, password);
});
test('reissuing recovery codes requires a password and immediately replaces the previous code', async () => {
  const user = await fixture(), actor = await actorFor(user.username), password = pass();
  await denied(() => changeAccount(payload, actor, 'recovery', { currentPassword: 'incorrect' }));
  const result = await changeAccount(payload, actor, 'recovery', { currentPassword: user.password }); assert.ok('recoveryCode' in result);
  await denied(() => recover(payload, { username: user.username, recoveryCode: user.recoveryCode, password, confirmPassword: password }));
});
test('recovery never removes a ban, and changing a role revokes old cookies', async () => {
  const user = await fixture(), actor = await actorFor(user.username), cookie = await login(user.username, user.password), password = pass();
  await payload.update({ collection: 'users', id: actor.id, data: { role: 'editor' }, context: writeContext(), overrideAccess: true });
  assert.equal((await http('/api/account/session', 'GET', undefined, cookie).then(response => response.json())).user, null);
  await payload.update({ collection: 'users', id: actor.id, data: { status: 'banned' }, context: writeContext(), overrideAccess: true });
  await recover(payload, { username: user.username, recoveryCode: user.recoveryCode, password, confirmPassword: password });
  await denied(() => signIn(payload, { username: user.username, password }, new Headers()));
  assert.equal(await currentActor(payload, actor), null);
});
test('personal pages paginate only own records and profile writes ignore privilege fields', async () => {
  const first = await fixture(), second = await fixture(), a = await actorFor(first.username), b = await actorFor(second.username);
  for (let i = 0; i < 11; i++) await createContent(payload, a, { slug: `${freshName().replaceAll('_', '-')}-${i}`, title: `我的内容 ${i}`, markdown: '测试文字。' });
  await createContent(payload, b, { slug: freshName().replaceAll('_', '-'), title: '别人的私稿', markdown: '私密。' });
  const cookie = await login(first.username, first.password);
  const data = await http('/api/account/activity?type=drafts&author=' + b.id, 'GET', undefined, cookie).then(response => response.json());
  assert.equal(data.docs.length, 10); assert.equal(data.totalPages, 2); assert.ok(data.docs.every((doc: { title: string }) => doc.title.startsWith('我的内容')));
  assert.equal((await http('/api/account/activity?type=users', 'GET', undefined, cookie)).status, 400);
  await http('/api/account/nickname', 'POST', { nickname: '新昵称', role: 'admin', status: 'banned', username: 'changed' }, cookie);
  const updated = await actorFor(first.username); assert.equal(updated.role, 'member'); assert.equal(updated.nickname, '新昵称');
  const publicUser = await http(`/api/account/public-user/${a.id}`).then(response => response.json()); assert.deepEqual(Object.keys(publicUser), ['nickname', 'tag']); assert.equal(publicUser.tag, 'regular');
  assert.equal((await http('/api/account/invitations', 'GET', undefined, cookie)).status, 403);
});
test('registration, login and recovery reject missing or foreign origins; identity pages are not cached', async () => {
  for (const path of ['/api/account/register', '/api/account/recover', '/api/users/login', '/api/users/logout', '/api/%75sers/login', '/api/users/%6cogin']) for (const requestOrigin of [null, 'https://elsewhere.example']) assert.equal((await http(path, 'POST', {}, '', requestOrigin)).status, 403);
  for (const path of ['/login', '/register', '/recover', '/account', '/account/security', '/api/account/session']) { const response = await http(path); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /no-store/); }
});
test('native login enforces account and shared IP limits, ignores forged IP headers', async () => {
  for (let i = 0; i < 11; i++) { const response = await http('/api/users/login', 'POST', { username: 'absent_account', password: pass() }); assert.equal(response.status, i === 10 ? 429 : 401); }
  await clearLimits();
  for (let i = 0; i < 31; i++) {
    const response = await fetch(origin + '/api/users/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${i}` }, body: JSON.stringify({ username: freshName(), password: pass() }) });
    assert.equal(response.status, i === 30 ? 429 : 401);
  }
});
test('framework five-failure lock persists and does not disclose whether an account exists', async () => {
  const user = await fixture();
  let message = '';
  for (let i = 0; i < 5; i++) { const response = await http('/api/users/login', 'POST', { username: user.username, password: 'wrong-password' }); assert.equal(response.status, 401); message = (await response.json()).errors[0].message; }
  const locked = await http('/api/users/login', 'POST', { username: user.username, password: user.password }); assert.equal(locked.status, 401); assert.equal((await locked.json()).errors[0].message, message);
  const missing = await http('/api/users/login', 'POST', { username: freshName(), password: user.password }); assert.equal((await missing.json()).errors[0].message, message);
  const row = await payload.db.pool.query('SELECT login_attempts,lock_until FROM community.users WHERE username=$1', [user.username]); assert.ok(Number(row.rows[0].login_attempts) >= 5); assert.ok(+new Date(row.rows[0].lock_until) > Date.now());
});
test('registration and recovery have their own persisted limits', async () => {
  for (let i = 0; i < 11; i++) { const response = await http('/api/account/register', 'POST', {}); assert.equal(response.status, i === 10 ? 429 : 400); }
  for (let i = 0; i < 6; i++) { const password = pass(); const response = await http('/api/account/recover', 'POST', { username: 'absent_account', recoveryCode: 'wrong', password, confirmPassword: password }); assert.equal(response.status, i === 5 ? 429 : 400); }
});
test('rate counters are shared atomically by independent processes', async () => {
  const key = freshName();
  const script = `import {getPayload} from 'payload'; import {limit} from './src/modules/accounts.ts'; const {default:config}=await import('./src/payload.config.ts'); const p=await getPayload({config}); let accepted=0; for(let i=0;i<2;i++) {try{await limit(p,${JSON.stringify(key)},3,900); accepted++;}catch(e){if(e.status!==429) throw e;}} console.log('RATE_ACCEPTED=' + accepted); await p.destroy(); process.exit(0);`;
  const worker = () => new Promise<number>((resolve, reject) => { const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env: process.env, windowsHide: true }); let output = ''; child.stdout.on('data', data => output += data); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(Number(output.match(/RATE_ACCEPTED=(\d+)/)?.[1])) : reject(new Error('Counter worker failed'))); });
  const counts = await Promise.all([worker(), worker()]); assert.equal(counts.reduce((a, b) => a + b, 0), 3); await denied(() => limit(payload, key, 3, 900), [429]);
});
test('safe return paths preserve article versions and reject external redirects', () => {
  assert.equal(safeReturnTo('/articles/story?version=12#quote'), '/articles/story?version=12#quote');
  for (const value of ['https://elsewhere.example', '//elsewhere.example', '/\\elsewhere.example', '/login', '/api/users', '/\nelsewhere']) assert.equal(safeReturnTo(value), '/account');
});
test('password bounds count Unicode characters without trimming or truncating', () => {
  const long = ' 🌙'.repeat(63) + 'aa'; assert.equal([...long].length, 128); assert.equal(password(long), long);
  assert.throws(() => password(long + 'a')); assert.throws(() => password('short')); assert.throws(() => username('中文账号')); assert.throws(() => username('has-dash')); assert.throws(() => nickname('月'.repeat(31)));
});
test('authentication rejects oversized bodies even without a content-length header', async () => {
  for (const path of ['/api/account/register', '/api/account/recover', '/api/users/login']) assert.equal((await http(path, 'POST', { padding: 'a'.repeat(9000) })).status, 413);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
  const request = new Request('http://localhost/probe', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await denied(() => bodyBytes(request, 8), [413]); assert.ok(cancelled);
});
test('more simultaneous logins than pool slots finish without connection starvation', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () => fetch(origin + '/api/users/login', { method: 'POST', signal: AbortSignal.timeout(10000), headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: freshName(), password: pass() }) })));
  assert.ok(responses.every(response => response.status === 401));
});
