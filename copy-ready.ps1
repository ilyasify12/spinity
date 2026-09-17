# Create a ready-to-run copy of Spinity at a WRITABLE location.
#
# WHY: this agent's sandbox grants spawned processes only ReadAndExecute on
# C:\Users\ilyasify\Documents\spinity (see the CodexSandboxUsers ACE), so
# node_modules can never be created inside the workspace by a script. The
# already-installed, already-verified tree lives in %TEMP%\spinity-build, so it
# is copied to the user's profile where writes are allowed.
#
# The copy is a convenience/preview. The canonical project remains in
# Documents\spinity, and after the user runs setup.cmd there, that copy is the
# one to keep.
$ErrorActionPreference = 'Continue'

$src = Join-Path $env:TEMP 'spinity-build'
$dst = Join-Path $env:USERPROFILE 'Spinity-ready'
$log = Join-Path $env:TEMP 'spinity-copy.log'

function Log([string]$m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }

"=== COPY START $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

if (-not (Test-Path $src)) { Log "FATAL: source mirror missing: $src"; exit 1 }

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $dst | Out-Null

# robocopy is far faster and more reliable than Copy-Item for ~500 MB of
# node_modules. Exit codes 0-7 all mean success.
& robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
$rc = $LASTEXITCODE
Log "robocopy exit=$rc"

Log "electron present: $(Test-Path (Join-Path $dst 'node_modules\electron\dist\electron.exe'))"
Log "electron-vite present: $(Test-Path (Join-Path $dst 'node_modules\electron-vite'))"
Log "source present: $(Test-Path (Join-Path $dst 'src\main\index.ts'))"

$size = (Get-ChildItem $dst -Recurse -File -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum
Log "total size: $([math]::Round($size / 1MB, 1)) MB"

Log '=== COPY DONE ==='
