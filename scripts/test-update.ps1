$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$archive = Join-Path $projectRoot ('dist\Island-Now-' + $version + '-windows.zip')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('island-update-test-' + [Guid]::NewGuid().ToString('N'))
$oldPort = $env:ISLAND_PORT; $oldData = $env:ISLAND_DATA_DIR
$env:ISLAND_PORT = '17658'; $env:ISLAND_DATA_DIR = $null
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Json([string]$path, $value) { [IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Depth 20), $utf8) }
function Await-Version([string]$wanted, [int]$timeoutSeconds = 20) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        try { $state = Invoke-RestMethod 'http://127.0.0.1:17658/api/state' -TimeoutSec 1; if ($state.version -eq $wanted) { return $state } } catch { }
    }
    throw ('Version nicht erreichbar: ' + $wanted)
}
function Stop-Test-App([string]$application) {
    Get-Process -Name 'Island-Now' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $application } | ForEach-Object { Stop-Process -Id $_.Id -Force }
    Start-Sleep -Milliseconds 1200
}
try {
    foreach ($broken in @($false, $true)) {
        $caseRoot = Join-Path $testRoot $(if ($broken) { 'rollback' } else { 'success' })
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $caseRoot)
        $installRoot = Join-Path $caseRoot 'Island-Now'
        $application = Join-Path $installRoot 'Island-Now.exe'
        $runtimeMarker = Join-Path $installRoot 'runtime\preserve.marker'
        New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeMarker) | Out-Null
        [IO.File]::WriteAllText($runtimeMarker, 'Keep the private Node runtime during updates.', $utf8)
        $runtimeHash = (Get-FileHash $runtimeMarker -Algorithm SHA256).Hash
        $packagePath = Join-Path $installRoot 'package.json'
        $oldPackage = Get-Content $packagePath -Raw | ConvertFrom-Json; $oldPackage.version = '0.9.0'; Write-Json $packagePath $oldPackage
        $oldTray = Start-Process -FilePath $application -ArgumentList '--quiet' -WorkingDirectory $installRoot -PassThru
        $before = Await-Version '0.9.0'
        $privateFile = Join-Path $installRoot '.data\state.enc'
        $beforeHash = (Get-FileHash $privateFile -Algorithm SHA256).Hash
        $token = [Guid]::NewGuid().ToString('N')
        $stage = Join-Path $installRoot ('.updates\pending\' + $token)
        $expanded = Join-Path $stage 'expanded'
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $expanded)
        $payload = Join-Path $stage 'payload'
        Move-Item -LiteralPath (Join-Path $expanded 'Island-Now') -Destination $payload
        $manifest = Get-Content (Join-Path $payload 'update-manifest.json') -Raw | ConvertFrom-Json
        if ($broken) {
            [IO.File]::WriteAllText((Join-Path $payload 'server.mjs'), "throw new Error('Expected update rollback test');", $utf8)
            $changed = $manifest.files | Where-Object { $_.path -eq 'server.mjs' }
            $changed.bytes = (Get-Item (Join-Path $payload 'server.mjs')).Length
            $changed.sha256 = (Get-FileHash (Join-Path $payload 'server.mjs') -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        Copy-Item -LiteralPath (Join-Path $installRoot 'windows\Install-Update.ps1') -Destination (Join-Path $stage 'Install-Update.ps1')
        $planPath = Join-Path $stage 'plan.json'
        Write-Json $planPath @{ schema = 1; token = $token; root = $installRoot; version = $version; previousVersion = '0.9.0'; files = $manifest.files }
        $installer = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $stage 'Install-Update.ps1') + '"'), '-PlanPath', ('"' + $planPath + '"'), '-TrayPid', $oldTray.Id) -WindowStyle Hidden -PassThru
        Stop-Process -Id $oldTray.Id -Force
        if ($broken) {
            # Rollback shows an explanatory MessageBox, so inspect state instead of waiting for that UI.
            Start-Sleep -Seconds 19
            $after = Await-Version '0.9.0' 90
        } else {
            if (-not $installer.WaitForExit(55000) -or $installer.ExitCode -ne 0) { throw 'Update-Installer fehlgeschlagen.' }
            $after = Await-Version $version
        }
        if ($after.profiles[0].overlayUrl -ne $before.profiles[0].overlayUrl) { throw 'OBS-Link wurde veraendert.' }
        if ((Get-FileHash $privateFile -Algorithm SHA256).Hash -ne $beforeHash) { throw 'Private Daten wurden veraendert.' }
        if ((Get-FileHash $runtimeMarker -Algorithm SHA256).Hash -ne $runtimeHash) { throw 'Private Node-Laufzeit wurde veraendert.' }
        if (-not (Test-Path (Join-Path $installRoot '.updates\backups'))) { throw 'Programmsicherung fehlt.' }
        Stop-Test-App $application
        if (-not $installer.HasExited) { Stop-Process -Id $installer.Id -Force }
    }
    Write-Output 'Windows-Update, Rollback und Erhalt privater Daten und Laufzeit geprueft.'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Get-Process -Name 'Island-Now' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.Id -Force }
        Start-Sleep -Milliseconds 1200
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
    $env:ISLAND_PORT = $oldPort; $env:ISLAND_DATA_DIR = $oldData
}
