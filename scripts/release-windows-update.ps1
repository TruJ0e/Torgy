param(
  [string]$Ref = '',
  [string]$ReleaseRepo = 'TruJ0e/Torgy-Releases',
  [string]$RunId = ''
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

$defaults = Get-Content 'src-tauri/deployment.defaults.json' -Raw | ConvertFrom-Json
$configured = $defaults.PSObject.Properties | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.Value) }
if ($configured) { throw ('Public release source contains organization-specific defaults: ' + (($configured.Name) -join ', ')) }

$keyPath = Join-Path $env:USERPROFILE '.tauri\torgy-updater.key'
$publicKeyPath = "$keyPath.pub"
if (-not (Test-Path $keyPath)) { throw "Updater signing key not found at $keyPath" }
if (-not (Test-Path $publicKeyPath)) { throw "Updater public key not found at $publicKeyPath" }

if (-not $RunId) {
  Write-Host "Triggering generic Windows build for Torgy $version from $Ref..."
  gh workflow run windows-installer.yml --ref $Ref
  if ($LASTEXITCODE -ne 0) { throw 'Could not trigger windows-installer workflow.' }
  Start-Sleep -Seconds 4
  $runs = gh run list --workflow windows-installer.yml --branch $Ref --event workflow_dispatch --limit 1 --json databaseId,status,conclusion,headSha,createdAt | ConvertFrom-Json
  if (-not $runs -or -not $runs[0].databaseId) { throw 'Could not locate the triggered workflow run.' }
  $RunId = [string]$runs[0].databaseId
  Write-Host "Watching workflow run $RunId..."
  gh run watch $RunId --exit-status
  if ($LASTEXITCODE -ne 0) { throw "Windows build workflow $RunId failed." }
} else {
  $run = gh run view $RunId --json status,conclusion,headBranch | ConvertFrom-Json
  if ($run.status -ne 'completed' -or $run.conclusion -ne 'success') { throw "Workflow run $RunId is not a successful completed build." }
  Write-Host "Reusing successful generic Windows build $RunId from $($run.headBranch)."
}

$payloadRoot = Join-Path $env:TEMP "torgy-release-$version-$RunId"
if (Test-Path $payloadRoot) { Remove-Item -Recurse -Force $payloadRoot }
New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null
gh run download $RunId -n torgy-windows-update -D $payloadRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not download Windows release payload.' }

$installer = Get-ChildItem $payloadRoot -Recurse -Filter '*-setup.exe' | Select-Object -First 1
if (-not $installer) { throw 'Built NSIS installer was not found in the workflow artifact.' }
$releaseInstaller = Join-Path $payloadRoot "Torgy_${version}_x64-setup.exe"
Copy-Item $installer.FullName $releaseInstaller -Force

python -c "import minisign" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Installing pinned local release-signing dependency...'
  python -m pip install --user py-minisign==0.21.1
  if ($LASTEXITCODE -ne 0) { throw 'Could not install py-minisign release dependency.' }
}

Write-Host 'Signing updater installer locally without exposing the private key...'
python scripts/sign-tauri-update.py --private-key $keyPath --public-key $publicKeyPath $releaseInstaller
if ($LASTEXITCODE -ne 0) { throw 'Updater signing failed.' }
$sigPath = "$releaseInstaller.sig"
if (-not (Test-Path $sigPath)) { throw 'Updater signature was not created.' }
$signature = (Get-Content $sigPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($signature)) { throw 'Updater signature is empty.' }

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
  gh release upload $tag $releaseInstaller $sigPath $manifestPath --repo $ReleaseRepo --clobber
  if ($LASTEXITCODE -ne 0) { throw 'Could not replace release assets.' }
  gh release edit $tag --repo $ReleaseRepo --title "Torgy $version" --notes "Signed generic Windows release for Torgy $version."
} else {
  gh release create $tag $releaseInstaller $sigPath $manifestPath --repo $ReleaseRepo --target main --title "Torgy $version" --notes "Signed generic Windows release for Torgy $version."
}
if ($LASTEXITCODE -ne 0) { throw 'Could not publish the public Torgy release.' }

$installerHash = (Get-FileHash $releaseInstaller -Algorithm SHA256).Hash
Write-Host "Published Torgy $version to $ReleaseRepo"
Write-Host "Installer SHA256: $installerHash"
Write-Host "Manifest: https://github.com/$ReleaseRepo/releases/latest/download/latest.json"
