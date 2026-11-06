<#
.SYNOPSIS
  Creates a new on-device AI app (WinUI 3 + WebView2 + Windows AI) from the skill's template.

.DESCRIPTION
  Copies ..\template to <Destination>\<Name>, keeps only the Windows AI components you ask for, renames everything,
  creates (or reuses) a self-signed signing certificate for the package Publisher, generates the tile/logo PNGs and
  copies the build scripts. The result builds with `dotnet build` straight away.

  Components:  language    Phi Silica text generation + streaming          (LanguageModule)
               textskills  TextSummarizer / TextRewriter / TextToTable      (TextSkillsModule)
               ocr         TextRecognizer: images and scanned PDFs          (OcrModule)
               vision      ImageDescriptionGenerator: photo captions        (VisionModule)
               pdf         PDFs with a text layer, via PdfPig               (PdfModule)
               index       AppContentIndexer local search                   (IndexModule)
               images      ImageGenerator / ImageScaler / background cut-out (ImageModule)
  `all` selects every component. Pick only what the app needs: every unused module is dead weight and a first-run download.

.EXAMPLE
  .\new-app.ps1 -Name InvoiceChecker -Display "Invoice Checker" -Components language,pdf,ocr -Publisher "CN=Contoso" -Destination C:\src
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidatePattern('^[A-Za-z][A-Za-z0-9]*$')] [string] $Name,
  [string]   $Display,
  [string]   $Description = 'On-device AI app',
  [string]   $Publisher   = 'CN=OnDeviceAIDev',
  [string]   $Identity,
  [string[]] $Components  = @('all'),
  [string]   $Destination = (Get-Location).Path,
  [string]   $Accent      = '#2563EB'
)

