# Test DEV MODE (`npm run dev` = electron-vite dev) for a self-exit.
# Dev mode has distinct failure modes from the built app: the Vite dev server
# must be up before Electron loads, and HMR/file-watching can restart or drop
# the window.
#
# SAFETY: only processes appearing AFTER this script starts are cleaned up.
$ErrorActionPreference = 'Continue'
$b      = Join-Path $env:TEMP 'spinity-build'
$out    = Join-Path $env:TEMP 'spinity-dev.out.log'
$err    = Join-Path $env:TEMP 'spinity-dev.err.log'
$status = Join-Path $env:TEMP 'spinity-dev.status.txt'

Set-Location $b
Remove-Item $out, $err, $status -ErrorAction SilentlyContinue

$before = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
"baseline electron pids: $($before -join ',')" | Out-File -FilePath $status -Encoding utf8

# cmd /c is required so npm's .cmd shim resolves.
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run dev' `
     -WorkingDirectory $b `
     -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
"launched 'npm run dev' wrapper pid=$($p.Id) at $(Get-Date -Format HH:mm:ss)" |
  Out-File -FilePath $status -Append -Encoding utf8

$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 75) {
  Start-Sleep -Seconds 2
  $now = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $new = @($now | Where-Object { $before -notcontains $_ })
  "$([math]::Round($sw.Elapsed.TotalSeconds,1))s newElectron=$($new.Count) wrapperExited=$($p.HasExited)" |
    Out-File -FilePath $status -Append -Encoding utf8
}

$after = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$mine  = @($after | Where-Object { $before -notcontains $_ })
"cleaning up my pids: $($mine -join ',')" | Out-File -FilePath $status -Append -Encoding utf8
if ($mine.Count -gt 0) { Stop-Process -Id $mine -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
