# Boot the built app from the TEMP mirror and capture any startup crash.
# Runs from TEMP because child processes cannot create files in the project dir.
$ErrorActionPreference = 'Continue'
$b      = Join-Path $env:TEMP 'spinity-build'
$out    = Join-Path $env:TEMP 'spinity-run.out.log'
$err    = Join-Path $env:TEMP 'spinity-run.err.log'
$status = Join-Path $env:TEMP 'spinity-run.status.txt'

Set-Location $b
Remove-Item $out, $err, $status -ErrorAction SilentlyContinue

$p = Start-Process -FilePath (Join-Path $b 'node_modules\.bin\electron.cmd') `
     -ArgumentList '.' `
     -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

"pid=$($p.Id)" | Out-File -FilePath $status -Encoding utf8

Start-Sleep -Seconds 16

if ($p.HasExited) {
  "EXITED code=$($p.ExitCode)" | Out-File -FilePath $status -Append -Encoding utf8
} else {
  "STILL RUNNING after 16s (window opened successfully)" | Out-File -FilePath $status -Append -Encoding utf8
}

# Clean up so no stray window is left behind.
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
