$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeDirectory = Join-Path $workspaceRoot '.runtime'
$pgCtl = Join-Path $runtimeDirectory 'pgsql\bin\pg_ctl.exe'
$dataDirectory = Join-Path $runtimeDirectory 'postgres-data'
if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION'))) {
    & $pgCtl status -D $dataDirectory *> $null
    if ($LASTEXITCODE -eq 0) {
        & $pgCtl stop -D $dataDirectory -m fast -w -t 30
        if ($LASTEXITCODE -ne 0) { throw 'Workspace PostgreSQL did not stop cleanly.' }
    }
}
Write-Output 'Workspace PostgreSQL stopped; data and local credentials preserved.'
