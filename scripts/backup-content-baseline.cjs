const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('.local', `p2-baseline-${stamp}`);
fs.mkdirSync(root, { recursive: true });
for (const [key, name, media] of [['DATABASE_URL', 'dev', 'storage/media'], ['DATABASE_TEST_URL', 'test', 'storage/test-media']]) {
  const url = new URL(process.env[key]);
  if (url.hostname !== '127.0.0.1' || url.pathname !== `/zifeiqiuyue_${name}`) throw new Error('Unexpected backup database');
  execFileSync(path.resolve('.local/postgres/pgsql/bin/pg_dump.exe'), ['--format=custom', '--schema=community', '--no-owner', '--no-acl', '--file', path.join(root, `${name}.dump`), '--dbname', url.pathname.slice(1)], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: url.username, PGPASSWORD: decodeURIComponent(url.password) } });
  if (fs.existsSync(media)) fs.cpSync(media, path.join(root, `${name}-media`), { recursive: true });
  const ledger = path.resolve('.local/purge-ledger', url.pathname.slice(1));
  if (fs.existsSync(ledger)) fs.cpSync(ledger, path.join(root, `${name}-purge-ledger`), { recursive: true });
}
const files = ['index.html', 'articles.html', 'read.html', ...fs.readdirSync('content/articles').map(f => `content/articles/${f}`), 'content/site.json', 'content/quotes.json'];
const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
fs.writeFileSync(path.join(root, 'sources.json'), JSON.stringify(hashes, null, 2));
console.log(`P2 baseline saved: ${path.relative(process.cwd(), root)}`);
