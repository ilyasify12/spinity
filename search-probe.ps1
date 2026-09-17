# Probe yt-dlp search behaviour and record the exact JSON shape + timing.
# Runs detached because a YouTube search takes longer than the 30s shell limit.
$out    = Join-Path $env:TEMP 'ytsearch.json'
$err    = Join-Path $env:TEMP 'ytsearch.err.txt'
$status = Join-Path $env:TEMP 'ytsearch.status.txt'

$sw = [Diagnostics.Stopwatch]::StartNew()
& yt-dlp --dump-single-json --flat-playlist --no-warnings --socket-timeout 15 'ytsearch5:lofi hip hop' 1> $out 2> $err
$code = $LASTEXITCODE
$sw.Stop()

$size = 0
if (Test-Path $out) { $size = (Get-Item $out).Length }
"exit=$code elapsed=$([Math]::Round($sw.Elapsed.TotalSeconds,1))s bytes=$size" |
  Out-File -FilePath $status -Encoding utf8
