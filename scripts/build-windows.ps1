$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$webViewRoot = Join-Path $projectRoot 'windows\webview2'
$sdkVersion = '1.0.4314.35'
$sdkHash = '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4'
$sdkFiles = @(
    @{ Source = 'lib/net462/Microsoft.Web.WebView2.Core.dll'; Target = 'Microsoft.Web.WebView2.Core.dll'; Hash = 'acdd517b951829f763d1255f32df1e6a936cb8623a7ebff6b8b24172dede6bd6' },
    @{ Source = 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'; Target = 'Microsoft.Web.WebView2.WinForms.dll'; Hash = 'c66437f80886aecf074804b61af4cc10ad90a95310c8e0a717f31ea377c26b03' },
    @{ Source = 'runtimes/win-x86/native/WebView2Loader.dll'; Target = 'x86\WebView2Loader.dll'; Hash = '1d348d3c0a5cb0d985389b68a0fd9bf966c2aed65f5e44bbc0233739b7a57f9e' },
    @{ Source = 'runtimes/win-x64/native/WebView2Loader.dll'; Target = 'x64\WebView2Loader.dll'; Hash = 'd3fce90bdeecb08596e377dea6a316354dd8949e32ff09b89d51be00c14e21b6' },
    @{ Source = 'runtimes/win-arm64/native/WebView2Loader.dll'; Target = 'arm64\WebView2Loader.dll'; Hash = '05429881d918fd64a3fe4955155c1af79e66d7b7d944034467874f420bc2265a' },
    @{ Source = 'LICENSE.txt'; Target = 'LICENSE.txt'; Hash = '0af8f1b807512aae39c2ac1aa4d0cae65cabecb6fd554b8439a5162a0d6eca55' },
    @{ Source = 'NOTICE.txt'; Target = 'NOTICE.txt'; Hash = '106423785c5b7eba0a8e61d1837f2132e9c828e20ad530f565d981c1df60dd90' }
)
function Test-SdkFile($file, $hash) {
    return (Test-Path -LiteralPath $file -PathType Leaf) -and ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $hash)
}
if ($sdkFiles | Where-Object { -not (Test-SdkFile (Join-Path $webViewRoot $_.Target) $_.Hash) }) {
    Write-Output "Microsoft WebView2 SDK $sdkVersion wird vorbereitet ..."
    $sdkTemp = Join-Path ([IO.Path]::GetTempPath()) ('island-webview2-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $sdkTemp | Out-Null
    try {
        $archive = Join-Path $sdkTemp 'webview2.nupkg'
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $archive
        if (-not (Test-SdkFile $archive $sdkHash)) { throw 'WebView2-SDK: Pruefsumme stimmt nicht.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach ($item in $sdkFiles) {
                $entry = $zip.GetEntry($item.Source)
                if (-not $entry) { throw ('WebView2-SDK: Datei fehlt: ' + $item.Source) }
                $target = Join-Path $sdkTemp $item.Target
                New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target)
                if (-not (Test-SdkFile $target $item.Hash)) { throw ('WebView2-SDK: Pruefsumme stimmt nicht: ' + $item.Target) }
            }
        } finally { $zip.Dispose() }
        foreach ($item in $sdkFiles) {
            $target = Join-Path $webViewRoot $item.Target
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $sdkTemp $item.Target) -Destination $target -Force
        }
    } finally { Remove-Item -LiteralPath $sdkTemp -Recurse -Force }
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Der .NET Framework C#-Compiler fehlt.' }
& $compiler /nologo /codepage:65001 /target:winexe /optimize+ /platform:anycpu /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ('/r:' + (Join-Path $webViewRoot 'Microsoft.Web.WebView2.Core.dll')) ('/r:' + (Join-Path $webViewRoot 'Microsoft.Web.WebView2.WinForms.dll')) ('/out:' + (Join-Path $projectRoot 'Island-Now.exe')) (Join-Path $projectRoot 'windows\Tray.cs') (Join-Path $projectRoot 'windows\NodeRuntime.cs') (Join-Path $projectRoot 'windows\DesktopWindow.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows-Tray konnte nicht kompiliert werden.' }
Write-Output (Join-Path $projectRoot 'Island-Now.exe')
