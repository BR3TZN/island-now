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
$origin = 'http://127.0.0.1:17657'

function Test-WebViewRuntime {
    $id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($base in @('HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE', 'HKCU:\SOFTWARE')) {
        $entry = Get-ItemProperty -LiteralPath "$base\Microsoft\EdgeUpdate\Clients\$id" -Name pv -ErrorAction SilentlyContinue
        if ($entry.pv -and $entry.pv -ne '0.0.0.0') { return $true }
    }
    return $false
}

function Wait-DesktopCondition([string]$description, [scriptblock]$check, [int]$seconds = 15) {
    $deadline = (Get-Date).AddSeconds($seconds)
    do {
        if (& $check) { return }
        Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $deadline)
    $log = Get-Content (Join-Path $testData 'tray.log') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    throw "$description. Tray-Protokoll:`n$log"
}

function Test-DesktopWindow($startInfo, $nativeProcess, $state) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IslandDesktopSmoke {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out WindowRect rect);
    [StructLayout(LayoutKind.Sequential)] private struct WindowRect { public int Left, Top, Right, Bottom; }
    public static bool OnMonitor(IntPtr window) { return MonitorFromWindow(window, 0) != IntPtr.Zero; }
    public static string Bounds(IntPtr window) {
        WindowRect rect;
        if (!GetWindowRect(window, out rect)) throw new InvalidOperationException("GetWindowRect failed.");
        return String.Format("{0},{1},{2},{3}", rect.Left, rect.Top, rect.Right, rect.Bottom);
    }
}
'@
    function Send-SystemCommand([IntPtr]$window, [uint32]$command) {
        if (-not [IslandDesktopSmoke]::PostMessage($window, 0x112, [UIntPtr]::new($command), [IntPtr]::Zero)) { throw "Fensterbefehl fehlgeschlagen: $command" }
    }
    function Open-Desktop {
        $duplicate = [Diagnostics.Process]::Start($startInfo)
        try { if (-not $duplicate.WaitForExit(5000) -or $duplicate.ExitCode -ne 0) { throw 'Zweiter Start hat das Fenster nicht aktiviert.' } }
        finally { if (-not $duplicate.HasExited) { $duplicate.Kill() }; $duplicate.Dispose() }
        Wait-DesktopCondition 'Fenster wurde nicht sichtbar auf einem Bildschirm wiederhergestellt' {
            $nativeProcess.Refresh()
            $handle = $nativeProcess.MainWindowHandle
            $handle -ne [IntPtr]::Zero -and [IslandDesktopSmoke]::IsWindowVisible($handle) -and
                -not [IslandDesktopSmoke]::IsIconic($handle) -and [IslandDesktopSmoke]::OnMonitor($handle)
        }
        return $nativeProcess.MainWindowHandle
    }
    function Set-CloseAction($value) {
        $headers = @{ 'Origin' = $origin; 'X-Island-CSRF' = $state.csrf }
        $response = Invoke-RestMethod "$origin/api/desktop" -Method Patch -Headers $headers -ContentType 'application/json' -Body (@{closeAction=$value} | ConvertTo-Json -Compress) -TimeoutSec 5
        if ($response.closeAction -ne $value) { throw 'Fensterverhalten wurde nicht gespeichert.' }
        Start-Sleep -Milliseconds 250 # The tray receives the new action over the backend pipe.
    }
    $window = Open-Desktop
    if (Test-WebViewRuntime) {
        Wait-DesktopCondition 'WebView2 hat die lokale Oberflaeche nicht geladen' {
            $log = Get-Content (Join-Path $testData 'tray.log') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
            $log -like '*Desktop-Fenster geladen.*'
        } 35
    } else {
        Wait-DesktopCondition 'WebView2-Ersatzansicht fehlt' {
            (Get-Content (Join-Path $testData 'tray.log') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) -like '*WebView2:*'
        }
        Write-Output 'WebView2 Runtime nicht vorhanden; Windows-Ersatzansicht geprueft.'
    }
    if (-not [IslandDesktopSmoke]::MoveWindow($window, 40, 60, 760, 540, $true)) { throw 'Fenster konnte nicht platziert werden.' }
    $normalBounds = [IslandDesktopSmoke]::Bounds($window)
    # SC_MINIMIZE matches the caption button.
    Send-SystemCommand $window 0xF020
    Wait-DesktopCondition 'Minimieren hat das Fenster nicht ins Tray ausgeblendet' { -not [IslandDesktopSmoke]::IsWindowVisible($window) }
    if ($nativeProcess.HasExited -or (Invoke-RestMethod "$origin/api/state" -TimeoutSec 2).app -ne 'Island Now') { throw 'Minimieren hat den Server beendet.' }
    if ((Open-Desktop) -ne $window) { throw 'Minimieren hat das Fenster geschlossen statt ausgeblendet.' }
    Wait-DesktopCondition 'Position oder Groesse des normalen Fensters hat sich veraendert' {
        -not [IslandDesktopSmoke]::IsZoomed($window) -and [IslandDesktopSmoke]::Bounds($window) -eq $normalBounds
    }

    Send-SystemCommand $window 0xF030
    Wait-DesktopCondition 'Fenster konnte nicht maximiert werden' { [IslandDesktopSmoke]::IsZoomed($window) }
    $maximizedBounds = [IslandDesktopSmoke]::Bounds($window)
    # A native minimize can bypass the caption button, e.g. from a Windows shortcut.
    if (-not [IslandDesktopSmoke]::ShowWindowAsync($window, 6)) { throw 'Natives Minimieren konnte nicht ausgeloest werden.' }
    Wait-DesktopCondition 'Natives Minimieren hat das Fenster nicht ausgeblendet' { -not [IslandDesktopSmoke]::IsWindowVisible($window) }
    if ((Open-Desktop) -ne $window) { throw 'Natives Minimieren hat das Fenster geschlossen.' }
    Wait-DesktopCondition 'Maximiertes Fenster wurde nicht an derselben Position wiederhergestellt' {
        [IslandDesktopSmoke]::IsZoomed($window) -and [IslandDesktopSmoke]::Bounds($window) -eq $maximizedBounds
    }
    Send-SystemCommand $window 0xF120
    Wait-DesktopCondition 'Maximieren hat die vorherige normale Fenstergroesse veraendert' {
        -not [IslandDesktopSmoke]::IsZoomed($window) -and [IslandDesktopSmoke]::Bounds($window) -eq $normalBounds
    }

    # Simulate the old rectangle lying outside every available monitor.
    if (-not [IslandDesktopSmoke]::MoveWindow($window, 30000, 30000, 760, 540, $true)) { throw 'Fenster konnte nicht ausserhalb des Bildschirms platziert werden.' }
    Wait-DesktopCondition 'Testfenster liegt nicht ausserhalb des Bildschirms' { -not [IslandDesktopSmoke]::OnMonitor($window) }
    Send-SystemCommand $window 0xF020
    Wait-DesktopCondition 'Fenster ausserhalb des Bildschirms wurde nicht ausgeblendet' { -not [IslandDesktopSmoke]::IsWindowVisible($window) }
    if ((Open-Desktop) -ne $window) { throw 'Fenster ausserhalb des Bildschirms wurde neu erstellt.' }

    $trayBounds = [IslandDesktopSmoke]::Bounds($window)
    Set-CloseAction 'tray'
    Send-SystemCommand $window 0xF060
    Wait-DesktopCondition 'Schliessen mit Tray-Option hat das Fenster nicht ausgeblendet' { -not [IslandDesktopSmoke]::IsWindowVisible($window) }
    if ($nativeProcess.HasExited -or (Invoke-RestMethod "$origin/api/state" -TimeoutSec 2).desktop.closeAction -ne 'tray') { throw 'Schliessen mit Tray-Option hat den Server beendet.' }

    if ((Open-Desktop) -ne $window) { throw 'Die Tray-Option hat das Fenster geschlossen statt ausgeblendet.' }
    Wait-DesktopCondition 'Schliessen ins Tray hat die Fensterposition veraendert' { [IslandDesktopSmoke]::Bounds($window) -eq $trayBounds }
    Set-CloseAction 'exit'
    Send-SystemCommand $window 0xF060
    Wait-DesktopCondition 'Schliessen mit Beenden-Option hat die App nicht beendet' { $nativeProcess.HasExited }
    Write-Output 'Windows-Fenster: Wiederherstellung von Position, Groesse und maximiertem Zustand, Rueckkehr auf einen sichtbaren Bildschirm und beide Schliessen-Optionen geprueft.'
}

