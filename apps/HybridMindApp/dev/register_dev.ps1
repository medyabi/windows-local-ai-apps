# Registers the Debug build under a separate identity (Dyabi.HybridMindDev) so the real installed app and its data are never touched.
Set-Location (Split-Path -Parent $PSScriptRoot)
$m = (Get-ChildItem bin\x64\Debug -Recurse -Filter AppxManifest.xml | Select-Object -First 1).FullName
$x = Get-Content $m -Raw
$x = $x -replace 'Name="Dyabi\.HybridMind"', 'Name="Dyabi.HybridMindDev"'
$x = $x -replace 'DisplayName="HybridMind by Dyabi"', 'DisplayName="HybridMind DEV"'
$x = $x -replace '<DisplayName>HybridMind by Dyabi</DisplayName>', '<DisplayName>HybridMind DEV</DisplayName>'
$x = $x -replace 'ShortName="HybridMind by Dyabi"', 'ShortName="HybridMind DEV"'
Set-Content $m $x -Encoding UTF8
Get-AppxPackage Dyabi.HybridMindDev | Remove-AppxPackage -ErrorAction SilentlyContinue
Add-AppxPackage -Register $m
Get-AppxPackage Dyabi.HybridMindDev | Select-Object PackageFamilyName, IsDevelopmentMode | Format-List
