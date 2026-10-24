param([switch]$SkipDefinitionUpdate, [int]$StartupTimeoutSeconds = 180)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeDirectory = Join-Path $workspaceRoot '.runtime/clamav'
$metadataPath = Join-Path $runtimeDirectory 'installation.json'
if (-not (Test-Path -LiteralPath $metadataPath)) { throw 'Run scripts/runtime/install-clamav.ps1 first.' }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$binaryDirectory = Join-Path $runtimeDirectory "clamav-$($metadata.version).win.x64"
$clamdPath = Join-Path $binaryDirectory 'clamd.exe'
$freshclamPath = Join-Path $binaryDirectory 'freshclam.exe'
$statePath = Join-Path $runtimeDirectory 'processes.json'
$clamdConfig = Join-Path $runtimeDirectory 'clamd.conf'
$freshclamConfig = Join-Path $runtimeDirectory 'freshclam.conf'
$configLines = Get-Content -LiteralPath $clamdConfig
$addresses = @($configLines | Where-Object { $_ -match '^\s*TCPAddr\s+' })
$ports = @($configLines | Where-Object { $_ -match '^\s*TCPSocket\s+' })
if ($addresses.Count -ne 1 -or $addresses[0] -notmatch '^TCPAddr 127\.0\.0\.1$' -or $ports.Count -ne 1 -or $ports[0] -notmatch '^TCPSocket 3310$') {
    throw 'Refusing to start: configuration must bind exactly 127.0.0.1:3310.'
}
$state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
function Get-OwnedProcess($Record, [string]$ExpectedPath) {
    if (-not $Record) { return $null }
    $process = Get-Process -Id $Record.pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $recordedStart = if ($Record.startedAt -is [DateTime]) { $Record.startedAt } else { [DateTime]::Parse($Record.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) }
    if ($process.Path -ne $ExpectedPath -or $process.StartTime.ToUniversalTime().Ticks -ne $recordedStart.ToUniversalTime().Ticks) { throw 'Recorded PID belongs to another process. Refusing to reuse it.' }
    return $process
}
function Save-ProcessState($Clamd, $Freshclam) {
    $result = [ordered]@{ clamd = $null; freshclam = $null }
    if ($Clamd) { $result.clamd = @{pid = $Clamd.Id; startedAt = $Clamd.StartTime.ToUniversalTime().ToString('o'); path = $Clamd.Path} }
    if ($Freshclam) { $result.freshclam = @{pid = $Freshclam.Id; startedAt = $Freshclam.StartTime.ToUniversalTime().ToString('o'); path = $Freshclam.Path} }
    [IO.File]::WriteAllText($statePath, ($result | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}
function Invoke-ClamdVersion {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $connection = $client.ConnectAsync('127.0.0.1', 3310)
        if (-not $connection.Wait(1000)) { throw 'ClamD connection timeout.' }
        $stream = $client.GetStream()
        $stream.ReadTimeout = 3000
        $command = [Text.Encoding]::ASCII.GetBytes("zVERSION`0")
        $stream.Write($command, 0, $command.Length)
        $buffer = New-Object byte[] 1024
        $count = $stream.Read($buffer, 0, $buffer.Length)
        return [Text.Encoding]::ASCII.GetString($buffer, 0, $count).Trim([char]0, [char]10, [char]13)
    } finally { $client.Dispose() }
}
$clamd = Get-OwnedProcess $state.clamd $clamdPath
$freshclam = Get-OwnedProcess $state.freshclam $freshclamPath
$listeners = @(Get-NetTCPConnection -LocalPort 3310 -State Listen -ErrorAction SilentlyContinue)
if ($listeners | Where-Object { -not $clamd -or $_.OwningProcess -ne $clamd.Id -or $_.LocalAddress -ne '127.0.0.1' }) { throw 'Port 3310 is occupied by another listener. Refusing to start or connect to it.' }
if (-not $clamd) {
    if (-not $SkipDefinitionUpdate -and -not $freshclam) {
        & $freshclamPath --quiet "--config-file=$freshclamConfig"
        if ($LASTEXITCODE -ne 0) { throw 'Official definition update failed. Inspect .runtime/clamav/logs/freshclam.log; do not bypass stale-definition protection.' }
    }
    $clamd = Start-Process -FilePath $clamdPath -ArgumentList @('--foreground', '--fail-if-cvd-older-than=2', ('--config-file="' + $clamdConfig + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'logs/clamd.stdout.log') -RedirectStandardError (Join-Path $runtimeDirectory 'logs/clamd.stderr.log')
    Save-ProcessState $clamd $freshclam
}
$deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
$versionResponse = $null
while ([DateTime]::UtcNow -lt $deadline) {
    $clamd.Refresh()
    if ($clamd.HasExited) { throw 'ClamD exited during startup. Inspect .runtime/clamav/logs/clamd.stderr.log.' }
    try { $versionResponse = Invoke-ClamdVersion; break } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $versionResponse -or $versionResponse -notmatch '^ClamAV [0-9.]+/\d+/(.+)$') { throw 'ClamD did not report an official signature database before the startup timeout.' }
$databaseTime = [DateTime]::ParseExact($Matches[1].Trim(), [string[]]@('ddd MMM d HH:mm:ss yyyy', 'ddd MMM dd HH:mm:ss yyyy'), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AllowWhiteSpaces)
if ($databaseTime -lt (Get-Date).AddHours(-48) -or $databaseTime -gt (Get-Date).AddHours(1)) { throw 'ClamD definitions are stale or dated in the future. Scanner must remain unavailable.' }
$listeners = @(Get-NetTCPConnection -LocalPort 3310 -State Listen -ErrorAction Stop)
if (-not $listeners.Count -or ($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' -or $_.OwningProcess -ne $clamd.Id })) { throw 'ClamD must listen only on 127.0.0.1:3310.' }
if (-not $freshclam) {
    $freshclam = Start-Process -FilePath $freshclamPath -ArgumentList @('--daemon', '--quiet', ('--config-file="' + $freshclamConfig + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'logs/freshclam.stdout.log') -RedirectStandardError (Join-Path $runtimeDirectory 'logs/freshclam.stderr.log')
    Save-ProcessState $clamd $freshclam
    Start-Sleep -Milliseconds 500
    $freshclam.Refresh()
    if ($freshclam.HasExited) { throw 'Definition updater exited. Inspect .runtime/clamav/logs/freshclam.stderr.log.' }
}
Write-Output $versionResponse
Write-Output "Local scanner ready at 127.0.0.1:3310 (PID $($clamd.Id)); official updater running (PID $($freshclam.Id))."
Write-Output 'Start the Astra outbound worker separately. Stop with scripts/runtime/stop-clamav.ps1.'
