import config from '@payload-config';
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from '@payloadcms/next/routes';
import { getPayload } from 'payload';
import { generatePayloadCookie, generateExpiredPayloadCookie } from 'payload/shared';
import { sameOrigin, signIn, signOut, refreshSignIn } from '../../../../modules/accounts';
import { type Actor } from '../../../../modules/access';
import { bodyBytes } from '../../../../modules/http-body';

const requestPath = (request: Request) => decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, '');
const noCache = (handler: ReturnType<typeof REST_GET>) => async (...args: Parameters<typeof handler>) => {
  const request = args[0];
  let path: string;
  try { path = requestPath(request); }
  catch { return Response.json({ errors: [{ message: '请求地址无效。' }] }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } }); }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && (path === '/api/users' || path.startsWith('/api/users/'))) {
    try { sameOrigin(request.headers); }
    catch { return Response.json({ errors: [{ message: '请从本站提交操作。' }] }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }); }
  }
  const response = await handler(...args);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
export const GET = noCache(REST_GET(config));
export const POST = noCache(async (...args) => {
  const [request] = args;
  const path = requestPath(request);
  if (path !== '/api/users' && !path.startsWith('/api/users/')) return REST_POST(config)(...args);
  try {
    sameOrigin(request.headers);
    if (['/api/users/forgot-password', '/api/users/reset-password', '/api/users/unlock'].includes(path)) return Response.json({ errors: [{ message: '请使用本站账号安全页面。' }] }, { status: 403 });
    if (!['/api/users/login', '/api/users/logout', '/api/users/refresh-token'].includes(path)) return REST_POST(config)(...args);
    const payload = await getPayload({ config });
    const cookieOptions = { collectionAuthConfig: payload.collections.users.config.auth, cookiePrefix: payload.config.cookiePrefix };
    if (path.endsWith('/refresh-token')) {
      const { user } = await payload.auth({ headers: request.headers });
      if (!user) return Response.json({ errors: [{ message: '请重新登录。' }] }, { status: 401 });
      const result = await refreshSignIn(payload, user as unknown as Actor & { _sid?: string });
      return Response.json({ exp: result.exp, user: { id: result.user.id, username: result.user.username, nickname: result.user.nickname, role: result.user.role, collection: 'users' } }, { headers: { 'Set-Cookie': generatePayloadCookie({ ...cookieOptions, token: result.refreshedToken! }) } });
    }
    if (path.endsWith('/logout')) {
      const { user } = await payload.auth({ headers: request.headers });
      if (user) await signOut(payload, user as unknown as Actor & { _sid?: string });
      return Response.json({ message: '已退出。' }, { headers: { 'Set-Cookie': generateExpiredPayloadCookie(cookieOptions) } });
    }
    const raw = (await bodyBytes(request, 4096)).toString('utf8');
    const input = JSON.parse(raw);
    const result = await signIn(payload, { username: input.username, password: input.password }, request.headers);
    const user = result.user!;
    return Response.json({ exp: result.exp, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role, collection: 'users' } }, { headers: { 'Set-Cookie': generatePayloadCookie({ ...cookieOptions, token: result.token! }) } });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return Response.json({ errors: [{ message: status === 403 ? '请从本站提交操作。' : status === 429 ? '尝试过于频繁，请稍后再试。' : '账号或密码错误，或账号暂不可用。' }] }, { status });
  }
});
export const PATCH = noCache(REST_PATCH(config));
export const DELETE = noCache(REST_DELETE(config));
export const PUT = noCache(REST_PUT(config));
export const OPTIONS = noCache(REST_OPTIONS(config));
