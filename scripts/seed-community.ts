import fs from 'node:fs';
import crypto from 'node:crypto';
import { getPayload } from 'payload';
import { writeContext } from '../src/modules/access';
import { password } from '../src/modules/accounts';

export async function seed(payload: Awaited<ReturnType<typeof getPayload>>, file: string) {
  const accounts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : Object.fromEntries([
    ['admin', 'admin'], ['editor', 'editor'], ['membera', 'member'], ['memberb', 'member'], ['blocked', 'member'],
  ].map(([username, role]) => [username, { username, role, password: crypto.randomBytes(18).toString('base64url') }]));
  if (!fs.existsSync(file)) {
    for (const username of Object.keys(accounts)) {
      const existing = await payload.count({ collection: 'users', where: { username: { equals: username } }, overrideAccess: true });
      if (existing.totalDocs) throw new Error(`Local credential file is missing for existing account ${username}; no passwords were reset.`);
    }
    fs.writeFileSync(file, JSON.stringify(accounts, null, 2));
  }
  for (const account of Object.values(accounts) as { username: string; role: string; password: string }[]) {
    const found = await payload.find({ collection: 'users', where: { username: { equals: account.username } }, overrideAccess: true });
    if (!found.totalDocs) await payload.create({ collection: 'users', data: { ...account, nickname: account.username === 'admin' ? '管理员' : account.username, status: account.username === 'blocked' ? 'banned' : 'active' }, context: writeContext(), overrideAccess: true });
  }
  fs.writeFileSync(file, JSON.stringify(accounts, null, 2));
  return accounts;
}
export async function seedAdmin(payload: Awaited<ReturnType<typeof getPayload>>, initialPassword: unknown) {
  const found = await payload.find({ collection: 'users', where: { username: { equals: 'admin' } }, overrideAccess: true });
  if (found.totalDocs) return found.docs[0];
  const value = password(initialPassword);
  return payload.create({ collection: 'users', data: { username: 'admin', nickname: '管理员', role: 'admin', status: 'active', password: value }, context: writeContext(), overrideAccess: true });
}
if (process.argv[1]?.endsWith('seed-community.ts')) {
  const { default: config } = await import('../src/payload.config');
  const payload = await getPayload({ config });
  try { await seedAdmin(payload, process.env.INITIAL_ADMIN_PASSWORD); console.log('Admin ready. Existing accounts and passwords were preserved; no sample accounts were created.'); }
  finally { await payload.destroy(); }
  process.exit(0);
}
