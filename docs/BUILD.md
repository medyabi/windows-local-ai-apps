# Building an app

Every app in `apps/` is a **packaged WinUI 3 + WebView2** desktop app. It needs *package identity* (for `ApplicationData`, and for the `Microsoft.Windows.AI.*` APIs to work at all), so it is built as an **MSIX** signed with a certificate you create yourself. No binaries are published in this repository.

## 1. Prerequisites

- Windows 11, x64; for the AI features a PC supporting the Windows AI APIs (Phi Silica: Copilot+ PC)
- .NET 8 SDK
- Windows SDK / Build Tools 10.0.26100 (the projects pin `Microsoft.Windows.SDK.BuildTools 10.0.26100.4654`)
- Windows App SDK `2.2.2-experimental9` (restored by NuGet)

## 2. Create and trust your own signing certificate (once)

```powershell
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=YourName" -KeyUsage DigitalSignature `
  -FriendlyName "On-device AI apps (dev)" -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
$cert.Thumbprint                                  # keep this value
Export-Certificate -Cert $cert -FilePath .\dev.cer

# in an elevated PowerShell: trust it so that the MSIX can be installed
Import-Certificate -FilePath .\dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

## 3. Point the app at your certificate

In the app folder:

- `*.csproj`: set `<PackageCertificateThumbprint>` to your thumbprint (the value in the repository belongs to the author's machine and will not work for you). `AppxPackageSigningEnabled` stays `true`.
- `Package.appxmanifest`: set `Publisher="CN=YourName"` (it must equal the certificate subject) and, if you want, the package `Name`.

## 4. Build the MSIX (command line, no Visual Studio needed)

```powershell
cd apps\LocalMindApp
dotnet build -c Release -p:Platform=x64 -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir="AppPackages\" -p:AppxBundle=Never -p:UapAppxPackageBuildMode=SideloadOnly
```

The package is written to `AppPackages\<Name>_<version>_x64_Test\<Name>_<version>_x64.msix`. Install it with:

```powershell
Add-AppxPackage -Path .\AppPackages\<Name>_<version>_x64_Test\<Name>_<version>_x64.msix
```

## 5. Developer loop

Running the raw unpackaged `.exe` does **not** work: `ApplicationData.Current` throws without package identity and the AI APIs are unreliable. Build a Debug configuration and register it loosely instead:

```powershell
dotnet build -c Debug -p:Platform=x64
Add-AppxPackage -Register "<bin>\Debug\net8.0-windows10.0.22621.0\win-x64\AppxManifest.xml" -ForceApplicationShutdown
Start-Process "shell:AppsFolder\<PackageFamilyName>!App"
```

`Get-AppxPackage *<AppName>*` shows the package family name. Each app writes `bridge.log` in its package's `LocalState` folder (`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState`): start there when something does not work.

## Notes

- `UglyToad.PdfPig` is pinned to a prerelease in the apps that read PDFs (at the time of building, no stable version matched); check NuGet for a newer stable one.
- The web UI is plain HTML/JS in each app's `www/` folder, loaded by the WebView2 shell; most UI changes do not touch the C# code.
- Only HybridMed and HybridMind have a cloud stage, and both need an endpoint (and key) that **you** provide. Some other apps also make small network requests (fonts, a CDN, geocoding, a job-posting URL): see the network table in the main README.
- [`../scripts/build-app.ps1`](../scripts/build-app.ps1) automates steps 2–4 (certificate, patching a temporary copy, build); the step-by-step guide is [`DEPLOYMENT.md`](DEPLOYMENT.md).
