param([switch]$UpdateDefinitions)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeDirectory = Join-Path $workspaceRoot '.runtime/clamav'
$version = '1.4.6'
$fingerprint = '5BADCA2665EF59DCF8A23D8B707F0DB480836771'
$archiveName = "clamav-$version.win.x64.zip"
$binaryDirectory = Join-Path $runtimeDirectory "clamav-$version.win.x64"
if (Get-Process clamd,freshclam -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($runtimeDirectory, [StringComparison]::OrdinalIgnoreCase) }) {
    throw 'Stop the workspace scanner before reinstalling or changing its configuration.'
}
foreach ($directory in @('', 'downloads', 'gnupg', 'database', 'logs', 'tmp')) {
    New-Item -ItemType Directory -Path (Join-Path $runtimeDirectory $directory) -Force | Out-Null
}
# ClamD may create temporary extracted content. Only this Windows user, SYSTEM and
# administrators may read the runtime tree; no service or firewall rule is installed.
$runtimeAcl = Get-Acl -LiteralPath $runtimeDirectory
$runtimeAcl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($runtimeAcl.Access)) { $runtimeAcl.RemoveAccessRuleSpecific($rule) }
foreach ($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $runtimeAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
$runtimeFolder = Get-Item -LiteralPath $runtimeDirectory
if ($runtimeFolder.PSObject.Methods.Name -contains 'SetAccessControl') {
    $runtimeFolder.SetAccessControl($runtimeAcl)
} else {
    [IO.FileSystemAclExtensions]::SetAccessControl($runtimeFolder, $runtimeAcl)
}
$gpgCommand = Get-Command gpg.exe -ErrorAction SilentlyContinue
$gpg = if ($gpgCommand) { $gpgCommand.Source } else { Join-Path $env:ProgramFiles 'Git/usr/bin/gpg.exe' }
if (-not (Test-Path -LiteralPath $gpg)) { throw 'GnuPG is required to verify the official release. Install Git for Windows (includes gpg.exe), then retry.' }
$keyPath = Join-Path $runtimeDirectory 'downloads/cisco-talos.gpg'
$archivePath = Join-Path $runtimeDirectory "downloads/$archiveName"
$signaturePath = "$archivePath.sig"
$keyUrl = 'https://raw.githubusercontent.com/Cisco-Talos/clamav-documentation/main/src/manual/cisco-talos.gpg'
$releaseUrl = "https://www.clamav.net/downloads/production/$archiveName"
function Get-OfficialFile([string]$Url, [string]$Path) {
    if (Test-Path -LiteralPath $Path) { return }
    $temporaryPath = "$Path.part"
    & curl.exe --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 30 --max-time 1800 --retry 2 --output $temporaryPath $Url
    if ($LASTEXITCODE -ne 0) { throw "Official download failed: $Url. Partial download retained for diagnosis." }
    Move-Item -LiteralPath $temporaryPath -Destination $Path
}
Get-OfficialFile $keyUrl $keyPath
Get-OfficialFile $releaseUrl $archivePath
Get-OfficialFile "$releaseUrl.sig" $signaturePath
$gpgHome = Join-Path $runtimeDirectory 'gnupg'
# Git for Windows GnuPG uses MSYS paths even when launched from PowerShell.
function Convert-GpgPath([string]$Path) {
    if ($gpg.Replace('\', '/') -match '/Git/usr/bin/gpg.exe$') {
        $fullPath = [IO.Path]::GetFullPath($Path).Replace('\', '/')
        return '/' + $fullPath.Substring(0, 1).ToLowerInvariant() + $fullPath.Substring(2)
    }
    return $Path
}
$gpgHomeArgument = Convert-GpgPath $gpgHome
& $gpg --batch --homedir $gpgHomeArgument --import (Convert-GpgPath $keyPath)
if ($LASTEXITCODE -ne 0) { throw 'Official signing-key import failed.' }
$keyInfo = & $gpg --batch --homedir $gpgHomeArgument --with-colons --fingerprint $fingerprint
if ($LASTEXITCODE -ne 0 -or -not ($keyInfo -match "^fpr:::::::::$fingerprint`:")) { throw 'Cisco Talos signing-key fingerprint does not match the pinned official key.' }
$signatureInfo = & $gpg --batch --homedir $gpgHomeArgument --status-fd 1 --verify (Convert-GpgPath $signaturePath) (Convert-GpgPath $archivePath)
if ($LASTEXITCODE -ne 0 -or -not ($signatureInfo -match "^\[GNUPG:\] VALIDSIG $fingerprint ")) { throw 'ClamAV detached signature validation failed. Refusing to install.' }
if (-not (Test-Path -LiteralPath (Join-Path $binaryDirectory 'clamd.exe'))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $safeRoot = [IO.Path]::GetFullPath($runtimeDirectory) + [IO.Path]::DirectorySeparatorChar
        foreach ($entry in $archive.Entries) {
            $destination = [IO.Path]::GetFullPath((Join-Path $safeRoot $entry.FullName))
            if (-not $destination.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $entry.FullName.StartsWith("clamav-$version.win.x64/", [StringComparison]::Ordinal)) { throw 'Unexpected ZIP path; extraction refused.' }
        }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $runtimeDirectory)
}
$dbPath = Join-Path $runtimeDirectory 'database'
$temporaryPath = Join-Path $runtimeDirectory 'tmp'
$clamdConfig = Join-Path $runtimeDirectory 'clamd.conf'
$freshclamConfig = Join-Path $runtimeDirectory 'freshclam.conf'
$clamdLog = Join-Path $runtimeDirectory 'logs/clamd.log'
$freshclamLog = Join-Path $runtimeDirectory 'logs/freshclam.log'
$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText($clamdConfig, @"
# Generated by scripts/runtime/install-clamav.ps1. Local INSTREAM only.
DatabaseDirectory "$dbPath"
TemporaryDirectory "$temporaryPath"
LogFile "$clamdLog"
LogFileMaxSize 2M
LogRotate yes
LogTime yes
TCPSocket 3310
TCPAddr 127.0.0.1
Foreground yes
MaxThreads 2
MaxQueue 8
ReadTimeout 30
CommandReadTimeout 5
SendBufTimeout 5000
StreamMaxLength 2M
MaxScanTime 20000
MaxScanSize 16M
MaxFileSize 2M
MaxRecursion 10
MaxFiles 100
BytecodeTimeout 5000
AlertExceedsMax yes
AlertEncrypted yes
ScanArchive yes
ScanPDF yes
SelfCheck 600
ConcurrentDatabaseReload no
OfficialDatabaseOnly yes
LeaveTemporaryFiles no
"@, $utf8)
[IO.File]::WriteAllText($freshclamConfig, @"
# Official signature updates every two hours while this PC is running.
DatabaseDirectory "$dbPath"
DatabaseMirror database.clamav.net
DNSDatabaseInfo current.cvd.clamav.net
UpdateLogFile "$freshclamLog"
LogFileMaxSize 2M
LogRotate yes
LogTime yes
Checks 12
ConnectTimeout 30
ReceiveTimeout 300
MaxAttempts 2
TestDatabases yes
Foreground yes
NotifyClamd "$clamdConfig"
"@, $utf8)
$metadata = [ordered]@{
    version = $version; sourcePage = 'https://www.clamav.net/downloads'; sourceUrl = $releaseUrl
    signingKeySource = $keyUrl; signingFingerprint = $fingerprint; signatureVerifiedAt = [DateTime]::UtcNow.ToString('o')
    sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    scope = 'workspace-local; current Windows user; loopback only; no Windows service'
}
[IO.File]::WriteAllText((Join-Path $runtimeDirectory 'installation.json'), ($metadata | ConvertTo-Json), $utf8)
& (Join-Path $binaryDirectory 'clamd.exe') "--config-file=$clamdConfig" --version
if ($LASTEXITCODE -ne 0) { throw 'ClamD executable validation failed.' }
if ($UpdateDefinitions) {
    & (Join-Path $binaryDirectory 'freshclam.exe') --quiet "--config-file=$freshclamConfig"
    if ($LASTEXITCODE -ne 0) { throw 'Official definition update failed. Scanning must remain unavailable until current definitions load.' }
}
Write-Output 'Officially signed ClamAV runtime installed. Run scripts/runtime/start-clamav.ps1 to start the scanner and updater.'
