# Verify the ready-to-run copy: typecheck + build at the new location.
# Deliberately does NOT run `npm run dev`, so no app window is opened.
$ErrorActionPreference = 'Continue'
$dst = Join-Path $env:USERPROFILE 'Spinity-ready'
$log = Join-Path $env:TEMP 'spinity-ready-verify.log'

function Log([string]$m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }

"=== VERIFY $dst $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8
if (-not (Test-Path $dst)) { Log 'FATAL: copy missing'; exit 1 }

Set-Location $dst
Log "cwd=$(Get-Location)"

Log '--- typecheck ---'
& npm run typecheck *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "typecheck exit=$LASTEXITCODE"

Log '--- build ---'
& npm run build *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "build exit=$LASTEXITCODE"

Log '--- assets in ready copy ---'
Get-ChildItem (Join-Path $dst 'out') -Recurse -File -ErrorAction SilentlyContinue |
  ForEach-Object { Log ("  " + $_.FullName.Replace($dst, '') + "  " + [math]::Round($_.Length / 1KB, 1) + "KB") }

Log '=== VERIFY DONE ==='
