const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const identifier = name => '"' + name.replaceAll('"', '""') + '"';
let runtime, source;
const tool = name => path.resolve('.local/postgres/pgsql/bin', name + '.exe');
const run = (name, args, url) => execFileSync(tool(name), args, { windowsHide: true, stdio: 'pipe', env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGDATABASE: url.pathname.slice(1), PGUSER: url.username, PGPASSWORD: decodeURIComponent(url.password) } });
async function counts(client) {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='community' ORDER BY tablename");
  const result = {};
  for (const { tablename } of rows) result[tablename] = Number((await client.query('SELECT count(*) FROM community.' + identifier(tablename))).rows[0].count);
  return result;
}
async function main() {
  runtime = parseEnv(fs.readFileSync('.env.deploy.local', 'utf8'));
  source = new URL(runtime.DATABASE_URL);
  assert.equal(source.hostname, '127.0.0.1'); assert.equal(source.pathname, '/zifeiqiuyue_prod');
  if (process.argv[2] !== 'verify') {
    assert.ok(!process.argv[2], 'Use no argument to back up, or verify --backup=directory.');
    const directory = path.resolve('backups', 'production-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(directory, { recursive: true });
    const client = new Client({ connectionString: source.toString() }); await client.connect();
    try {
      await client.query('SELECT pg_advisory_lock(97124,0)');
      await client.query('SELECT pg_advisory_lock(97125,0)');
      const tables = await counts(client);
      run('pg_dump', ['--format=custom', '--schema=community', '--no-owner', '--no-acl', '--file', path.join(directory, 'database.dump')], source);
      fs.cpSync(runtime.MEDIA_ROOT, path.join(directory, 'media'), { recursive: true });
      fs.cpSync(runtime.PURGE_LEDGER_DIR, path.join(directory, 'purge-ledger'), { recursive: true });
      const media = Object.fromEntries(fs.readdirSync(path.join(directory, 'media')).map(file => [file, hash(path.join(directory, 'media', file))]));
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ database: 'zifeiqiuyue_prod', counts: tables, media, dumpHash: hash(path.join(directory, 'database.dump')) }, null, 2));
      console.log('Private production backup: ' + path.relative(process.cwd(), directory));
    } finally { await client.end(); }
  } else {
    const input = process.argv.find(value => value.startsWith('--backup='))?.slice(9);
    assert.ok(input, 'A backup directory is required.');
    const directory = fs.realpathSync(input);
    assert.ok(directory.startsWith(fs.realpathSync('backups') + path.sep), 'Only a backup in this project may be verified.');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.database, 'zifeiqiuyue_prod');
    assert.equal(hash(path.join(directory, 'database.dump')), manifest.dumpHash);
    for (const [file, checksum] of Object.entries(manifest.media)) { assert.equal(file, path.basename(file)); assert.equal(hash(path.join(directory, 'media', file)), checksum); }
    const migration = parseEnv(fs.readFileSync('.env.deploy-migrate.local', 'utf8'));
    const target = new URL(migration.DATABASE_MIGRATION_URL);
    assert.equal(target.hostname, source.hostname); assert.equal(target.port, source.port); assert.equal(target.pathname, source.pathname);
    target.pathname = '/zifeiqiuyue_prod_restore';
    assert.notEqual(target.pathname, source.pathname);
    const client = new Client({ connectionString: target.toString() }); await client.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS community CASCADE');
      run('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', target.pathname.slice(1), path.join(directory, 'database.dump')], target);
      assert.deepEqual(await counts(client), manifest.counts);
      for (const row of (await client.query('SELECT filename,sizes_thumb_filename FROM community.media WHERE purged=false')).rows) for (const file of [row.filename, row.sizes_thumb_filename].filter(Boolean)) assert.ok(Object.hasOwn(manifest.media, file), 'A referenced media file is missing.');
      await client.query('BEGIN'); await client.query('CREATE TABLE community.restore_write_probe(id int)'); await client.query('ROLLBACK');
      console.log('Isolated production restore verified: table counts, media hashes, references and write access.');
    } finally { await client.end(); }
  }
}
main().catch(() => { console.error('Production backup/restore verification failed; private files were retained for inspection.'); process.exitCode = 1; });
