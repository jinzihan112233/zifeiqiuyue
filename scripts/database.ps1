param([ValidateSet('start','stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskBin = Join-Path $taskRoot '.local/postgres/pgsql/bin'
$taskData = Join-Path $taskRoot '.local/pgdata'
$taskPasswordFile = Join-Path $taskRoot '.local/database-password'
if (-not (Test-Path -LiteralPath (Join-Path $taskBin 'pg_ctl.exe'))) {
  throw 'PostgreSQL 17 binaries missing. See docs/development.md for .local/postgres/pgsql/bin.'
}
if ($Action -eq 'stop') {
  if (Test-Path -LiteralPath (Join-Path $taskData 'postmaster.pid')) {
    & (Join-Path $taskBin 'pg_ctl.exe') -D $taskData -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL stop failed' }
  }
  exit 0
}
if (-not (Test-Path -LiteralPath (Join-Path $taskData 'PG_VERSION'))) {
  if (-not (Test-Path -LiteralPath $taskPasswordFile)) {
    [IO.File]::WriteAllText($taskPasswordFile, ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')))
  }
  & (Join-Path $taskBin 'initdb.exe') -D $taskData -U zfq_local_admin --encoding=UTF8 --locale=C --auth=scram-sha-256 ('--pwfile=' + $taskPasswordFile)
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initdb failed' }
}
& (Join-Path $taskBin 'pg_ctl.exe') -D $taskData status *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $taskBin 'pg_ctl.exe') -D $taskData -l (Join-Path $taskRoot '.local/postgres.log') -o '-h 127.0.0.1 -p 55432' -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL start failed; inspect .local/postgres.log' }
}
Push-Location $taskRoot
try {
  node scripts/prepare-database.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Database preparation failed' }
} finally { Pop-Location }
