$ErrorActionPreference = "Stop"

function Install-NodeRuntime {
  Write-Host "Installing Node.js LTS with winget..."
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is not available. Install Node.js LTS from https://nodejs.org/ and run setup.ps1 again."
  }
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  $env:Path = "${env:ProgramFiles}\nodejs;${env:APPDATA}\npm;$env:Path"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Install-NodeRuntime
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Install-NodeRuntime
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js was installed, but this PowerShell window cannot find node/npm yet. Open a new PowerShell window and run setup.ps1 again."
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
  Write-Host "Node.js 18 or newer is required. Current version: $(node -v)"
  Install-NodeRuntime
  $nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
  if ($nodeMajor -lt 18) {
    throw "Node.js is still older than 18 after installation. Open a new PowerShell window and run setup.ps1 again."
  }
}

Write-Host "Installing npm dependencies..."
npm install

Write-Host "Installing Playwright Chromium..."
npx --yes playwright install chromium

Write-Host "Setup completed."
