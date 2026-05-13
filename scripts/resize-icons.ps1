Param(
  [string]$SourcePath = "public/icons-src/source.png",
  [string]$OutDir = "public/icons"
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile((Resolve-Path $SourcePath))

# 从中心裁剪为正方形
$side = [Math]::Min($src.Width, $src.Height)
$x = [int](($src.Width  - $side) / 2)
$y = [int](($src.Height - $side) / 2)

$square = New-Object System.Drawing.Bitmap $side, $side
$g0 = [System.Drawing.Graphics]::FromImage($square)
$g0.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g0.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g0.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g0.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$rectSrc = New-Object System.Drawing.Rectangle $x, $y, $side, $side
$rectDst = New-Object System.Drawing.Rectangle 0, 0, $side, $side
$g0.DrawImage($src, $rectDst, $rectSrc, [System.Drawing.GraphicsUnit]::Pixel)
$g0.Dispose()
$src.Dispose()

if (!(Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$sizes = @(16, 32, 48, 128)
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
  $g.DrawImage($square, $rect)
  $g.Dispose()

  $out = Join-Path $OutDir "icon-$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $info = Get-Item $out
  Write-Host ("OK  {0,3}x{0,-3}  -> {1}  ({2:N0} bytes)" -f $s, $out, $info.Length)
}

$square.Dispose()
