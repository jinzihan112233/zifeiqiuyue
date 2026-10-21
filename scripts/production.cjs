const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');

try {
  const action = process.argv[2];
  assert.ok(['build', 'start', 'migrate', 'seed'].includes(action), 'Expected build, start, migrate or seed.');
  const runtime = parseEnv(fs.readFileSync('.env.deploy.local', 'utf8'));
  assert.equal(runtime.APP_ENV, 'production');
  assert.equal(new URL(runtime.DATABASE_URL).pathname, '/zifeiqiuyue_prod');
  const env = { ...process.env, ...runtime, NODE_ENV: 'production', DATABASE_MIGRATION_URL: '', DATABASE_TEST_URL: '', INITIAL_ADMIN_PASSWORD: '' };
  let args;
  if (action === 'build') args = ['node_modules/next/dist/bin/next', 'build', '--webpack'];
  if (action === 'start') args = ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3010'];
  if (action === 'migrate') {
    Object.assign(env, parseEnv(fs.readFileSync('.env.deploy-migrate.local', 'utf8')));
    args = ['--import', 'tsx', 'scripts/migrate-community.ts', '--production'];
  }
  if (action === 'seed') { env.INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || ''; args = ['--import', 'tsx', 'scripts/seed-community.ts']; }
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch { console.error('Production command failed. Run prod:prepare first and check private production settings.'); process.exitCode = 1; }
