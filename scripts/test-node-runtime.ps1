param([switch]$Download)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Der .NET Framework C#-Compiler fehlt.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('island node test ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $runtimeSource = Get-Content (Join-Path $projectRoot 'windows\NodeRuntime.cs') -Raw
    $pinnedVersion = [regex]::Match($runtimeSource, 'const string Version = "(\d+\.\d+\.\d+)"').Groups[1].Value
    if (-not $pinnedVersion) { throw 'Festgelegte Node-Version fehlt.' }
    $fixtures = @()
    foreach ($version in @('20.99.0', $pinnedVersion)) {
        $source = Join-Path $testRoot ('node-' + $version + '.cs')
        $executable = Join-Path $testRoot ('node-' + $version + '.exe')
        [IO.File]::WriteAllText($source, ('using System; class FakeNode { static void Main() { Console.WriteLine("' + $version + '"); } }'))
        & $compiler /nologo /target:exe ('/out:' + $executable) $source
        if ($LASTEXITCODE -ne 0) { throw 'Node-Testdatei konnte nicht erstellt werden.' }
        $reported = & $executable '-p' 'process.versions.node'
        if ($LASTEXITCODE -ne 0 -or $reported -ne $version) { throw ('Node-Testdatei meldet falsche Version: ' + $reported) }
        $fixtures += $executable
    }
    $tests = Join-Path $testRoot 'NodeRuntimeTests.exe'
    & $compiler /nologo /target:exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ('/out:' + $tests) (Join-Path $projectRoot 'windows\NodeRuntime.cs') (Join-Path $projectRoot 'test\NodeRuntimeTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Node-Erststart-Tests konnten nicht kompiliert werden.' }
    $arguments = @($node, $fixtures[0], $fixtures[1])
    if ($Download) { $arguments += $projectRoot }
    & $tests @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Node-Erststart-Pruefung fehlgeschlagen.' }
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
