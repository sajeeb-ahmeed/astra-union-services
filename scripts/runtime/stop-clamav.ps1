$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeDirectory = Join-Path $workspaceRoot '.runtime/clamav'
$statePath = Join-Path $runtimeDirectory 'processes.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No workspace-owned scanner processes recorded.'; return }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$safeRoot = [IO.Path]::GetFullPath($runtimeDirectory) + [IO.Path]::DirectorySeparatorChar
$ownedProcesses = @()
foreach ($name in @('freshclam', 'clamd')) {
    $record = $state.$name
    if (-not $record) { continue }
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $expectedPath = [IO.Path]::GetFullPath($record.path)
    $recordedStart = if ($record.startedAt -is [DateTime]) { $record.startedAt } else { [DateTime]::Parse($record.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) }
    if (-not $expectedPath.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($expectedPath) -ne "$name.exe" -or $process.Path -ne $expectedPath -or $process.StartTime.ToUniversalTime().Ticks -ne $recordedStart.ToUniversalTime().Ticks) {
        throw "Recorded $name PID does not match the workspace-owned process. Nothing else will be stopped."
    }
    $ownedProcesses += $process
}
foreach ($process in $ownedProcesses) {
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
    Write-Output "Stopped workspace $($process.ProcessName) (PID $($process.Id))."
}
Remove-Item -LiteralPath $statePath
Write-Output 'Scanner stopped. Quarantined uploads wait until the scanner and outbound worker are running again.'
