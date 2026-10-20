param([switch]$PortableNode)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
foreach ($file in @('windows\Install-Update.ps1', 'scripts\build-windows.ps1', 'scripts\test-windows.ps1')) {
    $tokens = $null; $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot $file), [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) { throw ('PowerShell-Syntaxfehler: ' + $file + ' ' + ($parseErrors | Out-String)) }
}
$testData = Join-Path ([IO.Path]::GetTempPath()) ('island-windows-' + [Guid]::NewGuid().ToString('N'))
$previousPort = $env:ISLAND_PORT; $previousData = $env:ISLAND_DATA_DIR
$env:ISLAND_PORT = '17657'; $env:ISLAND_DATA_DIR = $testData
$nativeProcess = $null
try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $projectRoot 'Island-Now.exe'
    $startInfo.Arguments = '--quiet'; $startInfo.WorkingDirectory = $projectRoot; $startInfo.UseShellExecute = $false
    if ($PortableNode) {
        if (-not (Test-Path (Join-Path $projectRoot 'runtime\node.exe'))) { throw 'Private Node-Laufzeit fehlt.' }
        $startInfo.EnvironmentVariables['PATH'] = Join-Path $env:WINDIR 'System32'
        foreach ($key in @('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA')) { $startInfo.EnvironmentVariables[$key] = Join-Path $testData 'no-system-node' }
    }
    $nativeProcess = [System.Diagnostics.Process]::Start($startInfo)
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $state = Invoke-RestMethod 'http://127.0.0.1:17657/api/state' -TimeoutSec 1; if ($state.app -eq 'Island Now') { $healthy = $true; break } } catch { }
        if ($nativeProcess.HasExited) { throw 'Die native Tray-Anwendung wurde unerwartet beendet.' }
    }
    if (-not $healthy) { throw 'Tray-Backend wurde nicht erreichbar.' }
    if ($state.version -ne (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version) { throw 'Falsche Backend-Version.' }
    if ($PortableNode) {
        $child = Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $nativeProcess.Id) | Where-Object { $_.Name -eq 'node.exe' }
        if ($child.ExecutablePath -ne (Join-Path $projectRoot 'runtime\node.exe')) { throw 'Tray verwendet nicht die private Node-Laufzeit.' }
    }
    Stop-Process -Id $nativeProcess.Id -Force; $nativeProcess.WaitForExit(5000) | Out-Null
    $stopped = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { Invoke-RestMethod 'http://127.0.0.1:17657/api/state' -TimeoutSec 1 | Out-Null } catch { $stopped = $true; break }
    }
    if (-not $stopped) { throw 'Das Backend blieb nach Ende des Tray-Prozesses aktiv.' }
    Write-Output 'Windows-Tray und Backend-Lebenszyklus geprueft.'
} finally {
    if ($nativeProcess -and -not $nativeProcess.HasExited) { Stop-Process -Id $nativeProcess.Id -Force }
    $env:ISLAND_PORT = $previousPort; $env:ISLAND_DATA_DIR = $previousData
    if (Test-Path -LiteralPath $testData) { Remove-Item -LiteralPath $testData -Recurse -Force }
}
