<#
.SYNOPSIS
  Builds a signed MSIX for one app of this repository, optionally installs it.

.DESCRIPTION
  Works on a temporary COPY of the app, so the files in the repository are never modified:
    1. checks the prerequisites (dotnet SDK, Windows)
    2. finds (or creates) a self-signed code-signing certificate in Cert:\CurrentUser\My
    3. copies the app to a work folder and patches the certificate thumbprint (.csproj) and the Publisher (manifest)
    4. runs "dotnet build" for an x64 sideload MSIX
    5. copies the .msix (and the public .cer) to <repo>\dist\<App>\
    6. with -Install: trusts the certificate (needs an elevated PowerShell) and installs the package

.EXAMPLE
  .\scripts\build-app.ps1 -App LocalMindApp
  .\scripts\build-app.ps1 -App LocalMindApp -Install        # elevated PowerShell for the certificate trust step
  .\scripts\build-app.ps1 -App LocalIQApp -Subject "CN=Jane Doe" -Thumbprint <existing thumbprint>
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $App,                       # folder name under apps\, e.g. LocalMindApp
  [string] $Subject = 'CN=OnDeviceAIApps',                    # certificate subject = package Publisher
  [string] $Thumbprint,                                       # use an existing certificate from Cert:\CurrentUser\My
  [switch] $Install                                           # trust the certificate and install the MSIX
)

$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$appDir  = Join-Path $repo "apps\$App"
if (-not (Test-Path $appDir)) {
  $names = (Get-ChildItem (Join-Path $repo 'apps') -Directory).Name -join ', '
  throw "Unknown app '$App'. Available: $names"
}

# --- 1. prerequisites ---------------------------------------------------------------------------
if ($env:OS -ne 'Windows_NT') { throw 'These apps build on Windows 11 only.' }
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw '.NET SDK not found. Install the .NET 8 SDK (or newer) from https://dot.net' }
$sdks = (& dotnet --list-sdks) -join ', '
Write-Host "dotnet SDKs: $sdks"
if (-not ((& dotnet --list-sdks) -match '^(8|9|10)\.')) { throw 'A .NET SDK 8 or newer is required.' }

# --- 2. certificate -----------------------------------------------------------------------------
if ($Thumbprint) {
  $cert = Get-Item "Cert:\CurrentUser\My\$Thumbprint" -ErrorAction Stop
  $Subject = $cert.Subject
} else {
  $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) } |
          Sort-Object NotAfter -Descending | Select-Object -First 1
  if (-not $cert) {
    Write-Host "Creating a self-signed code-signing certificate '$Subject' (valid 3 years)..."
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Subject -KeyUsage DigitalSignature `
      -FriendlyName 'On-device AI apps (dev)' -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(3) `
      -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  }
}
$Thumbprint = $cert.Thumbprint
Write-Host "Certificate: $($cert.Subject)  $Thumbprint"

# --- 3. work copy, patched ----------------------------------------------------------------------
$work = Join-Path $env:TEMP "build-$App"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$null = robocopy $appDir $work /E /XD bin obj AppPackages .vs /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

$csproj = Get-ChildItem $work -Filter *.csproj | Select-Object -First 1
$x = Get-Content $csproj.FullName -Raw
$x = [regex]::Replace($x, '<PackageCertificateThumbprint>[^<]*</PackageCertificateThumbprint>', "<PackageCertificateThumbprint>$Thumbprint</PackageCertificateThumbprint>")
Set-Content $csproj.FullName $x -Encoding UTF8

$manifestPath = Join-Path $work 'Package.appxmanifest'
$m = Get-Content $manifestPath -Raw
$m = [regex]::Replace($m, '(<Identity[^>]*?\bPublisher\s*=\s*")[^"]*(")', "`${1}$Subject`${2}", 'Singleline')
Set-Content $manifestPath $m -Encoding UTF8

# --- 4. build -----------------------------------------------------------------------------------
Push-Location $work
try {
  & dotnet build -c Release -p:Platform=x64 -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir="AppPackages\" `
      -p:AppxBundle=Never -p:UapAppxPackageBuildMode=SideloadOnly
  if ($LASTEXITCODE -ne 0) { throw "dotnet build failed (exit $LASTEXITCODE). Scroll up for the first 'error'." }
} finally { Pop-Location }

# --- 5. collect output --------------------------------------------------------------------------
$msix = Get-ChildItem (Join-Path $work 'AppPackages') -Recurse -Filter *.msix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msix) { throw 'Build finished but no .msix was produced.' }
$dist = Join-Path $repo "dist\$App"
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $msix.FullName $dist -Force
$cer = Join-Path $dist "$App.cer"
Export-Certificate -Cert $cert -FilePath $cer | Out-Null          # public part only
$out = Join-Path $dist $msix.Name
Write-Host "`nBuilt: $out"

# --- 6. install ---------------------------------------------------------------------------------
if ($Install) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not (Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $Thumbprint)) {
    if (-not $admin) { throw 'Trusting the certificate needs an elevated PowerShell (Run as administrator). Run once as admin, or import the .cer manually (see docs/DEPLOYMENT.md).' }
    Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
    Write-Host 'Certificate trusted for this PC (LocalMachine\TrustedPeople).'
  }
  Add-AppxPackage -Path $out -ForceApplicationShutdown
  $pkg = Get-AppxPackage | Where-Object { $_.InstallLocation -and $_.Name -eq ([xml](Get-Content $manifestPath -Raw)).Package.Identity.Name }
  Write-Host "Installed: $($pkg.PackageFamilyName)"
  Write-Host "Start it from the Start menu, or:  Start-Process 'shell:AppsFolder\$($pkg.PackageFamilyName)!App'"
} else {
  Write-Host "To install: run this script again with -Install, or see docs/DEPLOYMENT.md step 6."
}
