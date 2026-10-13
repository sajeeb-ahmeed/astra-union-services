param([switch]$ForceDownload)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeDirectory = Join-Path $workspaceRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$binaryPath = Join-Path $runtimeDirectory 'pgsql\bin\postgres.exe'
$archivePath = Join-Path $runtimeDirectory 'postgresql-17.11-windows-x64-binaries.zip'
# Windows x64 17.11 link published at https://www.enterprisedb.com/download-postgresql-binaries.
$sourceUrl = 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616'
if ($ForceDownload -or -not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -Uri $sourceUrl -OutFile $archivePath -TimeoutSec 600
}
if (-not (Test-Path -LiteralPath $binaryPath)) {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeDirectory -Force
}
if (-not (Test-Path -LiteralPath $binaryPath)) { throw 'The official archive did not contain pgsql/bin/postgres.exe.' }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$downloadMetadata = [ordered]@{ sourcePage = 'https://www.enterprisedb.com/download-postgresql-binaries'; sourceUrl = $sourceUrl; sha256 = $hash; downloadedAt = [DateTime]::UtcNow.ToString('o'); version = '17.11'; scope = 'workspace-local; no Windows service' } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $runtimeDirectory 'postgres-download.json'), $downloadMetadata, (New-Object Text.UTF8Encoding $false))
& $binaryPath --version
Write-Output 'PostgreSQL binaries ready in workspace .runtime/pgsql; no global installation.'
