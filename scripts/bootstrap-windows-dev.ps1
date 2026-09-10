$ErrorActionPreference = 'Stop'

Write-Host 'Torgy Windows development bootstrap'
Write-Host 'This installs development toolchains only. End users should use the finished Torgy installer.'

function Ensure-Command($Command, $PackageId) {
  if (Get-Command $Command -ErrorAction SilentlyContinue) {
    Write-Host "$Command already installed."
    return
  }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required to install $PackageId automatically."
  }
  Write-Host "Installing $PackageId..."
  winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
}

Ensure-Command 'node' 'OpenJS.NodeJS.LTS'
Ensure-Command 'rustup' 'Rustlang.Rustup'

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  Write-Host 'Microsoft C++ Build Tools were not detected in this shell.'
  Write-Host 'Tauri requires the Microsoft Visual C++ build tools. On managed university devices, have IT provide them rather than bypassing policy.'
}

rustup default stable
npm install --no-audit --no-fund
npm run security:repo
npm run core:check

Write-Host ''
Write-Host 'Bootstrap complete.'
Write-Host 'Run: npm run desktop:dev'
