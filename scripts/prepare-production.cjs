const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { Client } = require('pg');

async function main() {
  const originArg = process.argv.find(value => value.startsWith('--origin='))?.slice(9);
  const runtimeFile = '.env.deploy.local';
  const existing = fs.existsSync(runtimeFile) ? parseEnv(fs.readFileSync(runtimeFile, 'utf8')) : {};
  const origin = originArg || existing.APP_ORIGIN;
  assert.ok(origin && new URL(origin).protocol === 'https:' && new URL(origin).origin === origin, 'Use --origin=https://your-domain without a trailing slash.');
  const secretFile = '.local/production-access.json';
  const admin = { host: '127.0.0.1', port: 55432, user: 'zfq_local_admin', password: fs.readFileSync('.local/database-password', 'utf8') };
  const client = new Client({ ...admin, database: 'postgres' });
  await client.connect();
  try {
    const hasRole = (await client.query("SELECT 1 FROM pg_roles WHERE rolname IN ('zfq_prod_app','zfq_prod_migrate')")).rowCount;
    assert.ok(fs.existsSync(secretFile) || !hasRole, 'Production credentials are missing; refusing to reset existing database roles.');
    const secrets = fs.existsSync(secretFile) ? JSON.parse(fs.readFileSync(secretFile, 'utf8')) : { app: crypto.randomBytes(32).toString('hex'), migrate: crypto.randomBytes(32).toString('hex'), secret: crypto.randomBytes(48).toString('hex') };
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, JSON.stringify(secrets, null, 2), { mode: 0o600, flag: 'wx' });
    for (const [role, password] of [['zfq_prod_app', secrets.app], ['zfq_prod_migrate', secrets.migrate]]) {
      if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    }
    for (const database of ['zifeiqiuyue_prod', 'zifeiqiuyue_prod_restore']) {
      if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) await client.query(`CREATE DATABASE ${database} OWNER zfq_prod_migrate`);
      const db = new Client({ ...admin, database }); await db.connect();
      try {
        await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
        await db.query('REVOKE CONNECT ON DATABASE ' + database + ' FROM PUBLIC');
        await db.query('GRANT CONNECT ON DATABASE ' + database + ' TO zfq_prod_migrate');
        await db.query('CREATE SCHEMA IF NOT EXISTS community AUTHORIZATION zfq_prod_migrate');
        if (database === 'zifeiqiuyue_prod_restore') {
          await db.query('REVOKE CONNECT ON DATABASE zifeiqiuyue_prod_restore FROM zfq_prod_app');
          await db.query('REVOKE ALL ON SCHEMA community FROM zfq_prod_app');
          continue;
        }
        await db.query('GRANT CONNECT ON DATABASE zifeiqiuyue_prod TO zfq_prod_app');
        await db.query('GRANT USAGE ON SCHEMA community TO zfq_prod_app');
        await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE zfq_prod_migrate IN SCHEMA community GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO zfq_prod_app');
        await db.query('ALTER DEFAULT PRIVILEGES FOR ROLE zfq_prod_migrate IN SCHEMA community GRANT USAGE,SELECT ON SEQUENCES TO zfq_prod_app');
        await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA community TO zfq_prod_app');
        await db.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA community TO zfq_prod_app');
      } finally { await db.end(); }
    }
    const media = path.resolve('storage/production-media');
    const ledger = path.resolve('.local/production-purge-ledger');
    for (const directory of [media, ledger]) fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(path.join(ledger, 'manifest.json'))) fs.writeFileSync(path.join(ledger, 'manifest.json'), '{"version":1}', { mode: 0o600 });
    const url = (role, password) => `postgresql://${role}:${password}@127.0.0.1:55432/zifeiqiuyue_prod`;
    const runtime = { ...existing, APP_ENV: 'production', APP_ORIGIN: origin, TRUSTED_PROXY: 'cloudflare', DATABASE_URL: url('zfq_prod_app', secrets.app), PAYLOAD_SECRET: secrets.secret, MEDIA_ROOT: media.replaceAll('\\', '/'), PURGE_LEDGER_DIR: ledger.replaceAll('\\', '/'), MEDIA_QUOTA_MIB: existing.MEDIA_QUOTA_MIB || '100' };
    fs.writeFileSync(runtimeFile, Object.entries(runtime).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    fs.writeFileSync('.env.deploy-migrate.local', `DATABASE_MIGRATION_URL=${url('zfq_prod_migrate', secrets.migrate)}\n`, { mode: 0o600 });
    const check = new Client({ connectionString: runtime.DATABASE_URL }); await check.connect();
    try {
      const { rows: [role] } = await check.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user');
      assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
      await assert.rejects(() => check.query('CREATE TABLE community.unauthorized_probe(id int)'), /permission denied/);
    } finally { await check.end(); }
    const restoreURL = new URL(runtime.DATABASE_URL); restoreURL.pathname = '/zifeiqiuyue_prod_restore';
    const forbidden = new Client({ connectionString: restoreURL.toString() });
    try { await assert.rejects(() => forbidden.connect(), /permission denied/); } finally { await forbidden.end(); }
    console.log('Production dev/test isolation prepared; runtime and migration credentials are separate and private.');
  } finally { await client.end(); }
}
main().catch(() => { console.error('Production preparation failed. Check local database availability, origin and private credential files.'); process.exitCode = 1; });
