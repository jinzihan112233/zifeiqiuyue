import fs from 'node:fs';
import crypto from 'node:crypto';
import { getPayload } from 'payload';
import { writeContext } from '../src/modules/access';

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
if (process.argv[1]?.endsWith('seed-community.ts')) {
  const { default: config } = await import('../src/payload.config');
  const payload = await getPayload({ config });
  try { await seed(payload, '.local/p1-accounts.json'); console.log('Seed ready. Local credentials are in .local/p1-accounts.json (not committed). Existing accounts and passwords were preserved.'); }
  finally { await payload.destroy(); }
  process.exit(0);
}
