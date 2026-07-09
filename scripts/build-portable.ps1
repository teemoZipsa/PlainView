$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$tauriConfigPath = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
$releaseExePath = Join-Path $repoRoot 'src-tauri\target\release\plainview.exe'
$bundleDir = Join-Path $repoRoot 'src-tauri\target\release\bundle'

if (!(Test-Path -LiteralPath $tauriConfigPath)) {
  throw "Missing Tauri config: $tauriConfigPath"
}

if (!(Test-Path -LiteralPath $releaseExePath)) {
  throw "Missing release executable: $releaseExePath. Run `npm run tauri build` first."
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$productName = $tauriConfig.productName
$version = $tauriConfig.version

if ([string]::IsNullOrWhiteSpace($productName) -or [string]::IsNullOrWhiteSpace($version)) {
  throw 'Tauri config must define productName and version.'
}

$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()) {
  'X64' { 'x64' }
  'Arm64' { 'arm64' }
  'X86' { 'x86' }
  default { $_.ToLowerInvariant() }
}

New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

$portableName = '{0}_{1}_{2}-portable.exe' -f $productName, $version, $arch
$portablePath = Join-Path $bundleDir $portableName

Copy-Item -LiteralPath $releaseExePath -Destination $portablePath -Force

Write-Host "Portable build created: $portablePath"
