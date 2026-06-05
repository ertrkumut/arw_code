# Generates build/icon.ico (multi-size, PNG-compressed entries) and build/icon.png
# Look: dark rounded square (JetBrains-Rider dark) with a teal ">_" terminal prompt.
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root 'build'
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }

$bg   = [System.Drawing.Color]::FromArgb(255, 22, 26, 32)    # #161A20 dark
$teal = [System.Drawing.Color]::FromArgb(255, 45, 212, 191)  # #2DD4BF oceanic teal

function New-RoundedPath($x, $y, $w, $h, $r) {
    $d = $r * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

$sizes = 256, 128, 64, 48, 32, 16
$pngs = @{}

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = [int]($s * 0.22)
    $path = New-RoundedPath 0 0 $s $s $radius
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $g.FillPath($bgBrush, $path)

    $fontSize = [single]($s * 0.40)
    $font = New-Object System.Drawing.Font("Consolas", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $tealBrush = New-Object System.Drawing.SolidBrush($teal)
    $rectF = New-Object System.Drawing.RectangleF(0, 0, $s, $s)
    $g.DrawString(">_", $font, $tealBrush, $rectF, $sf)

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs[$s] = $ms.ToArray()
    if ($s -eq 256) { [System.IO.File]::WriteAllBytes((Join-Path $buildDir 'icon.png'), $pngs[$s]) }
    $ms.Dispose(); $bmp.Dispose()
}

# Pack into a multi-image .ico (each entry is a full PNG blob — valid on Vista+)
$icoPath = Join-Path $buildDir 'icon.ico'
$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0)            # reserved
$bw.Write([uint16]1)            # type = icon
$bw.Write([uint16]$sizes.Count) # image count
$offset = 6 + (16 * $sizes.Count)
foreach ($s in $sizes) {
    $len = $pngs[$s].Length
    $dim = if ($s -ge 256) { 0 } else { $s }   # 0 means 256 in ICO spec
    $bw.Write([byte]$dim)       # width
    $bw.Write([byte]$dim)       # height
    $bw.Write([byte]0)          # palette colors
    $bw.Write([byte]0)          # reserved
    $bw.Write([uint16]1)        # color planes
    $bw.Write([uint16]32)       # bits per pixel
    $bw.Write([uint32]$len)     # size of PNG data
    $bw.Write([uint32]$offset)  # offset to PNG data
    $offset += $len
}
foreach ($s in $sizes) { $bw.Write($pngs[$s]) }
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Host "Wrote $icoPath ($([System.IO.FileInfo]::new($icoPath).Length) bytes) and build/icon.png"
