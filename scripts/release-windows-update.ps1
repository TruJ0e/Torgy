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

$allInstallers = @(Get-ChildItem $payloadRoot -Recurse -Filter '*-setup.exe')
$installer = $allInstallers | Where-Object { $_.Name -notlike 'Torgy_Machine_Agent_*' } | Select-Object -First 1
if (-not $installer) { throw 'Built Torgy current-user NSIS installer was not found in the workflow artifact.' }
$machineAgentInstaller = $allInstallers | Where-Object { $_.Name -like 'Torgy_Machine_Agent_*' } | Select-Object -First 1
if (-not $machineAgentInstaller) { throw 'Built Torgy Machine Agent installer was not found in the workflow artifact.' }

$releaseInstaller = Join-Path $payloadRoot "Torgy_${version}_x64-setup.exe"
$releaseMachineAgent = Join-Path $payloadRoot "Torgy_Machine_Agent_${version}_x64-setup.exe"
Copy-Item $installer.FullName $releaseInstaller -Force
Copy-Item $machineAgentInstaller.FullName $releaseMachineAgent -Force

function Invoke-TorgySignature([string]$FilePath) {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    & $uv.Source run --with 'py-minisign==0.21.1' python scripts/sign-tauri-update.py --private-key $keyPath --public-key $publicKeyPath $FilePath
  } else {
    python -c "import minisign" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Installing pinned local release-signing dependency...'
      python -m pip install --user py-minisign==0.21.1
      if ($LASTEXITCODE -ne 0) { throw 'Could not install py-minisign release dependency.' }
    }
    python scripts/sign-tauri-update.py --private-key $keyPath --public-key $publicKeyPath $FilePath
  }
  if ($LASTEXITCODE -ne 0) { throw "Updater signing failed for $FilePath" }
  $signaturePath = "$FilePath.sig"
  if (-not (Test-Path $signaturePath)) { throw "Signature was not created for $FilePath" }
  return $signaturePath
}

Write-Host 'Signing current-user updater installer locally without exposing the private key...'
$sigPath = Invoke-TorgySignature $releaseInstaller
$signature = (Get-Content $sigPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($signature)) { throw 'Updater signature is empty.' }

Write-Host 'Signing one-time Machine Agent installer locally...'
$machineAgentSigPath = Invoke-TorgySignature $releaseMachineAgent

$assetName = [IO.Path]::GetFileName($releaseInstaller)
$assetUrl = "https://github.com/$ReleaseRepo/releases/download/v$version/$assetName"
$manifest = [ordered]@{
  version = $version
  notes = "Torgy $version current-user update"
  pub_date = (Get-Date).ToUniversalTime().ToString('o')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = $signature
      url = $assetUrl
    }
  }
}
$manifestPath = Join-Path $payloadRoot 'latest.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object Text.UTF8Encoding($false)))

$releaseAssets = @($releaseInstaller, $sigPath, $releaseMachineAgent, $machineAgentSigPath, $manifestPath)
$tag = "v$version"
$releases = gh release list --repo $ReleaseRepo --limit 100 --json tagName | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not list public Torgy releases.' }
$existing = $releases | Where-Object { $_.tagName -eq $tag } | Select-Object -First 1
$notes = "Signed Torgy $version current-user release. Routine desktop updates do not require elevation. The separately signed Torgy Machine Agent package is a one-time administrator/IT install for SYSTEM-managed synchronization."
if ($existing) {
  gh release upload $tag @releaseAssets --repo $ReleaseRepo --clobber
  if ($LASTEXITCODE -ne 0) { throw 'Could not replace release assets.' }
  gh release edit $tag --repo $ReleaseRepo --title "Torgy $version" --notes $notes
} else {
  gh release create $tag @releaseAssets --repo $ReleaseRepo --target main --title "Torgy $version" --notes $notes
}
if ($LASTEXITCODE -ne 0) { throw 'Could not publish the public Torgy release.' }

$installerHash = (Get-FileHash $releaseInstaller -Algorithm SHA256).Hash
$agentHash = (Get-FileHash $releaseMachineAgent -Algorithm SHA256).Hash
Write-Host "Published Torgy $version to $ReleaseRepo"
Write-Host "Current-user installer SHA256: $installerHash"
Write-Host "Machine Agent installer SHA256: $agentHash"
Write-Host "Manifest: https://github.com/$ReleaseRepo/releases/latest/download/latest.json"
