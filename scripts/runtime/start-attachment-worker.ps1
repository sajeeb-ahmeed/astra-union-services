param([switch]$SkipEngineStart)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$privateDirectory = Join-Path $env:USERPROFILE '.astra-scanner'
$configPath = Join-Path $privateDirectory 'worker.json'
$statePath = Join-Path $privateDirectory 'process.json'
if (Test-Path -LiteralPath $privateDirectory) {
    if ((Get-Item -LiteralPath $privateDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private scanner directory must not be a symlink or junction.' }
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Private scanner configuration is missing. See docs/ATTACHMENT_SCANNER_RUNTIME.md; do not paste the secret in chat.' }
$privateFiles = @(Get-ChildItem -LiteralPath $privateDirectory -Force)
if ($privateFiles | Where-Object { $_.PSIsContainer -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }) { throw 'Private scanner files must be regular files, without nested directories, symlinks or junctions.' }
# Replace all inherited and explicit access rules, including grants to unrelated
# principals left on a reused directory. Do not change machine-wide policies.
function Set-ScannerPrivateAcl($Item) {
    $acl = Get-Acl -LiteralPath $Item.FullName
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    $inheritance = if ($Item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', $inheritance, 'None', 'Allow'))
    }
    if ($Item.PSObject.Methods.Name -contains 'SetAccessControl') { $Item.SetAccessControl($acl) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl($Item, $acl) }
}
Set-ScannerPrivateAcl (Get-Item -LiteralPath $privateDirectory -Force)
foreach ($item in $privateFiles) { Set-ScannerPrivateAcl $item }
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if ($existing) {
        $recordedStart = if ($state.startedAt -is [DateTime]) { $state.startedAt } else { [DateTime]::Parse($state.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) }
        if ($existing.Path -ne $nodePath -or $state.path -ne $nodePath -or $state.workspace -ne $workspaceRoot -or $existing.StartTime.ToUniversalTime().Ticks -ne $recordedStart.ToUniversalTime().Ticks) { throw 'Saved PID belongs to another process. Refusing to reuse it.' }
        Write-Output "Attachment worker already running (PID $($existing.Id))."
        return
    }
}
if (-not $SkipEngineStart) { & (Join-Path $PSScriptRoot 'start-clamav.ps1') }
Push-Location $workspaceRoot
try {
    & $nodePath --import tsx scripts/scanner/real-engine.ts
    if ($LASTEXITCODE -ne 0) { throw 'Real antivirus readiness test failed. Worker was not started.' }
    # Worker logs contain statuses/IDs only. Keep one previous run, not unbounded copies.
    foreach ($name in @('worker.stdout.log','worker.stderr.log')) {
        $file = Join-Path $privateDirectory $name
        if (Test-Path -LiteralPath $file) { Move-Item -LiteralPath $file -Destination ($file + '.previous') -Force }
    }
    $workerScript = Join-Path $workspaceRoot 'scripts/scanner/run.ts'
    $process = Start-Process -FilePath $nodePath -ArgumentList @('--import','tsx',('"' + $workerScript + '"')) -WorkingDirectory $workspaceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $privateDirectory 'worker.stdout.log') -RedirectStandardError (Join-Path $privateDirectory 'worker.stderr.log')
    [IO.File]::WriteAllText($statePath, (@{pid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o');path=$nodePath;workspace=$workspaceRoot} | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { throw 'Worker exited at startup. Check its private log; secret values are withheld.' }
    Write-Output "Attachment worker started (PID $($process.Id)). PC sleep, shutdown or engine failure leaves files quarantined."
} finally { Pop-Location }
