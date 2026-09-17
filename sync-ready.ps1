# Sync the workspace source into the ready-to-run copy and rebuild it.
# The ready copy is writable by this agent (unlike the workspace).
$ErrorActionPreference = 'Continue'
$proj = 'C:\Users\ilyasify\Documents\spinity'
$dst  = Join-Path $env:USERPROFILE 'Spinity-ready'
$log  = Join-Path $env:TEMP 'spinity-sync.log'

function Log([string]$m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }

"=== SYNC $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8
if (-not (Test-Path $dst)) { Log 'FATAL: ready copy missing'; exit 1 }

& robocopy (Join-Path $proj 'src') (Join-Path $dst 'src') /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
Log "robocopy src exit=$LASTEXITCODE"

foreach ($f in 'package.json','tsconfig.json','tsconfig.node.json','tsconfig.web.json','electron.vite.config.ts','electron-builder.yml') {
  Copy-Item -Path (Join-Path $proj $f) -Destination $dst -Force -ErrorAction SilentlyContinue
}
Log 'configs copied'

Set-Location $dst
Log '--- typecheck ---'
& npm run typecheck *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "typecheck exit=$LASTEXITCODE"

Log '--- build ---'
& npm run build *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "build exit=$LASTEXITCODE"

Log '=== SYNC DONE ==='
