$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Der .NET Framework C#-Compiler fehlt.' }
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ('/out:' + (Join-Path $projectRoot 'Island-Now.exe')) (Join-Path $projectRoot 'windows\Tray.cs') (Join-Path $projectRoot 'windows\NodeRuntime.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows-Tray konnte nicht kompiliert werden.' }
Write-Output (Join-Path $projectRoot 'Island-Now.exe')
