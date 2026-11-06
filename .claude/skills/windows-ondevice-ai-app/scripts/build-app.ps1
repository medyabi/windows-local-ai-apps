<#
.SYNOPSIS
  Builds a signed Release MSIX of the project and packs a shareable folder: the .msix, the public .cer and an installer script.

.DESCRIPTION
  1. reads Publisher and Name from Package.appxmanifest
  2. finds (or creates) a self-signed code-signing certificate with that subject in Cert:\CurrentUser\My and writes its thumbprint into the .csproj
  3. dotnet build (x64, sideload MSIX, no Visual Studio needed)
  4. writes dist\<Name>\ with <Name>_<ver>_x64.msix, <Name>.cer, Install-<Name>.ps1 and a short README; also dist\<Name>-x64-install.zip
  -Install  also trusts the certificate (needs an elevated PowerShell) and installs the package on this PC.
  Send the zip to a colleague: they run Install-<Name>.ps1 in an elevated PowerShell. The AI features need a Copilot+ PC.
#>
[CmdletBinding()]
param([string] $Project = (Get-Location).Path, [switch] $Install)

$ErrorActionPreference = 'Stop'
$csproj = Get-ChildItem $Project -Filter *.csproj | Select-Object -First 1
if (-not $csproj) { throw "No .csproj in $Project" }
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw '.NET SDK not found. Install the .NET 8 SDK (or newer) from https://dot.net' }

$manifestPath = Join-Path $Project 'Package.appxmanifest'
[xml]$m = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8)
$subject = $m.Package.Identity.Publisher
$appName = [IO.Path]::GetFileNameWithoutExtension($csproj.Name)
$utf8 = New-Object System.Text.UTF8Encoding($false)

$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) {
  Write-Host "Creating a self-signed code-signing certificate '$subject' ..."
  $cert = New-SelfSignedCertificate -Type Custom -Subject $subject -KeyUsage DigitalSignature -FriendlyName 'On-device AI apps' `
    -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(3) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
}
$x = [IO.File]::ReadAllText($csproj.FullName, [Text.Encoding]::UTF8)
$x = [regex]::Replace($x, '<PackageCertificateThumbprint>[^<]*</PackageCertificateThumbprint>', "<PackageCertificateThumbprint>$($cert.Thumbprint)</PackageCertificateThumbprint>")
[IO.File]::WriteAllText($csproj.FullName, $x, $utf8)
Write-Host "Certificate: $($cert.Subject)  $($cert.Thumbprint)"

Push-Location $Project
try {
  if (Test-Path 'AppPackages') { Remove-Item 'AppPackages' -Recurse -Force }
  & dotnet build -c Release -p:Platform=x64 -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir="AppPackages\" -p:AppxBundle=Never -p:UapAppxPackageBuildMode=SideloadOnly
  if ($LASTEXITCODE -ne 0) { throw "dotnet build failed (exit $LASTEXITCODE). Scroll up for the first 'error'." }
} finally { Pop-Location }

$msix = Get-ChildItem (Join-Path $Project 'AppPackages') -Recurse -Filter *.msix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msix) { throw 'Build finished but no .msix was produced.' }
$dist = Join-Path $Project "dist\$appName"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $msix.FullName $dist
Export-Certificate -Cert $cert -FilePath (Join-Path $dist "$appName.cer") | Out-Null     # public part only

$installer = @"
# Installs $appName on this PC. Run in an elevated PowerShell (Run as administrator).
`$ErrorActionPreference = 'Stop'
`$here = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not `$admin) { throw 'Run this script in an elevated PowerShell (Run as administrator).' }
Import-Certificate -FilePath (Join-Path `$here '$appName.cer') -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
Add-AppxPackage -Path (Join-Path `$here '$($msix.Name)') -ForceApplicationShutdown
Write-Host 'Installed. Start it from the Start menu.'
"@
[IO.File]::WriteAllText((Join-Path $dist "Install-$appName.ps1"), $installer, $utf8)
[IO.File]::WriteAllText((Join-Path $dist 'README.txt'), "$appName`r`n`r`n1. Open PowerShell as administrator in this folder.`r`n2. Run: .\Install-$appName.ps1`r`n3. Start $appName from the Start menu.`r`n`r`nThe AI features need a Windows 11 Copilot+ PC. On first use Windows downloads the on-device models (a few minutes).`r`nThe certificate is self-signed: it is trusted only on PCs where you run the installer.`r`n", $utf8)

$zip = Join-Path $Project "dist\$appName-x64-install.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip
Write-Host "`nBuilt:   $(Join-Path $dist $msix.Name)" -ForegroundColor Green
Write-Host "Package: $zip"

if ($Install) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not (Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $cert.Thumbprint)) {
    if (-not $admin) { throw 'Trusting the certificate needs an elevated PowerShell. Run once as administrator.' }
    Import-Certificate -FilePath (Join-Path $dist "$appName.cer") -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
  }
  Add-AppxPackage -Path (Join-Path $dist $msix.Name) -ForceApplicationShutdown
  Write-Host 'Installed. Start it from the Start menu.' -ForegroundColor Green
}
