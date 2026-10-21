import { isIP } from 'node:net';
import { APIError } from 'payload';

export function clientAddress(headers?: Headers) {
  if (!headers || process.env.TRUSTED_PROXY !== 'cloudflare') return 'local';
  const value = headers.get('cf-connecting-ip');
  if (!value || !isIP(value)) throw new APIError('请求必须通过配置的可信入口。', 400);
  return isIP(value) === 6 ? new URL(`http://[${value}]`).hostname.slice(1, -1) : value;
}

export function checkDeployment() {
  if (process.env.APP_ENV !== 'production') return;
  const origin = new URL(process.env.APP_ORIGIN || '');
  if (origin.protocol !== 'https:' || origin.origin !== process.env.APP_ORIGIN) throw new Error('Production APP_ORIGIN must be a canonical HTTPS origin.');
  const database = new URL(process.env.DATABASE_URL || '');
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/zifeiqiuyue_prod') throw new Error('Production requires the dedicated local production database.');
  if (process.env.TRUSTED_PROXY !== 'cloudflare') throw new Error('Production requires the configured Cloudflare Tunnel entrance.');
  if (!process.env.MEDIA_ROOT || !process.env.PURGE_LEDGER_DIR) throw new Error('Production media and purge ledger directories are required.');
}
