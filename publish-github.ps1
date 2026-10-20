# For the project owner. Requires Git and GitHub CLI already installed and signed in.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command gh -ErrorAction SilentlyContinue) -or -not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git und GitHub CLI installieren und gh auth login ausfuehren.' }
$account = gh api user --jq '.login'
if ($LASTEXITCODE -ne 0 -or $account.Trim() -ne 'BR3TZN') { throw 'Mit dem GitHub-Konto BR3TZN anmelden.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
    git init -b main
    if ($LASTEXITCODE -ne 0) { throw 'Git-Repository konnte nicht angelegt werden.' }
}
$gitName = git config user.name
if (-not $gitName) { git config user.name BR3TZN }
$gitEmail = git config user.email
if (-not $gitEmail) {
    $accountId = gh api user --jq '.id'
    if ($LASTEXITCODE -ne 0) { throw 'GitHub-Konto konnte nicht geprueft werden.' }
    git config user.email ($accountId.Trim() + '+BR3TZN@users.noreply.github.com')
}
git add -- package.json server.mjs README.md CHANGELOG.md .gitignore .github lib public windows scripts test docs START-WINDOWS.cmd START-KONSOLE.cmd START-MAC-LINUX.sh
if ($LASTEXITCODE -ne 0) { throw 'Quellcode konnte nicht vorbereitet werden.' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m 'Add Island Now with GitHub updates and release automation'
    if ($LASTEXITCODE -ne 0) { throw 'Commit fehlgeschlagen. Git-Benutzername und E-Mail pruefen.' }
}
$repository = 'BR3TZN/island-now'
gh repo view $repository --json name *> $null
if ($LASTEXITCODE -ne 0) {
    gh repo create $repository --public --description 'Spotify-Now-Playing-Widget fuer OBS mit Windows-Tray, Cover-Farben und GitHub-Updates.' --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw 'GitHub-Repository konnte nicht erstellt werden.' }
} else {
    $remote = git remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) { git remote add origin ('https://github.com/' + $repository + '.git') }
    elseif ($remote.Trim() -notin @('https://github.com/BR3TZN/island-now.git', 'git@github.com:BR3TZN/island-now.git')) { throw 'Origin zeigt auf ein anderes Repository.' }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'Push fehlgeschlagen. Bestehende Remote-Historie wird nicht ueberschrieben.' }
}
gh workflow run release.yml --repo $repository --ref main
if ($LASTEXITCODE -ne 0) { throw 'Release-Workflow konnte nicht gestartet werden. Auf GitHub unter Actions den Workflow Release starten.' }
Write-Output ('Quellcode veroeffentlicht. Release wird erstellt: https://github.com/' + $repository + '/actions')
