# Diagnostic: does the built app exit on its own, and why?
#
# SAFETY: only processes that appear AFTER this script starts are killed, so a
# running instance started by the user is never touched.
$ErrorActionPreference = 'Continue'
$b      = Join-Path $env:TEMP 'spinity-build'
$out    = Join-Path $env:TEMP 'spinity-diag.out.log'
$err    = Join-Path $env:TEMP 'spinity-diag.err.log'
$status = Join-Path $env:TEMP 'spinity-diag.status.txt'

Set-Location $b
Remove-Item $out, $err, $status -ErrorAction SilentlyContinue

$before = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
"baseline electron pids: $($before -join ',')" | Out-File -FilePath $status -Encoding utf8

$cmd = Start-Process -FilePath (Join-Path $b 'node_modules\.bin\electron.cmd') `
       -ArgumentList '.' `
       -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
"launched wrapper pid=$($cmd.Id) at $(Get-Date -Format HH:mm:ss)" | Out-File -FilePath $status -Append -Encoding utf8

$sw = [Diagnostics.Stopwatch]::StartNew()
$diedAt = $null
while ($sw.Elapsed.TotalSeconds -lt 70) {
  Start-Sleep -Seconds 2
  $now = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $new = @($now | Where-Object { $before -notcontains $_ })
  "$([math]::Round($sw.Elapsed.TotalSeconds,1))s newElectron=$($new.Count) totalElectron=$($now.Count)" |
    Out-File -FilePath $status -Append -Encoding utf8
  # Give it time to actually spawn before judging.
  if ($new.Count -eq 0 -and $sw.Elapsed.TotalSeconds -gt 8) {
    $diedAt = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    break
  }
}

if ($diedAt) {
  "RESULT: app processes disappeared at ${diedAt}s" | Out-File -FilePath $status -Append -Encoding utf8
} else {
  "RESULT: still alive after 70s" | Out-File -FilePath $status -Append -Encoding utf8
}

# Clean up ONLY the processes this script spawned.
$after = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$mine  = @($after | Where-Object { $before -notcontains $_ })
if ($mine.Count -gt 0) {
  "cleaning up my pids: $($mine -join ',')" | Out-File -FilePath $status -Append -Encoding utf8
  Stop-Process -Id $mine -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $cmd.Id -Force -ErrorAction SilentlyContinue
