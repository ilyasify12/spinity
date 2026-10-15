# Renders build/installerHeader.bmp — the branded strip MUI2 paints across the
# top of the installer window.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File build/make-installer-header.ps1
#
# MUI2 stretches this bitmap into its header control, and MUI_BGCOLOR in
# build/installer.nsh paints the remainder of the header row. The background is
# therefore a single flat colour that must match --bg-elev (#151A26) exactly, or
# the strip will show a seam.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$W = 150   # MUI2 header control width  (Contrib/Graphics/Header/nsis.bmp)
$H = 57    # MUI2 header control height

$Bg     = [System.Drawing.Color]::FromArgb(0x15, 0x1A, 0x26)   # --bg-elev
$Accent = [System.Drawing.Color]::FromArgb(0xFF, 0x6B, 0x00)   # --accent
$Text   = [System.Drawing.Color]::FromArgb(0xF2, 0xF4, 0xFC)   # --text

$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear($Bg)

# --- soft glow behind the mark ------------------------------------------------
# Built from stacked translucent discs rather than a gradient brush so it stays
# a flat 24bpp image: any alpha here would not survive the BMP round trip.
$cx = 22.0; $cy = 28.5
for ($i = 10; $i -ge 1; $i--) {
    $d = 8 + ($i * 2.6)
    $a = [int](4 + (3 * (11 - $i)))
    $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 0xFF, 0x6B, 0x00))
    $g.FillEllipse($b, [float]($cx - $d / 2), [float]($cy - $d / 2), [float]$d, [float]$d)
    $b.Dispose()
}

# --- the spiral, same shape as the in-app boot screen -------------------------
# r(t) = 1.1 * e^(0.20 t)  grows 1px -> 13px over roughly two turns.
$pen = New-Object System.Drawing.Pen($Accent, 2.6)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$steps = 240
$pts = New-Object 'System.Drawing.PointF[]' $steps
for ($i = 0; $i -lt $steps; $i++) {
    $t = ($i / ($steps - 1)) * 12.36
    $r = 1.1 * [Math]::Exp(0.20 * $t)
    $x = $cx + $r * [Math]::Cos($t)
    $y = $cy + $r * [Math]::Sin($t)
    $pts[$i] = New-Object System.Drawing.PointF([float]$x, [float]$y)
}
$g.DrawLines($pen, $pts)
$pen.Dispose()

# --- wordmark -----------------------------------------------------------------
$wordmark = New-Object System.Drawing.Font('Segoe UI Semibold', 13.0, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$brush = New-Object System.Drawing.SolidBrush($Text)
$g.DrawString('Spinity', $wordmark, $brush, 40.0, 13.0)
$wordmark.Dispose()
$brush.Dispose()
$g.Dispose()

$out = Join-Path $PSScriptRoot 'installerHeader.bmp'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

Write-Host "wrote $out ($W x $H)"