try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $projectRoot 'Island-Now.exe'
    $startInfo.Arguments = '--quiet'; $startInfo.WorkingDirectory = $projectRoot; $startInfo.UseShellExecute = $false
    if ($PortableNode) {
        if (-not (Test-Path (Join-Path $projectRoot 'runtime\node.exe'))) { throw 'Private Node-Laufzeit fehlt.' }
        $startInfo.EnvironmentVariables['PATH'] = Join-Path $env:WINDIR 'System32'
        foreach ($key in @('ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA')) { $startInfo.EnvironmentVariables[$key] = Join-Path $testData 'no-system-node' }
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
    if (-not $state.desktop.available -or $state.desktop.closeAction -ne 'exit') { throw 'Windows-Fenster oder Standardverhalten fehlt.' }
    if ($PortableNode) {
        $child = Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $nativeProcess.Id) | Where-Object { $_.Name -eq 'node.exe' }
        if ($child.ExecutablePath -ne (Join-Path $projectRoot 'runtime\node.exe')) { throw ('Tray verwendet nicht die private Node-Laufzeit. Erwartet: ' + (Join-Path $projectRoot 'runtime\node.exe') + '; Tray-PID: ' + $nativeProcess.Id + '; Kindprozess: ' + ($child | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json -Compress)) }
        Stop-Process -Id $nativeProcess.Id -Force; $nativeProcess.WaitForExit(5000) | Out-Null
    } else {
        if ($env:GITHUB_ACTIONS -eq 'true' -and -not (Test-WebViewRuntime)) {
            # Hosted Windows runner only. Use Microsoft's signed Evergreen bootstrapper.
            $bootstrapper = Join-Path $testData 'MicrosoftEdgeWebview2Setup.exe'
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 45 -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
            $signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation') { throw 'WebView2-Bootstrapper: Microsoft-Signatur fehlt.' }
            $install = Start-Process -FilePath $bootstrapper -ArgumentList '/silent', '/install' -PassThru
            if (-not $install.WaitForExit(55000) -or $install.ExitCode -ne 0 -or -not (Test-WebViewRuntime)) { throw 'WebView2 Runtime konnte auf dem Testsystem nicht installiert werden.' }
        }
        Test-DesktopWindow $startInfo $nativeProcess $state
    }
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
    for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $testData); $attempt++) {
        try { Remove-Item -LiteralPath $testData -Recurse -Force } catch {
            if ($attempt -eq 9) { throw }
            Start-Sleep -Milliseconds 300
        }
    }
}

# The release workflow already packages and checks its own update. Run the same
# check on pull requests before the Windows package is eligible for release.
if ($env:GITHUB_EVENT_NAME -eq 'pull_request' -and -not $PortableNode) {
    & node (Join-Path $PSScriptRoot 'package.mjs') --windows
    if ($LASTEXITCODE -ne 0) { throw 'Windows-Paket konnte nicht erstellt werden.' }
    & (Join-Path $PSScriptRoot 'test-update.ps1')
}
