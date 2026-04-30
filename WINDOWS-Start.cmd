@echo off
setlocal
cd /d "%~dp0"

if not exist "artifacts" mkdir "artifacts" >nul 2>nul
set "START_LOG=artifacts\windows-start.log"
echo [%date% %time%] Starting Auto Infotech Claim > "%START_LOG%"

where node >nul 2>nul
if errorlevel 1 (
  call :install_node
  if errorlevel 1 exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  call :install_node
  if errorlevel 1 exit /b 1
)

node -e "const major = Number(process.versions.node.split('.')[0]); process.exit(major >= 18 ? 0 : 1);" >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Installing Node.js LTS...
  node -v
  echo Node.js 18 or newer is required. Installing Node.js LTS... >> "%START_LOG%"
  node -v >> "%START_LOG%" 2>&1
  call :install_node
  if errorlevel 1 exit /b 1
  node -e "const major = Number(process.versions.node.split('.')[0]); process.exit(major >= 18 ? 0 : 1);" >nul 2>nul
  if errorlevel 1 (
    echo Node.js is still older than 18 after installation. Close this window and run WINDOWS-Start.cmd again.
    pause
    exit /b 1
  )
)

echo Checking npm dependencies...
call npm install >> "%START_LOG%" 2>&1
if errorlevel 1 (
  echo Failed to install npm dependencies.
  echo Failed to install npm dependencies. See %START_LOG%
  pause
  exit /b 1
)

node -e "const fs = require('fs'); const { chromium } = require('playwright'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);" >nul 2>nul
if errorlevel 1 (
  echo First-time setup: installing Playwright Chromium...
  call npx --yes playwright install chromium >> "%START_LOG%" 2>&1
  if errorlevel 1 (
    echo Failed to install Playwright Chromium.
    echo Failed to install Playwright Chromium. See %START_LOG%
    pause
    exit /b 1
  )
)

echo Launching Auto Infotech Claim...
node src\auto-claim-ui.js >> "%START_LOG%" 2>&1
if errorlevel 1 (
  echo Auto Infotech Claim failed to start. See %START_LOG%
  pause
  exit /b 1
)

exit /b 0

:install_node
echo Installing Node.js LTS with winget...
echo Installing Node.js LTS with winget... >> "%START_LOG%"
where winget >nul 2>nul
if errorlevel 1 (
  echo winget is not available. Install Node.js LTS from https://nodejs.org/ and run WINDOWS-Start.cmd again.
  echo winget is not available. >> "%START_LOG%"
  pause
  exit /b 1
)

winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements >> "%START_LOG%" 2>&1
if errorlevel 1 (
  echo Failed to install Node.js LTS with winget. See %START_LOG%
  pause
  exit /b 1
)

set "PATH=%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was installed, but this window cannot find it yet. Close this window and run WINDOWS-Start.cmd again.
  echo Node.js installed but not found in current PATH. >> "%START_LOG%"
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was installed, but this window cannot find it yet. Close this window and run WINDOWS-Start.cmd again.
  echo npm installed but not found in current PATH. >> "%START_LOG%"
  pause
  exit /b 1
)

exit /b 0
