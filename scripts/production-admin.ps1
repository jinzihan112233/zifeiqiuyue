$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPassword = Read-Host 'Initial production admin password (12-128 characters)' -AsSecureString
try {
  $env:INITIAL_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $taskPassword).Password
  Push-Location $taskRoot
  try {
    node scripts/production.cjs seed
    if ($LASTEXITCODE -ne 0) { throw 'Production admin initialization failed' }
  } finally { Pop-Location }
} finally {
  Remove-Item Env:INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $taskPassword.Dispose()
}
