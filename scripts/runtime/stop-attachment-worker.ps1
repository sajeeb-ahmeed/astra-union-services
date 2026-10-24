$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$privateDirectory = Join-Path $env:USERPROFILE '.astra-scanner'
$statePath = Join-Path $privateDirectory 'process.json'
if ((Test-Path -LiteralPath $privateDirectory) -and ((Get-Item -LiteralPath $privateDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Private scanner directory must not be a symlink or junction.' }
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No owned attachment worker recorded.'; return }
if ((Get-Item -LiteralPath $statePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private process record must not be a symlink.' }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$nodePath = (Get-Command node -ErrorAction Stop).Source
$process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if ($process) {
    $recordedStart = if ($state.startedAt -is [DateTime]) { $state.startedAt } else { [DateTime]::Parse($state.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) }
    if ($process.Path -ne $nodePath -or $state.path -ne $nodePath -or $state.workspace -ne $workspaceRoot -or $process.StartTime.ToUniversalTime().Ticks -ne $recordedStart.ToUniversalTime().Ticks) { throw 'Process identity mismatch. Refusing to stop another process.' }
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
}
Remove-Item -LiteralPath $statePath -Force
Write-Output 'Attachment worker stopped. Pending files stay quarantined; unfinished leases expire and retry with a bound limit.'
