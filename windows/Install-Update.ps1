param([Parameter(Mandatory=$true)][string]$PlanPath, [Parameter(Mandatory=$true)][int]$TrayPid)
$ErrorActionPreference = 'Stop'
$updatePlan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$stageDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PlanPath))
$installRoot = [IO.Path]::GetFullPath($updatePlan.root).TrimEnd('\')
$expectedStage = Join-Path (Join-Path (Join-Path $installRoot '.updates') 'pending') $updatePlan.token
if ($updatePlan.schema -ne 1 -or $updatePlan.token -notmatch '^[a-f0-9]{32}$' -or $stageDirectory -ne [IO.Path]::GetFullPath($expectedStage) -or $updatePlan.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Ungueltiger Update-Plan.' }
$payloadDirectory = Join-Path $stageDirectory 'payload'
$backupDirectory = Join-Path (Join-Path $installRoot '.updates\backups') ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $updatePlan.previousVersion + '-' + $updatePlan.token)
$written = New-Object 'System.Collections.Generic.List[object]'
$rollbackFailed = $false
$newTray = $null
$logPath = Join-Path $installRoot '.updates\update.log'
function Write-UpdateLog([string]$text) { try { Add-Content -LiteralPath $logPath -Value ((Get-Date -Format s) + ' ' + $text) } catch { } }
function Safe-Relative([string]$relative) {
    if ($relative.Length -gt 220 -or $relative -match '[\\:\x00-\x1f]' -or $relative.StartsWith('/')) { throw 'Ungueltiger Dateipfad.' }
    foreach ($part in $relative.Split('/')) {
        if (-not $part -or $part.StartsWith('.') -or $part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'Unsicherer Dateipfad.' }
    }
    return $relative.Replace('/', '\')
}
function Check-Reparse([string]$path) {
    $cursor = $path
    while ($cursor -and $cursor.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Update-Ziel enthaelt eine Verknuepfung.' }
        if ($cursor -eq $installRoot) { break }
        $cursor = Split-Path -Parent $cursor
    }
}
try {
    Check-Reparse $installRoot
    foreach ($entry in $updatePlan.files) {
        $relative = Safe-Relative $entry.path
        $source = Join-Path $payloadDirectory $relative
        Check-Reparse $source
        if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Paketdatei hat eine falsche Pruefsumme.' }
    }
    $oldTray = Get-Process -Id $TrayPid -ErrorAction SilentlyContinue
    if ($oldTray) {
        if ($oldTray.ProcessName -ne 'Island-Now') { throw 'Unerwarteter Tray-Prozess.' }
        Wait-Process -Id $TrayPid -Timeout 20 -ErrorAction Stop
    }
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    # The private data directory is never replaced by an application payload.
    foreach ($entry in $updatePlan.files) {
        $relative = Safe-Relative $entry.path
        $source = Join-Path $payloadDirectory $relative
        $destination = Join-Path $installRoot $relative
        $backup = Join-Path $backupDirectory $relative
        Check-Reparse $destination
        $existed = Test-Path -LiteralPath $destination -PathType Leaf
        if ($existed) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
            Copy-Item -LiteralPath $destination -Destination $backup -Force
        }
        $written.Add([PSCustomObject]@{ destination = $destination; backup = $backup; existed = $existed })
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Pruefung nach dem Kopieren fehlgeschlagen.' }
    }
    $written | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupDirectory 'rollback-files.json') -Encoding UTF8
    $newTray = Start-Process -FilePath (Join-Path $installRoot 'Island-Now.exe') -ArgumentList '--quiet' -WorkingDirectory $installRoot -PassThru
    $listenPort = if ($env:ISLAND_PORT) { [int]$env:ISLAND_PORT } else { 17653 }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $appState = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $listenPort + '/api/state') -TimeoutSec 2
            if ($appState.app -eq 'Island Now' -and $appState.version -eq $updatePlan.version) { $healthy = $true; break }
        } catch { }
    }
    if (-not $healthy) { throw 'Die neue Version antwortet nach dem Neustart nicht.' }
    @{ version = $updatePlan.version; previousVersion = $updatePlan.previousVersion; installedAt = (Get-Date -Format s); backup = $backupDirectory } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot '.updates\last-update.json') -Encoding UTF8
    Write-UpdateLog ('Update auf ' + $updatePlan.version + ' erfolgreich.')
} catch {
    $failureMessage = $_.Exception.Message
    if ($newTray) {
        try { if (-not $newTray.HasExited) { Stop-Process -Id $newTray.Id -Force; $newTray.WaitForExit(5000) | Out-Null } } catch { }
        Start-Sleep -Milliseconds 1500
    }
    for ($index = $written.Count - 1; $index -ge 0; $index--) {
        $record = $written[$index]
        try {
            if ($record.existed) { Copy-Item -LiteralPath $record.backup -Destination $record.destination -Force }
            elseif (Test-Path -LiteralPath $record.destination -PathType Leaf) { Remove-Item -LiteralPath $record.destination -Force }
        } catch { $rollbackFailed = $true; Write-UpdateLog ('Rueckwechsel fehlgeschlagen: ' + $_.Exception.Message) }
    }
    Write-UpdateLog ('Update fehlgeschlagen: ' + $failureMessage)
    try {
        $previousTray = Get-Process -Id $TrayPid -ErrorAction SilentlyContinue
        if ($previousTray -and $previousTray.ProcessName -eq 'Island-Now') { Wait-Process -Id $TrayPid -Timeout 20 -ErrorAction SilentlyContinue }
        Start-Process -FilePath (Join-Path $installRoot 'Island-Now.exe') -ArgumentList '--quiet' -WorkingDirectory $installRoot
    } catch { }
    Add-Type -AssemblyName System.Windows.Forms
    $resultMessage = if ($rollbackFailed) { 'Das Update wurde abgebrochen. Einige Programmdateien konnten nicht wiederhergestellt werden. Die Sicherung liegt unter .updates\backups. Anmeldung und Einstellungen wurden nicht ersetzt.' } else { 'Das Update wurde abgebrochen und die bisherigen Programmdateien wurden wiederhergestellt. Anmeldung und Einstellungen wurden nicht ersetzt.' }
    [System.Windows.Forms.MessageBox]::Show(($resultMessage + [Environment]::NewLine + [Environment]::NewLine + $failureMessage), 'Island Now - Update') | Out-Null
    exit 1
}
