# One-off helper: PNG for `pnpm exec tauri icon` — green dot + music symbol on dark bg.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $root "apps\desktop\app-icon.png"

$size = 512
$bmp = New-Object Drawing.Bitmap $size, $size
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([Drawing.Color]::FromArgb(255, 13, 13, 15))

$brush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 29, 185, 84))
$r = [int]($size * 0.18)
$cx = $size / 2
$cy = $size / 2 + [int]($size * 0.02)
$g.FillEllipse($brush, [int]($cx - $r), [int]($cy - $r), (2 * $r), (2 * $r))

$fontPx = [int]($size * 0.28)
$font = New-Object Drawing.Font(
  "Segoe UI",
  $fontPx,
  [Drawing.FontStyle]::Bold,
  [Drawing.GraphicsUnit]::Pixel
)

$sf = New-Object Drawing.StringFormat
$sf.Alignment = [Drawing.StringAlignment]::Center
$sf.LineAlignment = [Drawing.StringAlignment]::Center

$white = New-Object Drawing.SolidBrush ([Drawing.Color]::White)
$rect = New-Object Drawing.RectangleF(
  0,
  [int]($size * 0.28),
  [float]$size,
  [int]($size * 0.45)
)

$music = [char]0x266A
$g.DrawString($music, $font, $white, $rect, $sf)

$bmp.Save($outPath, [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Host "Wrote $outPath"