$ErrorActionPreference = 'Stop'
$skill    = Split-Path -Parent $PSScriptRoot
$template = Join-Path $skill 'template'
if (-not (Test-Path $template)) { throw "Template not found at $template" }
if ($env:OS -ne 'Windows_NT') { throw 'This builds Windows apps and must run on Windows 11.' }

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text($p)       { [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
function Write-Text($p, $t)  { [IO.File]::WriteAllText($p, $t, $utf8) }

# --- component selection ----------------------------------------------------------------------------
$map = [ordered]@{
  language   = 'LanguageModule.cs'
  textskills = 'TextSkillsModule.cs'
  ocr        = 'OcrModule.cs'
  vision     = 'VisionModule.cs'
  pdf        = 'PdfModule.cs'
  index      = 'IndexModule.cs'
  images     = 'ImageModule.cs'
}
$want = @($Components | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
if ($want -contains 'all') { $want = @($map.Keys) }
foreach ($w in $want) { if (-not $map.Contains($w)) { throw "Unknown component '$w'. Valid: $($map.Keys -join ', '), all" } }
# the text skills and the language-model features share one model: no extra module is needed, Ai.cs provides it.

if (-not $Display)  { $Display = ($Name -creplace '([a-z0-9])([A-Z])', '$1 $2') }
$cn = ($Publisher -replace '^CN=', '' -replace ',.*$', '').Trim()
$cnId = ($cn -replace '[^A-Za-z0-9]', '')
if (-not $cnId) { $cnId = 'Dev' }
if (-not $Identity) { $Identity = "$cnId.$Name" }
$hostName = ($Name.ToLowerInvariant()) + '.local'
$dest = Join-Path $Destination $Name
if (Test-Path $dest) { throw "$dest already exists. Choose another -Name or -Destination." }

# --- copy + prune ------------------------------------------------------------------------------------
Write-Host "Creating $dest ..."
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $template '*') $dest -Recurse -Force
foreach ($k in $map.Keys) {
  if ($want -notcontains $k) { Remove-Item (Join-Path $dest "Modules\$($map[$k])") -Force }
}

# --- certificate -------------------------------------------------------------------------------------
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Publisher -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) {
  Write-Host "Creating a self-signed code-signing certificate '$Publisher' (3 years) in Cert:\CurrentUser\My ..."
  $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature -FriendlyName "On-device AI apps ($cn)" `
    -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(3) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
}

# --- rename + token replacement ----------------------------------------------------------------------
$tokens = @{
  '__IDENTITY__'         = $Identity
  '__PUBLISHER__'        = $Publisher
  '__PUBLISHERDISPLAY__' = $cn
  '__DISPLAYNAME__'      = $Display
  '__DESCRIPTION__'      = ($Description -replace '[<>&"]', '')
  '__HOST__'             = $hostName
  '__GUID__'             = [guid]::NewGuid().ToString()
  '__THUMBPRINT__'       = $cert.Thumbprint
}
Get-ChildItem $dest -Recurse -File | Where-Object { $_.Extension -in '.cs','.csproj','.xaml','.appxmanifest','.manifest','.html','.js','.css','.md','.ps1','.json' } | ForEach-Object {
  $t = Read-Text $_.FullName
  foreach ($k in $tokens.Keys) { $t = $t.Replace($k, $tokens[$k]) }
  $t = $t -creplace '\bAiApp\b', $Name
  Write-Text $_.FullName $t
}
Rename-Item (Join-Path $dest 'AiApp.csproj') "$Name.csproj"

if ($want -notcontains 'pdf') {
  $cs = Join-Path $dest "$Name.csproj"
  Write-Text $cs ((Read-Text $cs) -replace '(?m)^\s*<PackageReference Include="UglyToad\.PdfPig"[^>]*/>\r?\n', '')
}

# --- assets ------------------------------------------------------------------------------------------
Add-Type -AssemblyName System.Drawing
function New-Tile($path, [int]$w, [int]$h, [string]$text, $accent) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [Math]::Min($w, $h) * 0.22
  $rect = New-Object System.Drawing.RectangleF 0, 0, $w, $h
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $gp.AddArc(0, 0, $d, $d, 180, 90); $gp.AddArc($w - $d, 0, $d, $d, 270, 90)
  $gp.AddArc($w - $d, $h - $d, $d, $d, 0, 90); $gp.AddArc(0, $h - $d, $d, $d, 90, 90); $gp.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $accent), $gp)
  $size = [Math]::Min($w, $h) * 0.42
  $font = New-Object System.Drawing.Font 'Segoe UI Semibold', $size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $g.Dispose(); $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
$accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)
$initials = ((($Display -split '\s+') | Where-Object { $_ } | ForEach-Object { $_.Substring(0, 1).ToUpper() }) -join '')
if ($initials.Length -gt 2) { $initials = $initials.Substring(0, 2) }
$assets = Join-Path $dest 'Assets'
New-Tile (Join-Path $assets 'Square44x44Logo.png')  44  44  $initials $accentColor
New-Tile (Join-Path $assets 'Square150x150Logo.png') 150 150 $initials $accentColor
New-Tile (Join-Path $assets 'Wide310x150Logo.png')  310 150 $initials $accentColor
New-Tile (Join-Path $assets 'StoreLogo.png')        50  50  $initials $accentColor
New-Tile (Join-Path $assets 'SplashScreen.png')     620 300 $initials $accentColor

# --- scripts + housekeeping --------------------------------------------------------------------------
$sdir = Join-Path $dest 'scripts'
New-Item -ItemType Directory -Force $sdir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'build-app.ps1')    $sdir -Force
Copy-Item (Join-Path $PSScriptRoot 'dev-register.ps1') $sdir -Force
Write-Text (Join-Path $dest '.gitignore') "bin/`nobj/`nAppPackages/`ndist/`n.vs/`n*.pfx`n*.user`n"

$compList = ($want -join ', ')
Write-Text (Join-Path $dest 'README.md') @"
# $Display

$Description

On-device AI app for Windows 11 Copilot+ PC: packaged WinUI 3 window hosting a WebView2 page (www/) and a C# bridge to the Windows AI APIs.
Components included: $compList.

## Run (developer loop)
``````powershell
.\scripts\dev-register.ps1          # builds Debug, registers it under a separate dev identity and starts it
``````
Self-test without clicking: create an empty file ``autotest.flag`` in the app's LocalState folder and start the app; it runs every check and writes ``selftest-report.json`` next to ``bridge.log``.

## Build a signed MSIX to share
``````powershell
.\scripts\build-app.ps1             # -> dist\$Name\ (msix + public .cer + Install-$Name.ps1)
``````

## Layout
- ``Modules/*.cs`` one bridge module per Windows AI component (deleting a file removes its operations)
- ``Bridge.cs`` / ``Ai.cs`` / ``ImageUtil.cs`` shared plumbing; ``MainWindow.xaml.cs`` WebView2 + dispatcher
- ``www/`` the UI (``bridge.js`` is the page side of the bridge)
- ``bridge.log`` is in ``%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState``: operation names, sizes and statuses only
"@

Write-Host ""
Write-Host "Created $dest" -ForegroundColor Green
Write-Host "  identity   : $Identity   publisher: $Publisher   host: https://$hostName/"
Write-Host "  components : $compList"
Write-Host "  certificate: $($cert.Thumbprint)"
Write-Host "Next: cd `"$dest`" ; .\scripts\dev-register.ps1"
