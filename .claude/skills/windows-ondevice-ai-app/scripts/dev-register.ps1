<#
.SYNOPSIS
  Developer loop: builds the Debug configuration, registers it as a loose package under a SEPARATE dev identity, starts it.

.DESCRIPTION
  A packaged app needs package identity (raw .exe files do not work with the Windows AI APIs). Registering the Debug build under the
  real identity would share LocalState with an installed copy, and removing the dev package would wipe the real app's data.
  This script therefore registers "<Identity>Dev" with "(dev)" in the display name.
  Run it from the project folder (or pass -Project).
#>
[CmdletBinding()]
param([string] $Project = (Get-Location).Path, [switch] $NoStart)

$ErrorActionPreference = 'Stop'
$csproj = Get-ChildItem $Project -Filter *.csproj | Select-Object -First 1
if (-not $csproj) { throw "No .csproj in $Project" }

& dotnet build $csproj.FullName -c Debug -p:Platform=x64
if ($LASTEXITCODE -ne 0) { throw "dotnet build failed (exit $LASTEXITCODE). Scroll up for the first 'error'." }

$manifest = Get-ChildItem (Join-Path $Project 'bin\x64\Debug') -Recurse -Filter AppxManifest.xml | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $manifest) { throw 'AppxManifest.xml not found under bin\x64\Debug. Did the build produce a package layout?' }

[xml]$x = [IO.File]::ReadAllText($manifest.FullName)
$realName = $x.Package.Identity.Name
if ($realName -notlike '*Dev') {
  $x.Package.Identity.Name = $realName + 'Dev'
  $x.Package.Properties.DisplayName = $x.Package.Properties.DisplayName + ' (dev)'
  $ns = New-Object System.Xml.XmlNamespaceManager $x.NameTable
  $ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
  $ve = $x.SelectSingleNode('//uap:VisualElements', $ns)
  if ($ve) { $ve.SetAttribute('DisplayName', $ve.GetAttribute('DisplayName') + ' (dev)') }
  $x.Save($manifest.FullName)
}
$devName = $x.Package.Identity.Name

Add-AppxPackage -Register $manifest.FullName -ForceApplicationShutdown
$pkg = Get-AppxPackage -Name $devName
Write-Host "Registered $devName  ($($pkg.PackageFamilyName))" -ForegroundColor Green
Write-Host "LocalState: $env:LOCALAPPDATA\Packages\$($pkg.PackageFamilyName)\LocalState   (bridge.log is there)"
if (-not $NoStart) { Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!App" }
