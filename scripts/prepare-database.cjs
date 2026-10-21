const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');

async function main() {
  const filename = '.local/database-access.json';
  const local = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {
    app: crypto.randomBytes(32).toString('hex'),
    migrate: crypto.randomBytes(32).toString('hex'),
    secret: crypto.randomBytes(48).toString('hex'),
  };
  fs.writeFileSync(filename, JSON.stringify(local, null, 2));
  const admin = { host: '127.0.0.1', port: 55432, user: 'zfq_local_admin', password: fs.readFileSync('.local/database-password', 'utf8') };
  const client = new Client({ ...admin, database: 'postgres' });
  await client.connect();
  try {
    for (const [role, password] of [['zfq_app', local.app], ['zfq_migrate', local.migrate]]) {
      if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      }
    }
    for (const db of ['zifeiqiuyue_dev', 'zifeiqiuyue_test', 'zifeiqiuyue_restore']) {
      if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [db])).rowCount) {
        await client.query(`CREATE DATABASE ${db} OWNER zfq_migrate`);
      }
      const setup = new Client({ ...admin, database: db });
      await setup.connect();
      try {
        await setup.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
        await setup.query('CREATE SCHEMA IF NOT EXISTS community AUTHORIZATION zfq_migrate');
        await setup.query('GRANT USAGE ON SCHEMA community TO zfq_app');
        await setup.query('ALTER DEFAULT PRIVILEGES FOR ROLE zfq_migrate IN SCHEMA community GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO zfq_app');
        await setup.query('ALTER DEFAULT PRIVILEGES FOR ROLE zfq_migrate IN SCHEMA community GRANT USAGE,SELECT ON SEQUENCES TO zfq_app');
        await setup.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA community TO zfq_app');
        await setup.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA community TO zfq_app');
      } finally { await setup.end(); }
    }
    const url = (role, password, db) => `postgresql://${role}:${password}@127.0.0.1:55432/${db}`;
    if (!fs.existsSync('.env.local')) {
      fs.writeFileSync('.env.local', [
        `DATABASE_URL=${url('zfq_app', local.app, 'zifeiqiuyue_dev')}`,
        `DATABASE_MIGRATION_URL=${url('zfq_migrate', local.migrate, 'zifeiqiuyue_dev')}`,
        `DATABASE_TEST_URL=${url('zfq_app', local.app, 'zifeiqiuyue_test')}`,
        `PAYLOAD_SECRET=${local.secret}`,
        'APP_ORIGIN=http://127.0.0.1:3000', 'MEDIA_ROOT=storage/media', '',
      ].join('\n'));
    }
    const app = new Client({ connectionString: url('zfq_app', local.app, 'zifeiqiuyue_dev') });
    await app.connect();
    try {
      const { rows } = await app.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user');
      assert.deepEqual(rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    } finally { await app.end(); }
    console.log('Local PostgreSQL prepared: dev/test/restore; application role has no administrative privileges.');
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.message.replace(/postgresql:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
