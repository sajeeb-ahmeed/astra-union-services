param([int]$Port = 55432)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeDirectory = Join-Path $workspaceRoot '.runtime'
$binaryDirectory = Join-Path $runtimeDirectory 'pgsql\bin'
$dataDirectory = Join-Path $runtimeDirectory 'postgres-data'
$connectionPath = Join-Path $runtimeDirectory 'postgres.json'
$logPath = Join-Path $runtimeDirectory 'postgres.log'
if (-not (Test-Path -LiteralPath (Join-Path $binaryDirectory 'pg_ctl.exe'))) { throw 'Run scripts/runtime/install-postgres.ps1 first.' }
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if (Test-Path -LiteralPath $connectionPath) {
    $connection = Get-Content -LiteralPath $connectionPath -Raw | ConvertFrom-Json
    if ($connection.port -ne $Port) { throw 'Existing local connection file uses a different port. Supply the same -Port.' }
} else {
    $randomSource = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomBytes = New-Object byte[] 24
        $randomSource.GetBytes($randomBytes)
        $adminPassword = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
        $randomSource.GetBytes($randomBytes)
        $appPassword = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    } finally { $randomSource.Dispose() }
    $connection = [ordered]@{
        host = '127.0.0.1'; port = $Port; database = 'astra'; adminUser = 'astra_admin'; appUser = 'astra_app'
        adminUrl = "postgresql://astra_admin:${adminPassword}@127.0.0.1:${Port}/astra"
        appUrl = "postgresql://astra_app:${appPassword}@127.0.0.1:${Port}/astra"
        adminPassword = $adminPassword; appPassword = $appPassword
    }
    [IO.File]::WriteAllText($connectionPath, ($connection | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}
if ((Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION')) -and -not (Test-Path -LiteralPath (Join-Path $dataDirectory 'global\pg_control'))) {
    throw 'An incomplete cluster exists in .runtime/postgres-data. Preserve/move it within .runtime before initializing again.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION'))) {
    $passwordFile = Join-Path $runtimeDirectory 'initdb-password.tmp'
    try {
        Set-Content -LiteralPath $passwordFile -Value $connection.adminPassword -Encoding ascii
        & (Join-Path $binaryDirectory 'initdb.exe') -D $dataDirectory -U $connection.adminUser -E UTF8 --locale=C --auth=scram-sha-256 "--pwfile=$passwordFile"
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL cluster initialization failed.' }
    } finally {
        # This path is fixed within the resolved workspace; remove only the password scratch file.
        if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile -Force }
    }
}
$pgCtl = Join-Path $binaryDirectory 'pg_ctl.exe'
& $pgCtl status -D $dataDirectory *> $null
if ($LASTEXITCODE -ne 0) {
    $startOutput = Join-Path $runtimeDirectory 'postgres-start.stdout.log'
    $startError = Join-Path $runtimeDirectory 'postgres-start.stderr.log'
    $quotedData = '"' + $dataDirectory + '"'
    $quotedLog = '"' + $logPath + '"'
    $serverOptions = '"-h 127.0.0.1 -p ' + $Port + ' -c log_statement=none -c log_min_error_statement=panic"'
    $process = Start-Process -FilePath $pgCtl -ArgumentList @('start','-D',$quotedData,'-l',$quotedLog,'-o',$serverOptions,'-w','-t','30') -WindowStyle Hidden -PassThru -RedirectStandardOutput $startOutput -RedirectStandardError $startError
    # Start-Process -Wait waits the entire process tree, including the long-lived server.
    # Wait only for pg_ctl itself to report readiness.
    if (-not $process.WaitForExit(45000)) { throw 'pg_ctl readiness timeout; inspect .runtime/postgres-start.stderr.log.' }
    # Some PowerShell hosts return a null ExitCode for the detached launcher.
    # Check the actual server state, then authenticate below before reporting success.
    & $pgCtl status -D $dataDirectory *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed; inspect .runtime/postgres-start.stderr.log and postgres.log.' }
}
$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $connection.adminPassword
    $psql = Join-Path $binaryDirectory 'psql.exe'
    $baseArguments = @('-h',$connection.host,'-p',[string]$connection.port,'-U',$connection.adminUser,'-d','postgres','-v','ON_ERROR_STOP=1','-q')
    $appRoleExists = & $psql @baseArguments -t -A -c "SELECT 1 FROM pg_roles WHERE rolname = 'astra_app';"
    if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL authentication failed.' }
    if (($appRoleExists -join '').Trim() -ne '1') {
        # Generated passwords are hex; no user-supplied value is interpolated into SQL.
        & $psql @baseArguments -c "CREATE ROLE astra_app LOGIN PASSWORD '$($connection.appPassword)' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;"
        if ($LASTEXITCODE -ne 0) { throw 'Application role creation failed.' }
    }
    $databaseExists = & $psql @baseArguments -t -A -c "SELECT 1 FROM pg_database WHERE datname = 'astra';"
    if (($databaseExists -join '').Trim() -ne '1') {
        & $psql @baseArguments -c 'CREATE DATABASE astra OWNER astra_admin ENCODING ''UTF8'';'
        if ($LASTEXITCODE -ne 0) { throw 'Application database creation failed.' }
    }
    & $psql @baseArguments -d astra -c 'GRANT CONNECT ON DATABASE astra TO astra_app; GRANT USAGE ON SCHEMA public TO astra_app;'
    if ($LASTEXITCODE -ne 0) { throw 'Application database privilege setup failed.' }
    & $psql @baseArguments -t -A -c "SELECT version();"
    if ($LASTEXITCODE -ne 0) { throw 'Database readiness check failed.' }
} finally {
    if ($null -eq $previousPassword) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPassword }
}
Write-Output "PostgreSQL ready at 127.0.0.1:$Port / astra. Backend reads .runtime/postgres.json appUrl; migrations read adminUrl. Credentials were not printed."
