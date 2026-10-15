# Generates PWA icons for the web player from logo.png (repo root).
# Mirrors tools/make-icon.py: trim transparent margins, keep aspect ratio,
# center on a square canvas. Writes website/player/icons/*.png.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-pwa-icons.ps1
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class PwaIcons
{
    // Alpha-bounds of a 32bppArgb bitmap via LockBits (fast path).
    static Rectangle AlphaBounds(Bitmap b)
    {
        var rect = new Rectangle(0, 0, b.Width, b.Height);
        var data = b.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride, h = b.Height, w = b.Width;
            var buf = new byte[stride * h];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);
            int minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1;
            for (int y = 0; y < h; y++)
            {
                int row = y * stride;
                for (int x = 0; x < w; x++)
                {
                    if (buf[row + x * 4 + 3] > 8)
                    {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX < 0) return rect;
            return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
        }
        finally { b.UnlockBits(data); }
    }

    static void Draw(Graphics g, Image src, Rectangle srcRect, RectangleF dst)
    {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.SmoothingMode = SmoothingMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;
        g.DrawImage(src, dst, srcRect, GraphicsUnit.Pixel);
    }

    /// subject = trim logo, fit into `size*scale`, centered; bg = null -> transparent,
    /// otherwise a full-bleed opaque square of that color.
    public static void Make(Bitmap logo, string outPath, int size, double scale, Color? bg)
    {
        var subject = AlphaBounds(logo);
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            if (bg.HasValue) { using (var b = new SolidBrush(bg.Value)) g.FillRectangle(b, 0, 0, size, size); }
            else g.Clear(Color.Transparent);

            double box = size * scale;
            double k = Math.Min(box / subject.Width, box / subject.Height);
            double dw = subject.Width * k, dh = subject.Height * k;
            var dst = new RectangleF((float)((size - dw) / 2.0), (float)((size - dh) / 2.0), (float)dw, (float)dh);
            Draw(g, logo, subject, dst);
        }
        bmp.Save(outPath, ImageFormat.Png);
        bmp.Dispose();
    }
}
'@

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'website\player\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$logo = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'logo.png'))
try {
    $brandBg = [System.Drawing.Color]::FromArgb(255, 11, 14, 23)  # #0B0E17
    # Launcher icons: transparent, logo fills most of the tile.
    [PwaIcons]::Make($logo, (Join-Path $outDir 'icon-192.png'), 192, 0.92, $null)
    [PwaIcons]::Make($logo, (Join-Path $outDir 'icon-512.png'), 512, 0.92, $null)
    # Maskable: full-bleed brand background, subject inside the 80% safe circle.
    [PwaIcons]::Make($logo, (Join-Path $outDir 'icon-maskable-512.png'), 512, 0.62, $brandBg)
    # iOS ignores transparency (renders black); give it the brand background.
    [PwaIcons]::Make($logo, (Join-Path $outDir 'apple-touch-icon.png'), 180, 0.82, $brandBg)
}
finally { $logo.Dispose() }

Get-ChildItem $outDir | Select-Object Name, Length | Format-Table -AutoSize | Out-String -Width 80
