param(
  [string]$Ref = '',
  [string]$ReleaseRepo = 'TruJ0e/Torgy-Releases'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$package = Get-Content 'package.json' -Raw | ConvertFrom-Json
$version = [string]$package.version
if (-not $version) { throw 'package.json has no version.' }
if (-not $Ref) { $Ref = (git branch --show-current).Trim() }
if (-not $Ref) { throw 'Could not determine a Git ref to build.' }

$status = git status --porcelain
if ($status) { throw "Working tree must be clean before publishing an update.`n$status" }

$keyPath = Join-Path $env:USERPROFILE '.tauri\torgy-updater.key'
if (-not (Test-Path $keyPath)) { throw "Updater signing key not found at $keyPath" }

Write-Host "Triggering Windows build for Torgy $version from $Ref..."
gh workflow run windows-installer.yml --ref $Ref
if ($LASTEXITCODE -ne 0) { throw 'Could not trigger windows-installer workflow.' }
Start-Sleep -Seconds 4
$runs = gh run list --workflow windows-installer.yml --branch $Ref --event workflow_dispatch --limit 1 --json databaseId,status,conclusion,headSha,createdAt | ConvertFrom-Json
if (-not $runs -or -not $runs[0].databaseId) { throw 'Could not locate the triggered workflow run.' }
$runId = [string]$runs[0].databaseId
Write-Host "Watching workflow run $runId..."
gh run watch $runId --exit-status
if ($LASTEXITCODE -ne 0) { throw "Windows build workflow $runId failed." }

$payloadRoot = Join-Path $env:TEMP "torgy-release-$version-$runId"
if (Test-Path $payloadRoot) { Remove-Item -Recurse -Force $payloadRoot }
New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null
gh run download $runId -n torgy-windows-update -D $payloadRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not download Windows release payload.' }

$installer = Get-ChildItem $payloadRoot -Recurse -Filter '*-setup.exe' | Select-Object -First 1
$portable = Get-ChildItem $payloadRoot -Recurse -Filter 'torgy.exe' | Select-Object -First 1
if (-not $installer) { throw 'Built NSIS installer was not found in the workflow artifact.' }
if (-not $portable) { throw 'Built standalone executable was not found in the workflow artifact.' }

$releaseInstaller = Join-Path $payloadRoot "Torgy_${version}_x64-setup.exe"
$releasePortable = Join-Path $payloadRoot "Torgy_${version}_portable.exe"
Copy-Item $installer.FullName $releaseInstaller -Force
Copy-Item $portable.FullName $releasePortable -Force
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
Write-Host 'Signing updater installer locally...'
npm run tauri signer sign -- -f $keyPath $releaseInstaller
if ($LASTEXITCODE -ne 0) { throw 'Updater signing failed.' }
$sigPath = "$releaseInstaller.sig"
if (-not (Test-Path $sigPath)) { throw 'Updater signature file was not created.' }
$signature = (Get-Content $sigPath -Raw).Trim()

$assetName = [IO.Path]::GetFileName($releaseInstaller)
$assetUrl = "https://github.com/$ReleaseRepo/releases/download/v$version/$assetName"
$manifest = [ordered]@{
  version = $version
  notes = "Torgy $version update"
  pub_date = (Get-Date).ToUniversalTime().ToString('o')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = $signature
      url = $assetUrl
    }
  }
}
$manifestPath = Join-Path $payloadRoot 'latest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content $manifestPath -Encoding utf8

$tag = "v$version"
$existing = gh release view $tag --repo $ReleaseRepo --json tagName 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  gh release upload $tag $releaseInstaller $releasePortable $sigPath $manifestPath --repo $ReleaseRepo --clobber
  if ($LASTEXITCODE -ne 0) { throw 'Could not replace release assets.' }
  gh release edit $tag --repo $ReleaseRepo --title "Torgy $version" --notes "Signed Windows release for Torgy $version."
} else {
  gh release create $tag $releaseInstaller $releasePortable $sigPath $manifestPath --repo $ReleaseRepo --target main --title "Torgy $version" --notes "Signed Windows release for Torgy $version."
}
if ($LASTEXITCODE -ne 0) { throw 'Could not publish the public Torgy release.' }

$installerHash = (Get-FileHash $releaseInstaller -Algorithm SHA256).Hash
$portableHash = (Get-FileHash $releasePortable -Algorithm SHA256).Hash
Write-Host "Published Torgy $version to $ReleaseRepo"
Write-Host "Installer SHA256: $installerHash"
Write-Host "Portable SHA256:  $portableHash"
Write-Host "Manifest: https://github.com/$ReleaseRepo/releases/latest/download/latest.json"
